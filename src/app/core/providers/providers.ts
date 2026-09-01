import { LLMProvider, LLMModel } from './provider.types';

/**
 * The default model list per provider. Used when the live `/models` endpoint
 * is unreachable. Models are tuned for long-form creative writing — context
 * windows and tier classifications match the existing OpenRouter behaviour.
 *
 * For OpenAI-compat providers the IDs are the upstream model IDs the
 * provider actually accepts (e.g. `gpt-4o-mini` for OpenAI, `claude-3-5-sonnet-...`
 * for Anthropic via its native API). OpenRouter is the exception: its IDs
 * are namespaced like `anthropic/claude-3.5-sonnet` because OpenRouter does
 * the vendor routing on its end.
 */

const openrouterFallback: LLMModel[] = [
  { id: 'openrouter/auto', name: 'Free Models Router', provider: 'OpenRouter', tier: 'budget', contextWindow: 'Varies', contextWindowNum: 0, free: true, recommended: true },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', provider: 'Google', tier: 'budget', contextWindow: '1M', contextWindowNum: 1000000, free: true },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', tier: 'budget', contextWindow: '128k', contextWindowNum: 128000 },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', provider: 'DeepSeek', tier: 'budget', contextWindow: '64k', contextWindowNum: 64000, free: true },
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4', provider: 'Anthropic', tier: 'standard', contextWindow: '200k', contextWindowNum: 200000 },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI', tier: 'premium', contextWindow: '128k', contextWindowNum: 128000 },
  { id: 'anthropic/claude-opus-4-5', name: 'Claude Opus 4', provider: 'Anthropic', tier: 'premium', contextWindow: '200k', contextWindowNum: 200000 },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', provider: 'Meta', tier: 'standard', contextWindow: '128k', contextWindowNum: 128000, free: true },
  { id: 'mistralai/mistral-large-2411', name: 'Mistral Large', provider: 'Mistral', tier: 'standard', contextWindow: '128k', contextWindowNum: 128000 }
];

const anthropicFallback: LLMModel[] = [
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'Anthropic', tier: 'budget', contextWindow: '200k', contextWindowNum: 200000, recommended: true },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', tier: 'standard', contextWindow: '200k', contextWindowNum: 200000 },
  { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', provider: 'Anthropic', tier: 'standard', contextWindow: '200k', contextWindowNum: 200000 },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'Anthropic', tier: 'standard', contextWindow: '200k', contextWindowNum: 200000 },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'Anthropic', tier: 'premium', contextWindow: '200k', contextWindowNum: 200000 }
];

const openaiFallback: LLMModel[] = [
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', tier: 'budget', contextWindow: '128k', contextWindowNum: 128000, recommended: true },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', tier: 'premium', contextWindow: '128k', contextWindowNum: 128000 },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI', tier: 'premium', contextWindow: '1M', contextWindowNum: 1000000 },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'OpenAI', tier: 'budget', contextWindow: '1M', contextWindowNum: 1000000 },
  { id: 'o3-mini', name: 'o3-mini', provider: 'OpenAI', tier: 'standard', contextWindow: '200k', contextWindowNum: 200000 }
];

const minimaxFallback: LLMModel[] = [
  { id: 'MiniMax-M3', name: 'MiniMax M3', provider: 'MiniMax', tier: 'premium', contextWindow: '1M', contextWindowNum: 1000000, recommended: true },
  { id: 'MiniMax-M2', name: 'MiniMax M2', provider: 'MiniMax', tier: 'standard', contextWindow: '204k', contextWindowNum: 204800 },
  { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', provider: 'MiniMax', tier: 'standard', contextWindow: '204k', contextWindowNum: 204800 }
];

const lmstudioFallback: LLMModel[] = [
  // LM Studio model list is fully dynamic — the user has to load a model
  // in the LM Studio app for it to appear in /v1/models. We don't fabricate
  // any defaults here because the IDs would be meaningless without context.
];

/**
 * The canonical provider registry. Order is significant: it's the order
 * shown in the provider dropdown. New providers go at the end so existing
 * users keep their previously selected provider slot.
 *
 * `baseUrl` is the host part only (no path). `pathPrefix` holds the API
 * version segment. This split keeps the dev-server proxy's `pathRewrite`
 * a clean host-stripping: the path prefix is preserved end-to-end.
 */
export const LLM_PROVIDERS: LLMProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai-compat',
    baseUrl: 'https://openrouter.ai/api/v1',
    proxyPath: '/api/openrouter/api/v1',
    requiresApiKey: true,
    baseUrlEditable: false,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyValidation: { prefix: 'sk-', minLength: 20 },
    fallbackModels: openrouterFallback,
    getKeyUrl: 'https://openrouter.ai/keys',
    description: 'Multi-vendor router. One key, hundreds of models.'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    protocol: 'openai-compat',
    baseUrl: 'http://localhost:1234/v1',
    proxyPath: '/api/lmstudio/v1',
    requiresApiKey: false,
    baseUrlEditable: true,
    defaultBaseUrl: 'http://localhost:1234/v1',
    fallbackModels: lmstudioFallback,
    description: 'Run open-weight models locally. No API key needed.'
  },
  {
    id: 'minimax',
    name: 'Minimax',
    protocol: 'openai-compat',
    baseUrl: 'https://api.minimax.io/v1',
    proxyPath: '/api/minimax/v1',
    // M3 has reasoning enabled by default and burns `max_tokens` on
    // thinking before producing any prose. Disable it so the
    // chapter-length budget is reserved for actual chapter content.
    extraRequestBody: { thinking: { type: 'disabled' } },
    requiresApiKey: true,
    baseUrlEditable: true,
    defaultBaseUrl: 'https://api.minimax.io/v1',
    keyValidation: { minLength: 20 },
    fallbackModels: minimaxFallback,
    getKeyUrl: 'https://minimax-ai.chat',
    description: 'Minimax M-series. OpenAI-compatible, 1M context on M3.'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    proxyPath: '/api/anthropic/v1',
    requiresApiKey: true,
    baseUrlEditable: false,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    keyValidation: { prefix: 'sk-ant-', minLength: 30 },
    fallbackModels: anthropicFallback,
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Direct access to Claude. Uses Anthropic Messages API.'
  },
  {
    id: 'openai',
    name: 'ChatGPT',
    protocol: 'openai-compat',
    baseUrl: 'https://api.openai.com/v1',
    proxyPath: '/api/openai/v1',
    requiresApiKey: true,
    baseUrlEditable: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyValidation: { prefix: 'sk-', minLength: 40 },
    fallbackModels: openaiFallback,
    getKeyUrl: 'https://platform.openai.com/api-keys',
    description: 'OpenAI / ChatGPT direct API.'
  }
];

export const LLM_PROVIDERS_BY_ID: Record<string, LLMProvider> = LLM_PROVIDERS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<string, LLMProvider>
);

export function getProvider(id: string | null | undefined): LLMProvider | undefined {
  if (!id) return undefined;
  return LLM_PROVIDERS_BY_ID[id];
}

export function getDefaultProvider(): LLMProvider {
  return LLM_PROVIDERS[0];
}
