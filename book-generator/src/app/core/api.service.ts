import { Injectable } from '@angular/core';
import { Observable, Subject, from, of, throwError } from 'rxjs';
import { shareReplay, catchError, switchMap, map, tap, retry, delay, take } from 'rxjs/operators';

export interface OpenRouterModel {
  id: string;
  name: string;
  provider: string;
  tier: 'budget' | 'standard' | 'premium';
  contextWindow: string;
  contextWindowNum: number;
  free?: boolean;
  recommended?: boolean;
}

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

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly API_BASE_URL = '/api/openrouter/api/v1/chat/completions';
  private readonly API_KEY_KEY = 'openrouter_api_key';
  private readonly DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:4200',
    'X-Title': 'AutoBook'
  };

  // Models observable with lazy loading and caching
  private models$: Observable<OpenRouterModel[]> | null = null;

  /**
   * Get models observable (lazy initialization)
   * Only fetches from API when first subscribed to
   */
  private getModelsInternal(): Observable<OpenRouterModel[]> {
    return this.fetchModelsFromApi().pipe(
      shareReplay(1),
      catchError(() => {
        // Fallback to hardcoded models if API fails
        return of(this.getFallbackModels());
      })
    );
  }

  // ===== Auth Methods (consolidated from AuthService) =====
  
  /**
   * Save API key to localStorage
   */
  saveApiKey(key: string): void {
    localStorage.setItem(this.API_KEY_KEY, key);
  }

  /**
   * Get API key from localStorage
   */
  getApiKey(): string | null {
    return localStorage.getItem(this.API_KEY_KEY);
  }

  /**
   * Clear API key from localStorage
   */
  clearApiKey(): void {
    localStorage.removeItem(this.API_KEY_KEY);
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    const key = this.getApiKey();
    return key !== null && key.trim().length > 0;
  }

  /**
   * Validate API key format (basic validation)
   */
  isValidApiKey(key: string): boolean {
    return !!key && key.startsWith('sk-') && key.length >= 20;
  }

  // ===== Private Helper Methods =====

  /**
   * Get headers with API key
   */
  private getHeaders(): Record<string, string> | null {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return null;
    }
    return {
      ...this.DEFAULT_HEADERS,
      'Authorization': `Bearer ${apiKey}`
    };
  }

  /**
   * Fetch with error handling
   */
  private fetchJson<T>(url: string, options: RequestInit): Observable<T> {
    const headers = this.getHeaders();
    if (!headers) {
      return throwError(() => new Error('OpenRouter API key not configured'));
    }

    return from(fetch(url, { ...options, headers })).pipe(
      switchMap(response => {
        if (!response.ok) {
          return from(response.text()).pipe(
            switchMap(errorText => {
              console.error('API Error Response:', errorText);
              return throwError(() => new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`));
            })
          );
        }
        return from(response.json() as Promise<T>);
      })
    );
  }

  // ===== API Methods =====

  /**
   * Make a non-streaming chat completion request
   */
  chatCompletion(request: ChatCompletionRequest): Observable<ChatCompletionResponse> {
    return this.fetchJson<ChatCompletionResponse>(this.API_BASE_URL, {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }

  /**
   * Make a streaming chat completion request
   */
  chatCompletionStream(request: ChatCompletionRequest): Observable<string> {
    const headers = this.getHeaders();
    if (!headers) {
      return throwError(() => new Error('OpenRouter API key not configured'));
    }

    const subject = new Subject<string>();

    fetch(this.API_BASE_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({ ...request, stream: true })
    })
    .then(response => {
      if (!response.ok) {
        subject.error(new Error(`API request failed: ${response.status} ${response.statusText}`));
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      const processStream = () => {
        reader?.read().then(({ done, value }) => {
          if (done) {
            subject.complete();
            return;
          }

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                subject.complete();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  subject.next(content);
                }
              } catch (error) {
                console.warn('Failed to parse SSE data:', error);
              }
            }
          }

          processStream();
        }).catch(error => {
          subject.error(error);
        });
      };

      processStream();
    })
    .catch(error => {
      subject.error(error);
    });

    return subject.asObservable();
  }

  /**
   * Fetch models from OpenRouter API as Observable (lazy loaded and cached)
   */
  getModels$(): Observable<OpenRouterModel[]> {
    if (!this.models$) {
      this.models$ = this.getModelsInternal();
    }
    return this.models$;
  }

  /**
   * Fetch models from OpenRouter API - returns Observable
   */
  fetchModelsFromApi(): Observable<OpenRouterModel[]> {
    const headers = this.getHeaders();
    if (!headers) {
      return throwError(() => new Error('API key not configured'));
    }

    return from(fetch('/api/openrouter/api/v1/models', {
      method: 'GET',
      headers
    })).pipe(
      switchMap(response => {
        if (!response.ok) {
          return throwError(() => new Error(`Failed to fetch models: ${response.status} ${response.statusText}`));
        }
        return from(response.json());
      }),
      map((data: any) => {
        // Transform API response to our OpenRouterModel format
        const models: OpenRouterModel[] = (data.data || []).map((model: any) => {
          // Extract provider from model ID (e.g., "anthropic/claude-sonnet-4" -> "Anthropic")
          const provider = model.id.split('/')[0] || 'Unknown';
          const providerDisplay = this.getProviderDisplayName(provider);
          
          // Determine tier based on context length or known models
          const contextLength = model.context_length;
          let tier: 'budget' | 'standard' | 'premium' = 'standard';
          
          if (contextLength && contextLength >= 100000) {
            tier = 'premium';
          } else if (contextLength && contextLength <= 30000) {
            tier = 'budget';
          }

          // Mark recommended models (popular ones)
          const recommended = this.isRecommendedModel(model.id);

          return {
            id: model.id,
            name: model.name || model.id,
            provider: providerDisplay,
            tier,
            contextWindow: model.context_length ? this.formatContextWindow(model.context_length) : 'Unknown',
            contextWindowNum: model.context_length || 0,
            free: model.pricing?.['prompt'] === 0,
            recommended
          };
        });

        // Sort: recommended first, then by tier (premium > standard > budget)
        const tierOrder = { premium: 0, standard: 1, budget: 2 };
        models.sort((a, b) => {
          if (a.recommended && !b.recommended) return -1;
          if (!a.recommended && b.recommended) return 1;
          return tierOrder[a.tier] - tierOrder[b.tier];
        });

        return models;
      })
    );
  }

  /**
   * Get display name for provider
   */
  private getProviderDisplayName(provider: string): string {
    const providerNames: Record<string, string> = {
      'anthropic': 'Anthropic',
      'openai': 'OpenAI',
      'google': 'Google',
      'meta': 'Meta',
      'mistralai': 'Mistral',
      'deepseek': 'DeepSeek',
      'cohere': 'Cohere',
      'perplexity': 'Perplexity',
      'nvidia': 'NVIDIA',
      'amazon': 'Amazon',
      'x-ai': 'xAI',
      'inflection': 'Inflection',
      'ai21': 'AI21',
      'stagehand': 'Stagehand',
      'moonshot': 'Moonshot',
      'zhipuai': 'ZhipuAI',
      'qwen': 'Qwen',
      'yi': 'Yi',
      'arc Maxime': 'Arc Maxime'
    };
    return providerNames[provider.toLowerCase()] || provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  /**
   * Format context window to readable format
   */
  private formatContextWindow(contextLength: number): string {
    if (contextLength >= 1000000) {
      return `${(contextLength / 1000000).toFixed(1)}M`;
    } else if (contextLength >= 1000) {
      return `${Math.round(contextLength / 1000)}k`;
    }
    return contextLength.toString();
  }

  /**
   * Check if model is a recommended/popular model
   */
  private isRecommendedModel(modelId: string): boolean {
    const recommendedPatterns = [
      'claude-3.5',
      'claude-sonnet',
      'claude-opus',
      'gpt-4o',
      'gpt-4-turbo',
      'gemini-1.5',
      'gemini-2.0',
      'llama-3.1-405b',
      'llama-3.3-70b'
    ];
    return recommendedPatterns.some(pattern => modelId.toLowerCase().includes(pattern));
  }

  /**
   * Get model by ID as Observable
   */
  getModelById$(modelId: string): Observable<OpenRouterModel | undefined> {
    return this.getModels$().pipe(
      map(models => models.find(model => model.id === modelId))
    );
  }

  /**
   * Get default model (recommended model) as Observable
   */
  getDefaultModel$(): Observable<OpenRouterModel> {
    return this.getModels$().pipe(
      map(models => {
        const defaultModel = models.find(m => m.recommended) || models[0];
        return defaultModel;
      })
    );
  }

  /**
   * Get model by ID (sync, returns from fallback models)
   * @deprecated Use getModelById$() for fresh data
   */
  getModelById(modelId: string): OpenRouterModel | undefined {
    return this.getFallbackModels().find(model => model.id === modelId);
  }

  /**
   * Get default model (sync, returns from fallback models)
   * @deprecated Use getDefaultModel$() for fresh data
   */
  getDefaultModel(): OpenRouterModel {
    const models = this.getFallbackModels();
    return models.find(m => m.recommended) || models[0];
  }

  /**
   * Fallback models (used when API fetch fails)
   */
  private getFallbackModels(): OpenRouterModel[] {
    return [
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
  }

  /**
   * Test API key by making a simple request - returns Observable
   */
  testApiKey$(apiKey: string): Observable<TestApiKeyResult> {
    const headers = {
      ...this.DEFAULT_HEADERS,
      'Authorization': `Bearer ${apiKey}`
    };

    return from(fetch('/api/openrouter/api/v1/models', {
      method: 'GET',
      headers
    })).pipe(
      switchMap(response => {
        if (!response.ok) {
          if (response.status === 401) {
            return of({ success: false, error: 'Invalid API key' });
          }
          return of({ success: false, error: `API error: ${response.status} ${response.statusText}` });
        }
        return from(response.json()).pipe(
          map(data => ({
            success: true,
            model: data.data?.[0]?.id || 'unknown'
          }))
        );
      }),
      catchError(error => {
        return of({
          success: false,
          error: error instanceof Error ? error.message : 'Network error'
        });
      })
    );
  }

  /**
   * Test API key (Promise-based for backwards compatibility)
   * @deprecated Use testApiKey$() instead
   */
  testApiKey(apiKey: string): Promise<TestApiKeyResult> {
    return new Promise((resolve) => {
      this.testApiKey$(apiKey).pipe(take(1)).subscribe(result => resolve(result));
    });
  }

  /**
   * Validate that a model exists and is available - returns Observable
   */
  validateModel$(modelId: string, apiKey: string): Observable<boolean> {
    const headers = {
      ...this.DEFAULT_HEADERS,
      'Authorization': `Bearer ${apiKey}`
    };

    return from(fetch('/api/openrouter/api/v1/models', {
      method: 'GET',
      headers
    })).pipe(
      switchMap(response => {
        if (!response.ok) {
          return of(false);
        }
        return from(response.json()).pipe(
          map(data => {
            const availableModels = data.data || [];
            return availableModels.some((m: any) => m.id === modelId);
          })
        );
      }),
      catchError(() => of(false))
    );
  }

  /**
   * Validate that a model exists and is available (Promise-based for backwards compatibility)
   * @deprecated Use validateModel$() instead
   */
  validateModel(modelId: string, apiKey: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.validateModel$(modelId, apiKey).pipe(take(1)).subscribe(result => resolve(result));
    });
  }
}
