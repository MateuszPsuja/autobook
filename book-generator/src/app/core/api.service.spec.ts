import { TestBed } from '@angular/core/testing';
import { ApiService } from './api.service';

describe('ApiService', () => {
  let service: ApiService;
  const API_KEY = 'sk-or-test-key-12345678901234567890';

  // Mock fetch at the start of each test suite to prevent actual API calls
  beforeEach(() => {
    // Reset localStorage before setting up the mock
    localStorage.clear();
    
    // Mock fetch to return successful response with models
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
      providers: [ApiService]
    });
    service = TestBed.inject(ApiService);
  });

  describe('API Key Management', () => {
    it('should save API key to localStorage', () => {
      service.saveApiKey(API_KEY);
      expect(localStorage.getItem('openrouter_api_key')).toBe(API_KEY);
    });

    it('should retrieve API key from localStorage', () => {
      localStorage.setItem('openrouter_api_key', API_KEY);
      expect(service.getApiKey()).toBe(API_KEY);
    });

    it('should return null when no API key is set', () => {
      expect(service.getApiKey()).toBeNull();
    });

    it('should clear API key from localStorage', () => {
      localStorage.setItem('openrouter_api_key', API_KEY);
      service.clearApiKey();
      expect(localStorage.getItem('openrouter_api_key')).toBeNull();
    });
  });

  describe('Configuration Status', () => {
    it('should return false when API key is not configured', () => {
      expect(service.isConfigured()).toBeFalse();
    });

    it('should return true when API key is configured', () => {
      localStorage.setItem('openrouter_api_key', API_KEY);
      expect(service.isConfigured()).toBeTrue();
    });

    it('should return false when API key is empty string', () => {
      localStorage.setItem('openrouter_api_key', '');
      expect(service.isConfigured()).toBeFalse();
    });

    it('should return false when API key is only whitespace', () => {
      localStorage.setItem('openrouter_api_key', '   ');
      expect(service.isConfigured()).toBeFalse();
    });
  });

  describe('API Key Validation', () => {
    it('should validate correct API key format', () => {
      expect(service.isValidApiKey(API_KEY)).toBeTrue();
    });

    it('should reject null key', () => {
      expect(service.isValidApiKey(null as any)).toBeFalse();
    });

    it('should reject empty key', () => {
      expect(service.isValidApiKey('')).toBeFalse();
    });

    it('should reject key not starting with sk-', () => {
      expect(service.isValidApiKey('abc-12345678901234567890')).toBeFalse();
    });

    it('should reject key shorter than 20 characters', () => {
      expect(service.isValidApiKey('sk-short')).toBeFalse();
    });
  });

  describe('Model Management', () => {
    it('should return list of models', (done) => {
      service.getModels$().subscribe(models => {
        expect(models).toBeDefined();
        expect(Array.isArray(models)).toBeTrue();
        expect(models.length).toBeGreaterThan(0);
        done();
      });
    });

    it('should have recommended model marked', (done) => {
      service.getModels$().subscribe(models => {
        const recommended = models.find(m => m.recommended);
        expect(recommended).toBeDefined();
        done();
      });
    });

    it('should get model by ID', (done) => {
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

    it('should get default model', (done) => {
      service.getDefaultModel$().subscribe(defaultModel => {
        expect(defaultModel).toBeDefined();
        expect(defaultModel.recommended).toBeTrue();
        done();
      });
    });
  });

  describe('API Key Testing', () => {
    it('should test valid API key', async () => {
      // Mock fetch to return success - use spy().and.callFake to modify existing spy
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'test/model' }] })
      } as Response));

      const result = await service.testApiKey(API_KEY);
      expect(result.success).toBeTrue();
      expect(result.model).toBe('test/model');
    });

    it('should handle invalid API key', async () => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: false,
        status: 401
      } as Response));

      const result = await service.testApiKey('sk-invalid-key-12345678901234');
      expect(result.success).toBeFalse();
      expect(result.error).toBe('Invalid API key');
    });

    it('should handle network error', async () => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.reject(new Error('Network error')));

      const result = await service.testApiKey(API_KEY);
      expect(result.success).toBeFalse();
      expect(result.error).toBe('Network error');
    });
  });

  describe('Model Validation', () => {
    it('should validate existing model', async () => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'anthropic/claude-3.5' }] })
      } as Response));

      const result = await service.validateModel('anthropic/claude-3.5', API_KEY);
      expect(result).toBeTrue();
    });

    it('should reject non-existing model', async () => {
      (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'anthropic/claude-3.5' }] })
      } as Response));

      const result = await service.validateModel('unknown/model', API_KEY);
      expect(result).toBeFalse();
    });
  });
});
