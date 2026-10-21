import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { SettingsComponent } from './settings.component';
import { TranslationService } from '../../i18n/translation.service';
import { ApiService } from '../../core/api.service';
import { ProviderService } from '../../core/providers/provider.service';
import { LLMProvider, LLMModel } from '../../core/providers/provider.types';

const PROVIDER: LLMProvider = {
  id: 'openrouter',
  name: 'OpenRouter',
  description: 'OpenRouter',
  protocol: 'openai-compat',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  baseUrlEditable: false,
  requiresApiKey: true,
  fallbackModels: []
};

const model = (id: string): LLMModel => ({
  id,
  name: id,
  provider: 'OpenRouter',
  tier: 'standard',
  contextWindow: '128k',
  contextWindowNum: 128000
});

describe('SettingsComponent', () => {
  it('should be truthy', () => {
    expect(SettingsComponent).toBeTruthy();
  });

  /**
   * Build the component with every constructor dependency mocked.
   * `refresh$` controls what `ApiService.refreshModelsForProvider$`
   * emits; `fallback` controls what the curated list looks like.
   */
  const buildComponent = (options: {
    refresh$?: Subject<LLMModel[]>;
    fallback?: LLMModel[];
  } = {}): { component: SettingsComponent; refresh$: Subject<LLMModel[]> } => {
    const refresh$ = options.refresh$ ?? new Subject<LLMModel[]>();
    const fallback = options.fallback ?? [model('fallback/model')];

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SettingsComponent,
        { provide: TranslationService, useValue: { get: (k: string) => k } },
        {
          provide: ApiService,
          useValue: {
            listProviders: () => [PROVIDER],
            refreshModelsForProvider$: () => refresh$,
            getFallbackModels: () => fallback,
            isValidApiKey: () => true
          }
        },
        {
          provide: ProviderService,
          useValue: {
            activeProvider: () => PROVIDER,
            getActiveProvider: () => PROVIDER,
            isActiveConfigured: () => true,
            getApiKey: () => 'sk-test',
            getBaseUrl: () => PROVIDER.baseUrl,
            getSelectedModel: () => ''
          }
        }
      ]
    });

    return { component: TestBed.inject(SettingsComponent), refresh$ };
  };

  describe('Model list refresh', () => {
    it('replaces the list on success and clears the error', () => {
      const { component, refresh$ } = buildComponent();
      component.models = [model('old/model')];
      component.modelsError = 'settings.refreshFailed';

      component.refreshModels();
      refresh$.next([model('new/model')]);

      expect(component.models.map(m => m.id)).toEqual(['new/model']);
      expect(component.modelsError).toBe('');
      expect(component.isLoadingModels).toBeFalse();
    });

    it('keeps the previous list when the refresh fails', () => {
      const { component, refresh$ } = buildComponent();
      component.models = [model('old/model')];

      component.refreshModels();
      refresh$.error(new Error('network down'));

      expect(component.models.map(m => m.id)).toEqual(['old/model']);
      expect(component.modelsError).toBe('settings.refreshFailed');
      expect(component.isLoadingModels).toBeFalse();
    });

    it('falls back to the curated list when the initial load fails', () => {
      const { component, refresh$ } = buildComponent({
        fallback: [model('fallback/model')]
      });
      component.models = [model('old/model')];

      component.loadModels();
      refresh$.error(new Error('network down'));

      expect(component.models.map(m => m.id)).toEqual(['fallback/model']);
      expect(component.modelsError).toBe('settings.usingFallbackModels');
      expect(component.isLoadingModels).toBeFalse();
    });

    it('reconciles the selection against the refreshed list', () => {
      const { component, refresh$ } = buildComponent();
      component.selectedModel = 'gone/model';
      component.currentModel = 'saved/model';

      component.refreshModels();
      refresh$.next([model('saved/model'), model('other/model')]);

      // The pending selection is gone upstream, so the saved model wins.
      expect(component.selectedModel).toBe('saved/model');
    });

    it('clears the selection when neither the pending nor the saved model survives', () => {
      const { component, refresh$ } = buildComponent();
      component.selectedModel = 'gone/model';
      component.currentModel = 'also-gone/model';

      component.refreshModels();
      refresh$.next([model('other/model')]);

      expect(component.selectedModel).toBe('');
    });

    it('keeps the current selection when it is still in the list', () => {
      const { component, refresh$ } = buildComponent();
      component.selectedModel = 'kept/model';
      component.currentModel = 'kept/model';

      component.refreshModels();
      refresh$.next([model('kept/model')]);

      expect(component.selectedModel).toBe('kept/model');
    });
  });
});
