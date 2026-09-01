import { ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from '../api.service';

/**
 * Adapter between OpenAI Chat Completions shape (the rest of the app's
 * canonical request/response shape) and Anthropic's native Messages API.
 *
 * Why this exists: Anthropic's API is intentionally different from
 * OpenAI's. Specifically:
 *   - Headers: `x-api-key` + `anthropic-version` instead of `Authorization`
 *   - Request body: `system` is a top-level field, `messages` only
 *     contain user/assistant turns, content is either a plain string
 *     or an array of typed blocks.
 *   - Response: `content` is an array of blocks, `usage.input_tokens` /
 *     `usage.output_tokens` instead of prompt/completion.
 *   - Streaming SSE: `event:` lines with `content_block_delta` events
 *     carrying `{ delta: { type: 'text_delta', text: '...' } }`.
 *
 * By hiding this behind the same `chatCompletion` /
 * `chatCompletionStream` interface that OpenAI-compat providers use, the
 * book generation agents (architect, author, critic, ...) keep working
 * unchanged when the user picks Anthropic as the active provider.
 *
 * Anything more advanced (tool use, image inputs, extended thinking,
 * prompt caching) is intentionally out of scope for this adapter — the
 * app only does text generation.
 */

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: 'thinking'; thinking: string; signature?: string };

/**
 * Convert an OpenAI-shape chat completion request into the body, headers
 * and URL expected by Anthropic's `/v1/messages` endpoint.
 *
 * The `apiBaseUrl` is the Anthropic base URL (e.g. `https://api.anthropic.com/v1`).
 * `stream` is passed through so the caller can use the same request object
 * for both streaming and non-streaming flows.
 */
export function toAnthropicRequest(
  request: ChatCompletionRequest,
  apiKey: string,
  apiBaseUrl: string,
  stream: boolean
): AnthropicRequest {
  const { system, messages } = splitSystemMessage(request.messages);
  const body: Record<string, unknown> = {
    model: request.model,
    messages: messages.map(toAnthropicMessage),
    max_tokens: request.max_tokens ?? DEFAULT_MAX_TOKENS,
    stream
  };
  if (system) body['system'] = system;
  if (typeof request.temperature === 'number') body['temperature'] = request.temperature;

  return {
    url: `${apiBaseUrl.replace(/\/+$/, '')}/messages`,
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      ...(stream ? { Accept: 'text/event-stream' } : {})
    }
  };
}

/**
 * Convert an Anthropic Messages API response into the OpenAI
 * `ChatCompletionResponse` shape the rest of the app expects.
 */
export function fromAnthropicResponse(response: AnthropicResponse): ChatCompletionResponse {
  const text = response.content
    .filter((block): block is Extract<AnthropicContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('');

  return {
    id: response.id,
    object: 'chat.completion',
    created: Date.now(),
    model: response.model,
    choices: [
      {
        index: 0,
        finish_reason: mapAnthropicStopReason(response.stop_reason),
        message: { role: 'assistant', content: text }
      }
    ],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens
    }
  };
}

function mapAnthropicStopReason(reason: string | null): string {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    default:
      return reason ?? 'stop';
  }
}

function splitSystemMessage(messages: ChatMessage[]): { system: string | null; messages: ChatMessage[] } {
  const systemParts: string[] = [];
  const rest: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string' && m.content.length > 0) {
        systemParts.push(m.content);
      }
    } else {
      rest.push(m);
    }
  }
  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : null,
    messages: rest
  };
}

function toAnthropicMessage(m: ChatMessage): { role: 'user' | 'assistant'; content: string } {
  // The app sends text-only content; pass it through as a string,
  // which is the simplest valid Anthropic content shape.
  return { role: m.role as 'user' | 'assistant', content: typeof m.content === 'string' ? m.content : '' };
}

// === Streaming ===

export interface AnthropicStreamEvent {
  event: string;
  data: unknown;
}

/**
 * Parse a single SSE event from Anthropic. Anthropic's stream uses
 * `event: <name>\ndata: <json>` lines, unlike OpenAI which only uses
 * `data: <json>`. The caller iterates over raw chunks and we extract
 * the text deltas here.
 */
export function parseAnthropicStreamChunk(rawChunk: string): { text: string; done: boolean } {
  let text = '';
  let done = false;
  // A single chunk may contain several events.
  for (const event of splitSseEvents(rawChunk)) {
    if (!event.data) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      continue;
    }
    if (event.name === 'content_block_delta' && parsed?.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string') {
      text += parsed.delta.text;
    } else if (event.name === 'message_stop') {
      done = true;
    }
  }
  return { text, done };
}

interface RawSseEvent {
  name: string;
  data: string;
}

function splitSseEvents(chunk: string): RawSseEvent[] {
  const events: RawSseEvent[] = [];
  let current: RawSseEvent = { name: '', data: '' };
  for (const line of chunk.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      current.name = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const piece = line.slice(5).trim();
      current.data = current.data ? `${current.data}\n${piece}` : piece;
    } else if (line === '' && (current.name || current.data)) {
      events.push(current);
      current = { name: '', data: '' };
    }
  }
  if (current.name || current.data) events.push(current);
  return events;
}
