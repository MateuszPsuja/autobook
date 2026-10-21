import { LLMModel } from './provider.types';

/**
 * Google Gemini rules applied on top of the OpenAI-compatible surface.
 *
 * Gemini is reached through Google's OpenAI-compatibility shim
 * (`https://generativelanguage.googleapis.com/v1beta/openai`), so the
 * transport (chat, SSE streaming, `/models`) is the generic
 * `openai-compat` path. What differs from plain OpenAI is the request
 * body:
 *
 *   - Sampling params: Google ignores custom `temperature` / `top_p` /
 *     `top_k` on the Gemini 3+ families and will reject them with a 400
 *     later on. Earlier families (2.x) still honour them.
 *   - Thinking: Gemini 2.5+ models spend part of the `max_tokens` budget
 *     on internal reasoning before producing any prose. We add a fixed
 *     thinking allowance to `max_tokens` (capped at the documented
 *     65,536-token output limit) so the chapter budget survives.
 *
 * The model list from `/models` also contains embedding, image, TTS and
 * video models which would fail a chat call, so the list is filtered.
 *
 * Pure functions only — no DI, mirroring `anthropic.adapter.ts`.
 */

/** Output tokens reserved for Gemini's internal thinking. */
export const GEMINI_THINKING_ALLOWANCE = 24576;

/** Hard ceiling — Gemini text models cap output at 65,536 tokens. */
export const GEMINI_MAX_OUTPUT_TOKENS = 65536;

/** Sampling fields Google ignores (and later rejects) on Gemini 3+. */
const SAMPLING_FIELDS = ['temperature', 'top_p', 'top_k'];

/**
 * Substrings that identify models which cannot serve a chat completion
 * (embeddings, image generation, speech, video, robotics).
 */
const NON_CHAT_MARKERS = [
  'embedding',
  'imagen',
  'image',
  'tts',
  'veo',
  'aqa',
  'robotics',
  'live'
];

/** 'models/gemini-3.8-flash' -> { major: '3', minor: '8' } */
function modelFamily(modelId: string): { major: string; minor: string } {
  const m = /^gemini-(\d+)(?:\.(\d+))?/.exec(modelId.replace(/^models\//, '').toLowerCase());
  return { major: m?.[1] ?? '', minor: m?.[2] ?? '0' };
}

/** Gemini 3+/4 ignore custom sampling params and will 400 on them later. */
export function usesDeprecatedSamplingParams(modelId: string): boolean {
  const { major } = modelFamily(modelId);
  return major === '3' || major === '4';
}

/** Gemini 2.5+ think before answering; thinking tokens bill against max_tokens. */
export function isThinkingModel(modelId: string): boolean {
  const { major, minor } = modelFamily(modelId);
  if (major === '3' || major === '4') return true;
  return major === '2' && minor === '5';
}

/** Apply the Gemini request rules to an OpenAI-shaped body. */
export function toGeminiRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  const modelId = typeof next['model'] === 'string' ? next['model'] : '';
  if (usesDeprecatedSamplingParams(modelId)) {
    for (const field of SAMPLING_FIELDS) delete next[field];
  }
  if (isThinkingModel(modelId) && typeof next['max_tokens'] === 'number') {
    next['max_tokens'] = Math.min(
      next['max_tokens'] + GEMINI_THINKING_ALLOWANCE,
      GEMINI_MAX_OUTPUT_TOKENS
    );
  }
  return next;
}

/** 'gemini-3.8-flash' -> 'Gemini 3.8 Flash'. */
export function toGeminiDisplayName(modelId: string): string {
  const raw = modelId.replace(/^models\//, '');
  const rest = raw.toLowerCase().startsWith('gemini-') ? raw.slice('gemini-'.length) : raw;
  const tokens = rest.split('-').filter(Boolean);
  const isPreview = (tokens[tokens.length - 1] ?? '').toLowerCase() === 'preview';
  if (isPreview) tokens.pop();
  const version = tokens.shift() ?? '';
  const words = tokens.map(w => w.charAt(0).toUpperCase() + w.slice(1));
  let name = version ? `Gemini ${version}` : 'Gemini';
  if (words.length > 0) name += ` ${words[0]}`;
  if (words.length > 1) name += `-${words.slice(1).join('-')}`;
  if (isPreview) name += ' (Preview)';
  return name;
}

/** Classify a Gemini model id into the app's three tiers. */
function geminiTier(modelId: string): 'budget' | 'standard' | 'premium' {
  const id = modelId.toLowerCase();
  if (id.includes('flash-lite')) return 'budget';
  if (id.includes('flash')) return 'standard';
  if (id.includes('pro') || id.includes('argon')) return 'premium';
  return 'standard';
}

/**
 * Transform Google's `/models` payload into the app's model list.
 *
 * Keeps only chat-capable Gemini models, assigns a display name, the
 * 1M context badge and a tier, and marks the current stable default as
 * recommended.
 */
export function transformGeminiModels(raw: any[]): LLMModel[] {
  const models: LLMModel[] = [];
  for (const entry of raw ?? []) {
    const rawId: string = entry?.id ?? entry?.name ?? '';
    if (!rawId) continue;
    const id = rawId.replace(/^models\//, '');
    if (!id.toLowerCase().startsWith('gemini-')) continue;
    const lowered = id.toLowerCase();
    if (NON_CHAT_MARKERS.some(marker => lowered.includes(marker))) continue;
    models.push({
      id,
      name: toGeminiDisplayName(id),
      provider: 'Google',
      tier: geminiTier(id),
      contextWindow: '1M',
      contextWindowNum: 1048576
    });
  }

  const recommendedId = 'gemini-3.8-flash';
  if (models.some(m => m.id.toLowerCase() === recommendedId)) {
    for (const m of models) {
      if (m.id.toLowerCase() === recommendedId) m.recommended = true;
    }
  } else {
    const firstStandard = models.find(m => m.tier === 'standard');
    if (firstStandard) firstStandard.recommended = true;
  }

  const tierOrder = { premium: 0, standard: 1, budget: 2 };
  models.sort((a, b) => {
    if (a.recommended && !b.recommended) return -1;
    if (!a.recommended && b.recommended) return 1;
    return tierOrder[a.tier] - tierOrder[b.tier];
  });
  return models;
}
