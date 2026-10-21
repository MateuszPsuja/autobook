import { TestBed } from '@angular/core/testing';
import { ApiService } from './api.service';
import { ProviderService } from './providers/provider.service';
import { extractTextFromAnthropicFrame } from './providers/anthropic.adapter';
import {
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_THINKING_ALLOWANCE,
  transformGeminiModels
} from './providers/gemini.adapter';

describe('ApiService', () => {
  let service: ApiService;
  let providerService: ProviderService;
  const OR_KEY = 'sk-or-test-key-12345678901234567890';
  const ANTH_KEY = 'sk-ant-test-key-12345678901234567890';
  const GEM_KEY = 'AIza-test-key-1234567890123456789012345';

  beforeEach(() => {
    localStorage.clear();

    // Default fetch mock: OpenRouter-style models list.
    spyOn(window, 'fetch').and.returnValue(Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { id: 'openrouter/auto', name: 'Free Models Router', context_length: 0, pricing: { 'prompt': 0 } },
          { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', context_length: 1000000, pricing: { 'prompt': 0 } }
        ]
      })
    } as Response));

    TestBed.configureTestingModule({
      providers: [ApiService, ProviderService]
    });
    service = TestBed.inject(ApiService);
    providerService = TestBed.inject(ProviderService);
  });

  describe('API Key Management', () => {
    it('should save API key to localStorage for the active provider', () => {
      service.saveApiKey(OR_KEY);
      expect(providerService.getApiKey('openrouter')).toBe(OR_KEY);
    });

    it('should retrieve API key from localStorage', () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      expect(service.getApiKey()).toBe(OR_KEY);
    });

    it('should return null when no API key is set', () => {
      expect(service.getApiKey()).toBeNull();
    });

    it('should clear API key from localStorage', () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      service.clearApiKey();
      expect(providerService.getApiKey('openrouter')).toBeNull();
    });
  });

  describe('Configuration Status', () => {
    it('should return false when no provider is configured', () => {
      expect(service.isConfigured()).toBeFalse();
    });

    it('should return true when the active provider is configured', () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      expect(service.isConfigured()).toBeTrue();
    });

    it('should return true for LM Studio without an API key', () => {
      providerService.setActiveProvider('lmstudio');
      expect(service.isConfigured()).toBeTrue();
    });

    it('should return false when active provider has a whitespace key', () => {
      providerService.saveApiKey('   ', 'openrouter');
      expect(service.isConfigured()).toBeFalse();
    });
  });

  describe('API Key Validation', () => {
    it('should validate correct OpenRouter API key format', () => {
      providerService.setActiveProvider('openrouter');
      expect(service.isValidApiKey(OR_KEY)).toBeTrue();
    });

    it('should reject null key', () => {
      expect(service.isValidApiKey(null as any)).toBeFalse();
    });

    it('should reject empty key', () => {
      expect(service.isValidApiKey('')).toBeFalse();
    });

    it('should reject key not starting with sk-', () => {
      providerService.setActiveProvider('openrouter');
      expect(service.isValidApiKey('abc-12345678901234567890')).toBeFalse();
    });

    it('should reject key shorter than the minimum length', () => {
      providerService.setActiveProvider('openrouter');
      expect(service.isValidApiKey('sk-short')).toBeFalse();
    });

    it('should require sk-ant- prefix for Anthropic keys', () => {
      providerService.setActiveProvider('anthropic');
      expect(service.isValidApiKey(OR_KEY)).toBeFalse();
      expect(service.isValidApiKey(ANTH_KEY)).toBeTrue();
    });
  });

  describe('Model Management', () => {
    it('should return list of models for the active provider', (done) => {
      service.getModels$().subscribe(models => {
        expect(models).toBeDefined();
        expect(Array.isArray(models)).toBeTrue();
        expect(models.length).toBeGreaterThan(0);
        done();
      });
    });

    it('should return curated fallback models for Anthropic (no network call)', (done) => {
      providerService.setActiveProvider('anthropic');
      service.getModels$().subscribe(models => {
        expect(models.length).toBeGreaterThan(0);
        const ids = models.map(m => m.id);
        // Curated list contains at least one known Claude model
        expect(ids.some(id => id.includes('claude'))).toBeTrue();
        done();
      });
    });

    it('should get model by ID for the active provider', (done) => {
      service.getModels$().subscribe(models => {
        const firstModel = models[0];
        service.getModelById$(firstModel.id).subscribe(found => {
          expect(found).toEqual(firstModel);
          done();
        });
      });
    });

    it('should return undefined for unknown model ID', (done) => {
      service.getModelById$('unknown/model-id').subscribe(found => {
        expect(found).toBeUndefined();
        done();
      });
    });

    it('should get default model (recommended)', (done) => {
      service.getDefaultModel$().subscribe(defaultModel => {
        expect(defaultModel).toBeDefined();
        expect(defaultModel.recommended).toBeTrue();
        done();
      });
    });
  });

  describe('Model list refresh', () => {
    const modelsResponse = (data: any[]) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data })
    } as Response);

    it('refetches the model list even when it was already cached', (done) => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      const spy = window.fetch as jasmine.Spy;

      service.getModelsForProvider$('openrouter').subscribe({
        next: () => {
          expect(spy.calls.count()).toBe(1);
          spy.and.returnValue(modelsResponse([{ id: 'vendor/second', name: 'Second Model' }]));

          service.refreshModelsForProvider$('openrouter').subscribe({
            next: models => {
              expect(spy.calls.count()).toBe(2);
              expect(models.length).toBe(1);
              expect(models[0].id).toBe('vendor/second');
              done();
            },
            error: done.fail
          });
        },
        error: done.fail
      });
    });

    it('serves the refreshed list from the cache afterwards', (done) => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      const spy = window.fetch as jasmine.Spy;

      service.refreshModelsForProvider$('openrouter').subscribe({
        next: refreshed => {
          const callsAfterRefresh = spy.calls.count();
          service.getModelsForProvider$('openrouter').subscribe({
            next: cached => {
              expect(spy.calls.count()).toBe(callsAfterRefresh);
              expect(cached.map(m => m.id)).toEqual(refreshed.map(m => m.id));
              done();
            },
            error: done.fail
          });
        },
        error: done.fail
      });
    });

    it('surfaces the failure and seeds the curated fallback', (done) => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      const spy = window.fetch as jasmine.Spy;
      spy.and.returnValue(Promise.resolve({ ok: false, status: 500, statusText: 'Server Error' } as Response));

      service.refreshModelsForProvider$('openrouter').subscribe({
        next: () => {
          fail('expected the refresh to fail');
          done();
        },
        error: () => {
          const callsAfterFailure = spy.calls.count();
          service.getModelsForProvider$('openrouter').subscribe({
            next: models => {
              // The curated list is cached, so no extra request is made.
              expect(spy.calls.count()).toBe(callsAfterFailure);
              expect(models.map(m => m.id)).toEqual(service.getFallbackModels('openrouter').map(m => m.id));
              done();
            },
            error: done.fail
          });
        }
      });
    });

    it('exposes the curated fallback list for a provider', () => {
      const fallback = service.getFallbackModels('openrouter');
      expect(fallback.length).toBeGreaterThan(0);
      expect(fallback.every(m => !!m.id)).toBeTrue();
    });
  });

  describe('API Key Testing', () => {
    it('should test valid OpenRouter API key', async () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'test/model' }] })
      } as Response));

      const result = await service.testApiKey(OR_KEY, 'openrouter');
      expect(result.success).toBeTrue();
      expect(result.model).toBe('test/model');
    });

    it('should handle invalid API key (401)', async () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: false,
        status: 401
      } as Response));

      const result = await service.testApiKey(OR_KEY, 'openrouter');
      expect(result.success).toBeFalse();
      expect(result.error).toBe('Invalid API key');
    });

    it('should handle network error', async () => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.reject(new Error('Network error')));
      const result = await service.testApiKey(OR_KEY, 'openrouter');
      expect(result.success).toBeFalse();
      expect(result.error).toBe('Network error');
    });
  });

  describe('Model Validation', () => {
    it('should validate existing model for OpenRouter', async () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'anthropic/claude-3.5' }] })
      } as Response));

      const result = await service.validateModel('anthropic/claude-3.5', OR_KEY, 'openrouter');
      expect(result).toBeTrue();
    });

    it('should reject non-existing model', async () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'anthropic/claude-3.5' }] })
      } as Response));

      const result = await service.validateModel('unknown/model', OR_KEY, 'openrouter');
      expect(result).toBeFalse();
    });

    it('should validate against the curated Anthropic list', async () => {
      const result = await service.validateModel('claude-3-5-haiku-20241022', ANTH_KEY, 'anthropic');
      expect(result).toBeTrue();
    });
  });

  describe('Provider routing', () => {
    it('should expose the registry', () => {
      const ids = service.listProviders().map(p => p.id);
      expect(ids).toContain('openrouter');
      expect(ids).toContain('lmstudio');
      expect(ids).toContain('minimax');
      expect(ids).toContain('anthropic');
      expect(ids).toContain('openai');
      expect(ids).toContain('gemini');
    });

    it('should route chat completions through the active provider base URL', async () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'm',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      } as Response));

      await new Promise<void>((resolve, reject) => {
        service.chatCompletion({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] })
          .subscribe({
            next: () => resolve(),
            error: reject
          });
      });

      const call = (window.fetch as jasmine.Spy).calls.mostRecent();
      // Default openrouter provider should route via the dev proxy path
      // AND keep the OpenRouter `/api/v1` path prefix intact.
      expect(call.args[0]).toBe('/api/openrouter/api/v1/chat/completions');
    });

    it('should preserve the /v1 path prefix when routing through the proxy for Minimax', async () => {
      providerService.setActiveProvider('minimax');
      providerService.saveApiKey(OR_KEY, 'minimax');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'MiniMax-M3',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      } as Response));

      await new Promise<void>((resolve, reject) => {
        service.chatCompletion({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] })
          .subscribe({ next: () => resolve(), error: reject });
      });

      const call = (window.fetch as jasmine.Spy).calls.mostRecent();
      // /api/minimax proxy must include the /v1 segment so the upstream
      // /v1/chat/completions endpoint is hit (not /chat/completions).
      expect(call.args[0]).toBe('/api/minimax/v1/chat/completions');
    });

    it('should hit /v1/models for the Minimax model list', (done) => {
      providerService.setActiveProvider('minimax');
      providerService.saveApiKey(OR_KEY, 'minimax');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'MiniMax-M3' }] })
      } as Response));

      service.getModels$().subscribe({
        next: () => {
          const call = (window.fetch as jasmine.Spy).calls.mostRecent();
          expect(call.args[0]).toBe('/api/minimax/v1/models');
          done();
        },
        error: done.fail
      });
    });

    it('should send `thinking: { type: "disabled" }` on every Minimax chat completion call', async () => {
      providerService.setActiveProvider('minimax');
      providerService.saveApiKey(OR_KEY, 'minimax');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'MiniMax-M3',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      } as Response));

      await new Promise<void>((resolve, reject) => {
        service.chatCompletion({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] })
          .subscribe({ next: () => resolve(), error: reject });
      });

      const call = (window.fetch as jasmine.Spy).calls.mostRecent();
      const body = JSON.parse(call.args[1].body);
      expect(body.thinking).toEqual({ type: 'disabled' });
      // Make sure we didn't accidentally clobber the caller's messages.
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(body.model).toBe('MiniMax-M3');
    });

    it('should NOT add `thinking` to the body for non-Minimax openai-compat providers', async () => {
      providerService.setActiveProvider('openai');
      providerService.saveApiKey(OR_KEY, 'openai');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4o-mini',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      } as Response));

      await new Promise<void>((resolve, reject) => {
        service.chatCompletion({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] })
          .subscribe({ next: () => resolve(), error: reject });
      });

      const call = (window.fetch as jasmine.Spy).calls.mostRecent();
      const body = JSON.parse(call.args[1].body);
      expect(body.thinking).toBeUndefined();
    });

    it('should route Gemini chat completions through the /api/gemini proxy path', async () => {
      providerService.setActiveProvider('gemini');
      providerService.saveApiKey(GEM_KEY, 'gemini');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'gemini-3.8-flash',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      } as Response));

      await new Promise<void>((resolve, reject) => {
        service.chatCompletion({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'hi' }] })
          .subscribe({ next: () => resolve(), error: reject });
      });

      const call = (window.fetch as jasmine.Spy).calls.mostRecent();
      expect(call.args[0]).toBe('/api/gemini/v1beta/openai/chat/completions');
    });

    it('should hit /api/gemini/v1beta/openai/models for the Gemini model list', (done) => {
      providerService.setActiveProvider('gemini');
      providerService.saveApiKey(GEM_KEY, 'gemini');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'gemini-3.8-flash' }] })
      } as Response));

      service.getModels$().subscribe({
        next: () => {
          const call = (window.fetch as jasmine.Spy).calls.mostRecent();
          expect(call.args[0]).toBe('/api/gemini/v1beta/openai/models');
          done();
        },
        error: done.fail
      });
    });

    it('should strip `temperature` for Gemini 3+ models but keep it for 2.5', async () => {
      providerService.setActiveProvider('gemini');
      providerService.saveApiKey(GEM_KEY, 'gemini');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'm',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      } as Response));

      const bodyFor = async (model: string): Promise<any> => {
        await new Promise<void>((resolve, reject) => {
          service.chatCompletion({
            model,
            messages: [{ role: 'user', content: 'hi' }],
            temperature: 0.4
          }).subscribe({ next: () => resolve(), error: reject });
        });
        const call = (window.fetch as jasmine.Spy).calls.mostRecent();
        return JSON.parse(call.args[1].body);
      };

      const modern = await bodyFor('gemini-3.8-flash');
      expect(modern.temperature).toBeUndefined();

      const legacy = await bodyFor('gemini-2.5-flash');
      expect(legacy.temperature).toBe(0.4);
    });

    it('should add the Gemini thinking allowance to max_tokens and clamp it to the output cap', async () => {
      providerService.setActiveProvider('gemini');
      providerService.saveApiKey(GEM_KEY, 'gemini');
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'm',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      } as Response));

      const bodyFor = async (model: string, maxTokens: number): Promise<any> => {
        await new Promise<void>((resolve, reject) => {
          service.chatCompletion({
            model,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: maxTokens
          }).subscribe({ next: () => resolve(), error: reject });
        });
        const call = (window.fetch as jasmine.Spy).calls.mostRecent();
        return JSON.parse(call.args[1].body);
      };

      const thinking = await bodyFor('gemini-3.8-flash', 2000);
      expect(thinking.max_tokens).toBe(2000 + GEMINI_THINKING_ALLOWANCE);

      const clamped = await bodyFor('gemini-3.8-flash', 60000);
      expect(clamped.max_tokens).toBe(GEMINI_MAX_OUTPUT_TOKENS);

      const nonThinking = await bodyFor('gemini-2.0-flash', 2000);
      expect(nonThinking.max_tokens).toBe(2000);
    });

    it('should translate Anthropic SSE into plain text deltas', () => {
      const chunk = [
        'event: message_start',
        'data: {"type":"message_start"}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start"}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        ''
      ].join('\n');

      const out = extractTextFromAnthropicFrame(chunk);
      expect(out.text).toBe('Hello world');
      expect(out.done).toBeTrue();
    });
  });

  describe('Streaming boundary buffering', () => {
    /**
     * Build a `Response` whose `body.getReader()` yields the given
     * string chunks one at a time, then reports `done: true`. Mirrors
     * what the real `fetch` stream looks like when the upstream
     * socket delivers a small buffer per read.
     */
    function makeStreamingResponse(chunks: string[]): Response {
      const encoded = chunks.map(c => new TextEncoder().encode(c));
      let i = 0;
      const reader = {
        read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (i >= encoded.length) {
            return Promise.resolve({ done: true, value: undefined });
          }
          return Promise.resolve({ done: false, value: encoded[i++] });
        },
        releaseLock(): void { /* noop */ },
        cancel(): Promise<void> { return Promise.resolve(); },
        closed: Promise.resolve(undefined)
      };
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: { getReader: () => reader }
      } as unknown as Response;
    }

    it('buffers OpenAI-compat SSE across reader.read() boundaries mid-data-line', async () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      // First chunk ends inside a `data:` JSON value. Second chunk
      // completes it. Without buffering the half-line would be
      // silently dropped and the prose would be truncated.
      const chunks = [
        'data: {"choices":[{"delta":{"content":"hel',
        'lo world"}}]}\n\ndata: [DONE]\n\n'
      ];
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve(makeStreamingResponse(chunks)));

      const emitted: string[] = [];
      await new Promise<void>((resolve, reject) => {
        service.chatCompletionStream({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'hi' }]
        }).subscribe({
          next: v => emitted.push(v),
          error: reject,
          complete: resolve
        });
      });
      expect(emitted.join('')).toBe('hello world');
    });

    it('flushes a trailing partial line when the reader closes for OpenAI-compat', async () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      // No terminating newline before the reader reports done — the
      // flush path must still emit the final delta.
      const chunks = [
        'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}'
      ];
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve(makeStreamingResponse(chunks)));

      const emitted: string[] = [];
      await new Promise<void>((resolve, reject) => {
        service.chatCompletionStream({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'hi' }]
        }).subscribe({
          next: v => emitted.push(v),
          error: reject,
          complete: resolve
        });
      });
      expect(emitted.join('')).toBe('hello world');
    });

    it('stops emitting after [DONE] even if more bytes follow in the same chunk', async () => {
      providerService.saveApiKey(OR_KEY, 'openrouter');
      const chunks = [
        'data: {"choices":[{"delta":{"content":"first"}}]}\n\n' +
          'data: [DONE]\n\n' +
          'data: {"choices":[{"delta":{"content":"ghost"}}]}\n\n'
      ];
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve(makeStreamingResponse(chunks)));

      const emitted: string[] = [];
      await new Promise<void>((resolve, reject) => {
        service.chatCompletionStream({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'hi' }]
        }).subscribe({
          next: v => emitted.push(v),
          error: reject,
          complete: resolve
        });
      });
      expect(emitted.join('')).toBe('first');
    });

    it('buffers Anthropic SSE across reader.read() boundaries mid-event', async () => {
      providerService.setActiveProvider('anthropic');
      providerService.saveApiKey(ANTH_KEY, 'anthropic');
      // First chunk ends inside a `data:` JSON value. Second chunk
      // finishes the event and adds a second one. Without buffering
      // the first event's text_delta would be lost.
      const chunks = [
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hel',
        'lo"}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n'
      ];
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve(makeStreamingResponse(chunks)));

      const emitted: string[] = [];
      await new Promise<void>((resolve, reject) => {
        service.chatCompletionStream({
          model: 'claude-3-5-haiku-20241022',
          messages: [{ role: 'user', content: 'hi' }]
        }).subscribe({
          next: v => emitted.push(v),
          error: reject,
          complete: resolve
        });
      });
      expect(emitted.join('')).toBe('hello world');
    });

    it('flushes a trailing partial Anthropic event when the reader closes', async () => {
      providerService.setActiveProvider('anthropic');
      providerService.saveApiKey(ANTH_KEY, 'anthropic');
      // No trailing blank line before the reader reports done — the
      // flush path must still emit the final text_delta.
      const chunks = [
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello world"}}'
      ];
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve(makeStreamingResponse(chunks)));

      const emitted: string[] = [];
      await new Promise<void>((resolve, reject) => {
        service.chatCompletionStream({
          model: 'claude-3-5-haiku-20241022',
          messages: [{ role: 'user', content: 'hi' }]
        }).subscribe({
          next: v => emitted.push(v),
          error: reject,
          complete: resolve
        });
      });
      expect(emitted.join('')).toBe('hello world');
    });
  });

  describe('Gemini model list transform', () => {
    it('filters non-chat Gemini models out of the live model list', () => {
      const models = transformGeminiModels([
        { id: 'gemini-3.8-flash' },
        { id: 'gemini-3.5-flash-lite' },
        { id: 'gemini-3.1-pro-preview' },
        { id: 'gemini-embedding-001' },
        { id: 'imagen-4.0-generate' },
        { id: 'gemini-2.0-flash-preview-image' },
        { id: 'gemini-2.5-flash-tts' },
        { id: 'veo-3.0-generate' }
      ]);

      const ids = models.map(m => m.id);
      expect(ids).toContain('gemini-3.8-flash');
      expect(ids).toContain('gemini-3.5-flash-lite');
      expect(ids).not.toContain('gemini-embedding-001');
      expect(ids.some(id => id.includes('imagen'))).toBeFalse();
      expect(ids.some(id => id.includes('tts'))).toBeFalse();
      expect(ids.some(id => id.includes('veo'))).toBeFalse();
      expect(ids.some(id => id.includes('image'))).toBeFalse();
    });

    it('classifies Gemini models into tiers and marks the recommended one', () => {
      const models = transformGeminiModels([
        { id: 'gemini-3.8-flash' },
        { id: 'gemini-3.5-flash-lite' },
        { id: 'gemini-3.1-pro-preview' }
      ]);

      const flash = models.find(m => m.id === 'gemini-3.8-flash');
      expect(flash?.tier).toBe('standard');
      expect(flash?.recommended).toBeTrue();
      expect(flash?.name).toBe('Gemini 3.8 Flash');
      expect(flash?.contextWindow).toBe('1M');

      expect(models.find(m => m.id === 'gemini-3.5-flash-lite')?.tier).toBe('budget');
      expect(models.find(m => m.id === 'gemini-3.1-pro-preview')?.tier).toBe('premium');

      // Recommended model sorts first.
      expect(models[0].id).toBe('gemini-3.8-flash');
    });
  });
});
