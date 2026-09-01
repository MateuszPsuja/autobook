/**
 * Provider abstraction for the multi-LLM support.
 *
 * Each provider has a stable `id` (used in localStorage and as the routing key),
 * a display `name`, and a `protocol` that determines how the service talks to it.
 *
 * - `openai-compat` providers share the OpenAI Chat Completions shape
 *   (LM Studio, Minimax, OpenAI, OpenRouter). Differences are the base URL
 *   and auth header behavior.
 * - `anthropic` providers use Anthropic's native Messages API which has a
 *   different request/response shape and SSE event names. The service layer
 *   adapts between OpenAI-shape and Anthropic-shape so callers don't have to.
 *
 * `requiresApiKey` is false for LM Studio (local server, no auth by default)
 * and for any provider the user is expected to run themselves with auth disabled.
 *
 * `keyValidation` lets a provider enforce additional rules beyond the generic
 * 20-char minimum (e.g. Anthropic keys start with `sk-ant-`).
 *
 * URL anatomy — important for routing through the dev-server proxy:
 *   direct call : `${baseUrl}${endpoint}` (e.g. `https://api.openai.com/v1/chat/completions`)
 *   via proxy   : `${proxyPath}${endpoint}`
 * The dev proxy's `pathRewrite` strips the proxy prefix and forwards the
 * rest to `baseUrl`'s host. To make the rewrite a clean host-strip, the
 * `proxyPath` and `baseUrl` host-port segments are kept parallel — the
 * path beyond the host is identical in both, so the request always hits
 * the right path on the upstream.
 */
export type ProviderProtocol = 'openai-compat' | 'anthropic';

export interface ProviderKeyValidation {
  /** Required key prefix, e.g. 'sk-ant-' for Anthropic. */
  prefix?: string;
  /** Minimum key length. Defaults to 20 if unspecified. */
  minLength?: number;
}

export interface LLMProvider {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  /**
   * Full API base URL (host + path). Examples:
   *   `https://api.openai.com/v1`
   *   `https://openrouter.ai/api/v1`
   *   `http://localhost:1234/v1`
   * No trailing slash.
   */
  baseUrl: string;
  /**
   * Dev-server proxy path that mirrors `baseUrl`. Examples:
   *   `/api/openai`      (for `https://api.openai.com/v1`)
   *   `/api/openrouter`  (for `https://openrouter.ai/api/v1`)
   *   `/api/lmstudio`    (for `http://localhost:1234/v1`)
   * The path beyond the host prefix must match `baseUrl`'s path so the
   * proxy's pathRewrite (which only strips the host prefix) leaves the
   * right path on the wire. See proxy.conf.json for the rewrites.
   */
  proxyPath?: string;
  /**
   * Provider-specific request-body fields merged into every chat
   * completion call (both streaming and non-streaming). Use this for
   * vendor extensions that don't fit the OpenAI base shape — e.g.
   * Minimax's `thinking: { type: 'disabled' }` to turn off the
   * default-on reasoning mode that would otherwise eat the
   * `max_tokens` budget before any prose is produced.
   *
   * Keys here override the caller's request (e.g. `temperature`,
   * `max_tokens`) by design — the provider's preferred settings
   * win over the agent's defaults.
   */
  extraRequestBody?: Record<string, unknown>;
  requiresApiKey: boolean;
  /** True when the baseUrl can be overridden by the user (e.g. LM Studio on a custom port). */
  baseUrlEditable: boolean;
  /** Default baseUrl shown to the user; same as `baseUrl` in practice. */
  defaultBaseUrl: string;
  /** Validation rules for the API key. */
  keyValidation?: ProviderKeyValidation;
  /**
   * Static model list used as a fallback when `/models` can't be reached.
   * Required for Anthropic (no public list endpoint for normal keys).
   */
  fallbackModels: LLMModel[];
  /** Where the human goes to get an API key. Shown in the help block. */
  getKeyUrl?: string;
  /** Short blurb shown under the provider name. */
  description: string;
}

export interface LLMModel {
  id: string;
  name: string;
  /** Upstream vendor (Anthropic, OpenAI, Meta, ...) — purely for display. */
  provider: string;
  tier: 'budget' | 'standard' | 'premium';
  contextWindow: string;
  contextWindowNum: number;
  free?: boolean;
  recommended?: boolean;
}

/**
 * Per-provider user config stored in localStorage under one JSON object.
 * Only fields relevant for the provider's protocol are populated
 * (e.g. `apiKey` is null for LM Studio).
 */
export interface ProviderConfig {
  apiKey?: string | null;
  baseUrl?: string | null;
  /** Selected model id for this provider. */
  model?: string | null;
}

export type ProviderConfigMap = Partial<Record<string, ProviderConfig>>;
