import { Injectable, inject } from '@angular/core';
import { Observable, Subject, from, of, throwError } from 'rxjs';
import { shareReplay, catchError, switchMap, map } from 'rxjs/operators';
import { LLMModel, LLMProvider, ProviderProtocol } from './providers/provider.types';
import { LLM_PROVIDERS, LLM_PROVIDERS_BY_ID, getProvider } from './providers/providers';
import { ProviderService } from './providers/provider.service';
import {
  fromAnthropicResponse,
  parseAnthropicStreamChunk,
  toAnthropicRequest,
  AnthropicResponse
} from './providers/anthropic.adapter';

// Re-export the canonical model type under the legacy name so the rest of
// the codebase (settings, config component) doesn't have to rename imports.
export type OpenRouterModel = LLMModel;
export type { LLMModel };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: ChatMessage;
    finish_reason: string;
    index: number;
  }>;
  created: number;
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ApiResponse<T> {
  data: T;
  usage: TokenUsage;
}

export interface TestApiKeyResult {
  success: boolean;
  error?: string;
  model?: string;
}

interface ProviderEndpoints {
  /** Path to the chat completions endpoint, relative to the API base. */
  chatCompletions: string;
  /** Path to the models listing endpoint, relative to the API base. */
  models: string;
}

const ENDPOINTS: Record<ProviderProtocol, ProviderEndpoints> = {
  'openai-compat': { chatCompletions: '/chat/completions', models: '/models' },
  anthropic: { chatCompletions: '/messages', models: '/models' }
};

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly providerService = inject(ProviderService);

  /**
   * The browser-side referer / title defaults. Derived from the current
   * origin so production deploys report the real host to upstream APIs.
   * Empty string as a safe fallback if `window` is ever missing
   * (SSR / tests).
   */
  private readonly DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
    'X-Title': 'AutoBook'
  };

  // === Cached model lists per provider ===
  private modelsCache = new Map<string, Observable<LLMModel[]>>();

  // ===== Auth / Provider passthrough =====

  /**
   * Save API key for the active provider. Kept for backwards compat with
   * callers that didn't know about multi-provider support.
   */
  saveApiKey(key: string): void {
    this.providerService.saveApiKey(key);
  }

  /**
   * Get API key for the active provider.
   */
  getApiKey(): string | null {
    return this.providerService.getApiKey();
  }

  clearApiKey(): void {
    this.providerService.clearApiKey();
  }

  isConfigured(): boolean {
    if (!this.providerService.isActiveConfigured()) return false;
    // Whitespace-only keys are not really configured even though the user
    // "saved" something. Match the legacy behaviour here.
    const key = this.getApiKey();
    if (key !== null && key.trim().length === 0) return false;
    return true;
  }

  isValidApiKey(key: string): boolean {
    if (!key) return false;
    const provider = this.providerService.getActiveProvider();
    const validation = provider.keyValidation ?? {};
    if (validation.prefix && !key.startsWith(validation.prefix)) return false;
    const min = validation.minLength ?? 20;
    return key.length >= min;
  }

  // ===== Chat completions =====

  /**
   * Make a non-streaming chat completion request against the active provider.
   * For Anthropic, the request is translated through the adapter; for
   * OpenAI-compat providers, the request body is passed through as-is.
   */
  chatCompletion(request: ChatCompletionRequest): Observable<ChatCompletionResponse> {
    const provider = this.providerService.getActiveProvider();
    if (provider.protocol === 'anthropic') {
      return this.anthropicChatCompletion(request, provider);
    }
    return this.openaiCompatChatCompletion(request, provider);
  }

  /**
   * Make a streaming chat completion request against the active provider.
   * Yields plain text deltas regardless of upstream protocol.
   */
  chatCompletionStream(request: ChatCompletionRequest): Observable<string> {
    const provider = this.providerService.getActiveProvider();
    if (provider.protocol === 'anthropic') {
      return this.anthropicChatCompletionStream(request, provider);
    }
    return this.openaiCompatChatCompletionStream(request, provider);
  }

  private openaiCompatChatCompletion(
    request: ChatCompletionRequest,
    provider: LLMProvider
  ): Observable<ChatCompletionResponse> {
    const apiKey = this.providerService.getApiKey(provider.id);
    if (provider.requiresApiKey && !apiKey) {
      return throwError(() => new Error(`${provider.name} API key not configured`));
    }
    const url = this.buildEndpoint(provider, ENDPOINTS[provider.protocol].chatCompletions);
    const body = this.mergeProviderBody(request, provider);
    return this.fetchJson<ChatCompletionResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      provider,
      apiKey
    });
  }

  private openaiCompatChatCompletionStream(
    request: ChatCompletionRequest,
    provider: LLMProvider
  ): Observable<string> {
    const apiKey = this.providerService.getApiKey(provider.id);
    if (provider.requiresApiKey && !apiKey) {
      return throwError(() => new Error(`${provider.name} API key not configured`));
    }
    const url = this.buildEndpoint(provider, ENDPOINTS[provider.protocol].chatCompletions);
    const body = this.mergeProviderBody({ ...request, stream: true }, provider);
    return this.streamOpenAiCompat(url, body, provider, apiKey);
  }

  private anthropicChatCompletion(
    request: ChatCompletionRequest,
    provider: LLMProvider
  ): Observable<ChatCompletionResponse> {
    const apiKey = this.providerService.getApiKey(provider.id);
    if (!apiKey) {
      return throwError(() => new Error(`${provider.name} API key not configured`));
    }
    const baseUrl = this.resolveBaseUrl(provider);
    const adapted = toAnthropicRequest(request, apiKey, baseUrl, false);
    return this.fetchJson<AnthropicResponse>(adapted.url, {
      method: 'POST',
      body: adapted.body,
      provider,
      apiKey,
      extraHeaders: { 'x-api-key': apiKey, 'anthropic-version': adapted.headers['anthropic-version']! }
    }).pipe(map(fromAnthropicResponse));
  }

  private anthropicChatCompletionStream(
    request: ChatCompletionRequest,
    provider: LLMProvider
  ): Observable<string> {
    const apiKey = this.providerService.getApiKey(provider.id);
    if (!apiKey) {
      return throwError(() => new Error(`${provider.name} API key not configured`));
    }
    const baseUrl = this.resolveBaseUrl(provider);
    const adapted = toAnthropicRequest(request, apiKey, baseUrl, true);
    return this.streamAnthropic(adapted.url, adapted.body, apiKey, adapted.headers['anthropic-version']!);
  }

  // ===== HTTP plumbing =====

  /**
   * Resolve the effective base URL for a provider. The proxy path is
   * preferred in dev (CORS) and falls back to the user-configured /
   * provider-default base URL. The returned string has no trailing slash.
   *
   * Public so sibling services (e.g. `MinimaxImageService`) can reuse the
   * exact same URL-resolution rule instead of duplicating it and drifting
   * over time. Callers should pass the provider object obtained from
   * `getProvider()` so the result is identical to what chat completions
   * would use.
   */
  resolveBaseUrl(provider: LLMProvider): string {
    const override = this.providerService.getConfig(provider.id).baseUrl;
    if (provider.baseUrlEditable && override && override.trim().length > 0) {
      return override.replace(/\/+$/, '');
    }
    if (provider.proxyPath) return provider.proxyPath;
    return provider.baseUrl;
  }

  /**
   * Build the full URL for an endpoint by appending the endpoint path
   * to the resolved base URL.
   */
  private buildEndpoint(provider: LLMProvider, endpoint: string): string {
    const base = this.resolveBaseUrl(provider);
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${base}${path}`;
  }

  /**
   * Merge a caller's chat completion request with the provider's
   * vendor-specific extensions (`extraRequestBody`). Provider fields
   * win over caller fields — the registry is the source of truth for
   * per-provider quirks like Minimax's `thinking` toggle.
   */
  private mergeProviderBody(request: ChatCompletionRequest, provider: LLMProvider): Record<string, unknown> {
    return {
      ...request,
      ...(provider.extraRequestBody ?? {})
    };
  }

  private buildHeaders(provider: LLMProvider, apiKey: string | null, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...this.DEFAULT_HEADERS, ...(extra ?? {}) };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    return headers;
  }

  private fetchJson<T>(url: string, options: RequestInit & { provider: LLMProvider; apiKey: string | null; extraHeaders?: Record<string, string> }): Observable<T> {
    const { provider, apiKey, extraHeaders, ...rest } = options;
    const headers = this.buildHeaders(provider, apiKey, extraHeaders);
    return from(fetch(url, { ...rest, headers })).pipe(
      switchMap(response => {
        if (!response.ok) {
          return from(response.text()).pipe(
            switchMap(errorText => {
              console.error(`${provider.name} API error (${response.status}):`, errorText);
              return throwError(() => new Error(`${provider.name} request failed: ${response.status} ${response.statusText} - ${errorText}`));
            })
          );
        }
        return from(response.json() as Promise<T>);
      })
    );
  }

  private streamOpenAiCompat(
    url: string,
    body: unknown,
    provider: LLMProvider,
    apiKey: string | null
  ): Observable<string> {
    const subject = new Subject<string>();
    const headers: Record<string, string> = {
      ...this.buildHeaders(provider, apiKey),
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache'
    };

    fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
      .then(response => {
        if (!response.ok) {
          subject.error(new Error(`${provider.name} stream request failed: ${response.status} ${response.statusText}`));
          return;
        }
        const reader = response.body?.getReader();
        if (!reader) {
          subject.error(new Error(`${provider.name} stream response missing body`));
          return;
        }
        const decoder = new TextDecoder();
        const process = () => {
          reader.read().then(({ done, value }) => {
            if (done) {
              subject.complete();
              return;
            }
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  subject.complete();
                  return;
                }
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) subject.next(content);
                } catch {
                  /* ignore malformed SSE line */
                }
              }
            }
            process();
          }).catch(err => subject.error(err));
        };
        process();
      })
      .catch(err => subject.error(err));
    return subject.asObservable();
  }

  private streamAnthropic(url: string, body: string, apiKey: string, anthropicVersion: string): Observable<string> {
    const subject = new Subject<string>();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': anthropicVersion,
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache'
    };
    fetch(url, { method: 'POST', headers, body })
      .then(response => {
        if (!response.ok) {
          subject.error(new Error(`Anthropic stream request failed: ${response.status} ${response.statusText}`));
          return;
        }
        const reader = response.body?.getReader();
        if (!reader) {
          subject.error(new Error('Anthropic stream response missing body'));
          return;
        }
        const decoder = new TextDecoder();
        const process = () => {
          reader.read().then(({ done, value }) => {
            if (done) {
              subject.complete();
              return;
            }
            const chunk = decoder.decode(value, { stream: true });
            const { text } = parseAnthropicStreamChunk(chunk);
            if (text) subject.next(text);
            process();
          }).catch(err => subject.error(err));
        };
        process();
      })
      .catch(err => subject.error(err));
    return subject.asObservable();
  }

  // ===== Model management =====

  /**
   * Fetch models for the active provider. Lazy-loaded and cached per
   * provider id so the dropdown doesn't refetch on every settings
   * render.
   */
  getModels$(): Observable<LLMModel[]> {
    const provider = this.providerService.getActiveProvider();
    return this.getModelsForProvider$(provider.id);
  }

  getModelsForProvider$(providerId: string): Observable<LLMModel[]> {
    const cached = this.modelsCache.get(providerId);
    if (cached) return cached;
    const provider = getProvider(providerId) ?? this.providerService.getActiveProvider();
    const stream$ = this.fetchModelsFromApi(provider).pipe(
      shareReplay(1),
      catchError(() => of(this.normalizeFallbackModels(provider)))
    );
    this.modelsCache.set(providerId, stream$);
    return stream$;
  }

  getModelById$(modelId: string, providerId?: string): Observable<LLMModel | undefined> {
    const id = providerId ?? this.providerService.getActiveProviderId();
    return this.getModelsForProvider$(id).pipe(map(models => models.find(m => m.id === modelId)));
  }

  getDefaultModel$(): Observable<LLMModel> {
    return this.getModels$().pipe(
      map(models => models.find(m => m.recommended) ?? models[0])
    );
  }

  /**
   * Sync getter, returns from the active provider's fallback list. Used
   * during initial render before the async list resolves.
   */
  getDefaultModel(): LLMModel {
    const provider = this.providerService.getActiveProvider();
    return this.normalizeFallbackModels(provider).find(m => m.recommended) ?? this.normalizeFallbackModels(provider)[0];
  }

  getModelById(modelId: string, providerId?: string): LLMModel | undefined {
    const provider = getProvider(providerId ?? this.providerService.getActiveProviderId());
    if (!provider) return undefined;
    return this.normalizeFallbackModels(provider).find(m => m.id === modelId);
  }

  private normalizeFallbackModels(provider: LLMProvider): LLMModel[] {
    if (provider.fallbackModels.length > 0) return provider.fallbackModels;
    // LM Studio has no hardcoded list (model ids are user-specific).
    // Return a single placeholder so the UI has something to show.
    return [
      {
        id: '__placeholder__',
        name: 'No model loaded',
        provider: provider.name,
        tier: 'standard',
        contextWindow: 'Unknown',
        contextWindowNum: 0
      }
    ];
  }

  private fetchModelsFromApi(provider: LLMProvider): Observable<LLMModel[]> {
    if (provider.requiresApiKey && !this.providerService.getApiKey(provider.id)) {
      return throwError(() => new Error(`${provider.name} API key not configured`));
    }
    if (provider.protocol === 'anthropic') {
      // Anthropic's /v1/models requires an admin key. We skip the network
      // call and return the curated fallback list instead so the user
      // still has something to pick from.
      return of(this.normalizeFallbackModels(provider));
    }
    const apiKey = this.providerService.getApiKey(provider.id);
    const url = this.buildEndpoint(provider, ENDPOINTS[provider.protocol].models);
    const headers = this.buildHeaders(provider, apiKey);

    return from(fetch(url, { method: 'GET', headers })).pipe(
      switchMap(response => {
        if (!response.ok) {
          return throwError(() => new Error(`Failed to fetch ${provider.name} models: ${response.status} ${response.statusText}`));
        }
        return from(response.json());
      }),
      map((data: any) => {
        const raw: any[] = data?.data ?? [];
        if (provider.id === 'openrouter') {
          return this.transformOpenRouterModels(raw);
        }
        return this.transformOpenAiCompatModels(raw, provider);
      })
    );
  }

  private transformOpenRouterModels(raw: any[]): LLMModel[] {
    const models: LLMModel[] = raw.map((model: any) => {
      const providerSlug = model.id?.split('/')[0] ?? 'Unknown';
      const providerDisplay = this.providerDisplayName(providerSlug);
      const contextLength: number = model.context_length ?? 0;
      let tier: 'budget' | 'standard' | 'premium' = 'standard';
      if (contextLength >= 100000) tier = 'premium';
      else if (contextLength > 0 && contextLength <= 30000) tier = 'budget';
      return {
        id: model.id,
        name: model.name ?? model.id,
        provider: providerDisplay,
        tier,
        contextWindow: contextLength ? this.formatContextWindow(contextLength) : 'Unknown',
        contextWindowNum: contextLength,
        free: model.pricing?.['prompt'] === 0,
        recommended: this.isRecommendedOpenRouter(model.id)
      };
    });
    const tierOrder = { premium: 0, standard: 1, budget: 2 };
    models.sort((a, b) => {
      if (a.recommended && !b.recommended) return -1;
      if (!a.recommended && b.recommended) return 1;
      return tierOrder[a.tier] - tierOrder[b.tier];
    });
    return models;
  }

  private transformOpenAiCompatModels(raw: any[], provider: LLMProvider): LLMModel[] {
    return raw.map((model: any) => {
      const id: string = model.id ?? model.name ?? '';
      return {
        id,
        name: model.name ?? id,
        provider: provider.name,
        tier: 'standard',
        contextWindow: 'Unknown',
        contextWindowNum: 0
      };
    });
  }

  private isRecommendedOpenRouter(modelId: string): boolean {
    const patterns = [
      'claude-3.5', 'claude-sonnet', 'claude-opus',
      'gpt-4o', 'gpt-4-turbo',
      'gemini-1.5', 'gemini-2.0',
      'llama-3.1-405b', 'llama-3.3-70b'
    ];
    return patterns.some(p => modelId.toLowerCase().includes(p));
  }

  private providerDisplayName(slug: string): string {
    const map: Record<string, string> = {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google',
      meta: 'Meta',
      mistralai: 'Mistral',
      deepseek: 'DeepSeek',
      cohere: 'Cohere',
      perplexity: 'Perplexity',
      nvidia: 'NVIDIA',
      amazon: 'Amazon',
      'x-ai': 'xAI',
      qwen: 'Qwen',
      yi: 'Yi',
      moonshot: 'Moonshot'
    };
    return map[slug.toLowerCase()] ?? (slug.charAt(0).toUpperCase() + slug.slice(1));
  }

  private formatContextWindow(length: number): string {
    if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(1)}M`;
    if (length >= 1000) return `${Math.round(length / 1000)}k`;
    return length.toString();
  }

  // ===== API key testing =====

  testApiKey$(apiKey: string, providerId?: string): Observable<TestApiKeyResult> {
    const provider = getProvider(providerId ?? this.providerService.getActiveProviderId()) ?? this.providerService.getActiveProvider();
    if (provider.requiresApiKey && !apiKey) {
      return of({ success: false, error: 'API key required' });
    }
    if (provider.protocol === 'anthropic') {
      // No public list endpoint for normal keys. Validate by sending a
      // tiny completion request.
      return this.testAnthropicKey$(apiKey, provider);
    }
    const url = this.buildEndpoint(provider, ENDPOINTS[provider.protocol].models);
    const headers = this.buildHeaders(provider, apiKey);
    return from(fetch(url, { method: 'GET', headers })).pipe(
      switchMap(response => {
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            return of({ success: false, error: 'Invalid API key' } as TestApiKeyResult);
          }
          return of({ success: false, error: `API error: ${response.status} ${response.statusText}` } as TestApiKeyResult);
        }
        return from(response.json()).pipe(
          map((data: any) => ({ success: true, model: data?.data?.[0]?.id ?? 'unknown' } as TestApiKeyResult))
        );
      }),
      catchError(err => of({ success: false, error: err instanceof Error ? err.message : 'Network error' } as TestApiKeyResult))
    );
  }

  private testAnthropicKey$(apiKey: string, provider: LLMProvider): Observable<TestApiKeyResult> {
    const baseUrl = this.resolveBaseUrl(provider);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };
    const body = JSON.stringify({
      model: provider.fallbackModels[0]?.id ?? 'claude-3-5-haiku-20241022',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }]
    });
    return from(fetch(`${baseUrl.replace(/\/+$/, '')}/messages`, { method: 'POST', headers, body })).pipe(
      switchMap(response => {
        if (!response.ok) {
          if (response.status === 401) return of({ success: false, error: 'Invalid API key' } as TestApiKeyResult);
          return of({ success: false, error: `API error: ${response.status} ${response.statusText}` } as TestApiKeyResult);
        }
        return of({ success: true, model: provider.fallbackModels[0]?.id ?? 'claude' } as TestApiKeyResult);
      }),
      catchError(err => of({ success: false, error: err instanceof Error ? err.message : 'Network error' } as TestApiKeyResult))
    );
  }

  /**
   * Promise-based test entry point kept for backwards compatibility.
   */
  testApiKey(apiKey: string, providerId?: string): Promise<TestApiKeyResult> {
    return new Promise(resolve => {
      this.testApiKey$(apiKey, providerId).subscribe({
        next: result => resolve(result),
        error: err => resolve({ success: false, error: err?.message ?? 'Unknown error' })
      });
    });
  }

  /**
   * Validate a model exists for the given provider. For OpenAI-compat
   * providers, hits `/models` and looks for the id. For Anthropic, the
   * curated fallback list is the source of truth.
   */
  validateModel$(modelId: string, apiKey: string, providerId?: string): Observable<boolean> {
    const provider = getProvider(providerId ?? this.providerService.getActiveProviderId()) ?? this.providerService.getActiveProvider();
    if (provider.protocol === 'anthropic') {
      return of(provider.fallbackModels.some(m => m.id === modelId));
    }
    return this.getModelsForProvider$(provider.id).pipe(map(models => models.some(m => m.id === modelId)));
  }

  validateModel(modelId: string, apiKey: string, providerId?: string): Promise<boolean> {
    return new Promise(resolve => {
      this.validateModel$(modelId, apiKey, providerId).subscribe({
        next: v => resolve(v),
        error: () => resolve(false)
      });
    });
  }

  /** Expose the registry to the rest of the app for UI display. */
  listProviders(): LLMProvider[] {
    return LLM_PROVIDERS;
  }

  getProviderById(id: string): LLMProvider | undefined {
    return LLM_PROVIDERS_BY_ID[id];
  }
}
