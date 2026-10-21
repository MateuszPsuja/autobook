import { Component, OnInit, OnDestroy, inject, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, OpenRouterModel } from '../../core/api.service';
import { TranslationService } from '../../i18n/translation.service';
import { ProviderService } from '../../core/providers/provider.service';
import { LLMProvider, LLMModel } from '../../core/providers/provider.types';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class SettingsComponent implements OnInit, OnDestroy {
  protected apiService = inject(ApiService);
  protected translationService = inject(TranslationService);
  protected providerService = inject(ProviderService);

  private destroy$ = new Subject<void>();

  // Provider state
  providers = this.apiService.listProviders();
  activeProvider = this.providerService.getActiveProvider();

  // API Key state
  apiKeyInput = '';
  isApiKeyVisible = false;
  apiTesting = false;
  apiTested = false;
  apiError = '';
  apiSuccess = false;

  // Base URL state (LM Studio)
  baseUrlInput = '';

  // Model state
  models: LLMModel[] = [];
  selectedModel = '';
  isLoadingModels = false;
  modelsError = '';
  isModelSaving = false;
  searchQuery = '';
  showFreeOnly = false;

  // Current values
  currentApiKey = '';
  currentBaseUrl = '';
  currentModel = '';

  constructor() {
    // Re-pull active provider / model state whenever the user switches.
    // Wrapped in `untracked` so config-save signals (apiKey, baseUrl,
    // selectedModel) don't re-trigger this effect and wipe the loaded
    // `models` array every time a field is saved.
    effect(() => {
      this.activeProvider = this.providerService.activeProvider();
      untracked(() => this.refreshFromStorage());
    });
  }

  ngOnInit(): void {
    this.refreshFromStorage();
    if (this.providerService.isActiveConfigured()) {
      this.loadModels();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Pull the current values for the active provider from the service
   * into the local component state used by the form.
   */
  private refreshFromStorage(): void {
    const id = this.activeProvider.id;
    this.currentApiKey = this.providerService.getApiKey(id) ?? '';
    this.currentBaseUrl = this.providerService.getBaseUrl(id) ?? this.activeProvider.baseUrl;
    this.baseUrlInput = this.currentBaseUrl;
    this.currentModel = this.providerService.getSelectedModel(id) ?? '';
    this.selectedModel = this.currentModel;

    // Reset transient form state
    this.apiKeyInput = '';
    this.apiTested = false;
    this.apiSuccess = false;
    this.apiError = '';
    this.models = [];
    this.modelsError = '';
  }

  t(key: string, params?: Record<string, string | number>): string {
    const value = this.translationService.get(key);
    if (!params) return value;
    return Object.keys(params).reduce(
      (acc, name) => acc.split(`{${name}}`).join(String(params[name])),
      value
    );
  }

  // === Provider switching ===

  onProviderChange(providerId: string): void {
    if (providerId === this.activeProvider.id) return;
    this.providerService.setActiveProvider(providerId);
    // The effect() will re-run refreshFromStorage + loadModels.
    if (this.providerService.isActiveConfigured()) {
      this.loadModels();
    }
  }

  // === API Key methods ===

  toggleApiKeyVisibility(): void {
    this.isApiKeyVisible = !this.isApiKeyVisible;
  }

  testApiKey(): void {
    this.apiTested = false;
    this.apiTesting = true;
    this.apiError = '';
    this.apiSuccess = false;

    const apiKey = this.apiKeyInput || this.currentApiKey;
    if (this.activeProvider.requiresApiKey && !apiKey) {
      this.apiTesting = false;
      this.apiError = this.t('settings.apiKeyRequired');
      return;
    }

    this.apiService.testApiKey$(apiKey, this.activeProvider.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.apiTesting = false;
          if (result.success) {
            this.apiTested = true;
            this.apiError = '';
            this.apiSuccess = true;
          } else {
            this.apiTested = false;
            this.apiError = result.error || this.t('settings.apiKeyInvalid');
          }
        },
        error: (error) => {
          this.apiTesting = false;
          this.apiTested = false;
          this.apiError = error.message || this.t('settings.networkError');
        }
      });
  }

  saveApiKey(): void {
    if (!this.apiService.isValidApiKey(this.apiKeyInput)) return;
    this.providerService.saveApiKey(this.apiKeyInput, this.activeProvider.id);
    this.currentApiKey = this.apiKeyInput;
    this.apiKeyInput = '';
    this.apiTested = false;
    this.apiSuccess = false;
    this.loadModels();
  }

  clearApiKey(): void {
    this.providerService.clearApiKey(this.activeProvider.id);
    this.currentApiKey = '';
    this.apiKeyInput = '';
    this.models = [];
    this.apiTested = false;
    this.apiSuccess = false;
  }

  clearApiKeyInput(): void {
    this.apiKeyInput = '';
    this.apiError = '';
    this.apiSuccess = false;
  }

  // === Base URL methods (LM Studio and override-able providers) ===

  saveBaseUrl(): void {
    const value = (this.baseUrlInput ?? '').trim();
    if (value.length === 0) return;
    this.providerService.saveBaseUrl(value, this.activeProvider.id);
    this.currentBaseUrl = value;
    this.loadModels();
  }

  resetBaseUrl(): void {
    this.baseUrlInput = this.activeProvider.defaultBaseUrl;
  }

  // === Model methods ===

  loadModels(): void {
    this.fetchModels(true);
  }

  /** Re-fetch the model list without clearing the list on screen. */
  refreshModels(): void {
    this.fetchModels(false);
  }

  private fetchModels(clearList: boolean): void {
    if (!this.providerService.isActiveConfigured()) {
      this.modelsError = this.t('settings.configureApiKeyFirst');
      this.models = [];
      return;
    }

    this.isLoadingModels = true;
    this.modelsError = '';
    if (clearList) this.models = [];

    this.apiService.refreshModelsForProvider$(this.activeProvider.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (fetchedModels) => {
          this.models = fetchedModels;
          this.isLoadingModels = false;
          this.reconcileSelection(fetchedModels);
        },
        error: (error) => {
          console.warn(`Failed to fetch ${this.activeProvider.name} models:`, error);
          if (clearList) {
            // Nothing on screen yet — fall back to the curated list.
            this.models = this.apiService.getFallbackModels(this.activeProvider.id);
            this.modelsError = this.t('settings.usingFallbackModels');
          } else {
            // Keep the list the user already has; just say it failed.
            this.modelsError = this.t('settings.refreshFailed');
          }
          this.isLoadingModels = false;
        }
      });
  }

  /**
   * After a refresh the previously picked model may be gone (retired
   * upstream). Fall back to the saved selection, then to nothing.
   */
  private reconcileSelection(models: LLMModel[]): void {
    if (this.selectedModel && models.some(m => m.id === this.selectedModel)) return;
    this.selectedModel = (this.currentModel && models.some(m => m.id === this.currentModel))
      ? this.currentModel
      : '';
  }

  saveModel(): void {
    if (!this.selectedModel) return;
    this.providerService.saveSelectedModel(this.selectedModel, this.activeProvider.id);
    this.currentModel = this.selectedModel;
    this.isModelSaving = true;
    setTimeout(() => {
      this.isModelSaving = false;
    }, 500);
  }

  getModelName(modelId: string): string {
    const model = this.models.find(m => m.id === modelId);
    return model?.name ?? modelId;
  }

  getSelectedModelInfo(): LLMModel | undefined {
    return this.models.find(m => m.id === this.selectedModel);
  }

  isConfigured(): boolean {
    return this.providerService.isActiveConfigured();
  }

  get filteredModels(): LLMModel[] {
    let result = this.models;
    if (this.showFreeOnly) {
      result = result.filter(m => m.name.toLowerCase().includes('free') || m.free === true);
    }
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      result = result.filter(m =>
        m.name.toLowerCase().includes(query) ||
        m.id.toLowerCase().includes(query) ||
        m.provider.toLowerCase().includes(query)
      );
    }
    return result;
  }

  getCurrentModelInfo(): LLMModel | undefined {
    return this.models.find(m => m.id === this.currentModel);
  }

  /** Quick helper: is the current provider's key valid for the format check? */
  isKeyFormatValid(): boolean {
    if (!this.apiKeyInput) return false;
    return this.apiService.isValidApiKey(this.apiKeyInput);
  }

  isBaseUrlValid(): boolean {
    try {
      const u = new URL(this.baseUrlInput);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
