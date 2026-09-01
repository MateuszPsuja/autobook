import { TestBed } from '@angular/core/testing';
import { ApiService } from './api.service';
import { ProviderService } from './providers/provider.service';
import { parseAnthropicStreamChunk } from './providers/anthropic.adapter';

describe('ApiService', () => {
  let service: ApiService;
  let providerService: ProviderService;
  const OR_KEY = 'sk-or-test-key-12345678901234567890';
  const ANTH_KEY = 'sk-ant-test-key-12345678901234567890';

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

  describe('Generation preferences', () => {
    it('defaults skipPostChecks to false', () => {
      expect(providerService.skipPostChecks()).toBeFalse();
    });

    it('persists skipPostChanges to localStorage and round-trips', () => {
      providerService.setSkipPostChecks(true);
      expect(providerService.skipPostChecks()).toBeTrue();
      // Re-read after a fresh service instance: the value must come
      // back from localStorage so the orchestrator picks it up after
      // a page reload.
      const fresh = new ProviderService();
      expect(fresh.skipPostChecks()).toBeTrue();
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

      const out = parseAnthropicStreamChunk(chunk);
      expect(out.text).toBe('Hello world');
      expect(out.done).toBeTrue();
    });
  });
});
