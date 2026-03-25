import { Component, OnInit, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, OpenRouterModel } from '../../core/api.service';
import { TranslationService } from '../../i18n/translation.service';
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

  private destroy$ = new Subject<void>();

  // API Key state
  apiKeyInput = '';
  isApiKeyVisible = false;
  apiTesting = false;
  apiTested = false;
  apiError = '';
  apiSuccess = false;

  // Model state
  models: OpenRouterModel[] = [];
  selectedModel = '';
  isLoadingModels = false;
  modelsError = '';
  isModelSaving = false;
  searchQuery = '';
  showFreeOnly = false;

  // Current values
  currentApiKey = '';
  currentModel = '';

  constructor() {
    this.loadCurrentValues();
  }

  ngOnInit(): void {
    this.loadCurrentValues();
    // Auto-load models if API is configured
    if (this.apiService.isConfigured()) {
      this.loadModels();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadCurrentValues(): void {
    this.currentApiKey = this.apiService.getApiKey() || '';
    // Subscribe to default model
    this.apiService.getDefaultModel$()
      .pipe(takeUntil(this.destroy$))
      .subscribe(model => {
        this.currentModel = localStorage.getItem('selected-model') || model.id;
        this.selectedModel = this.currentModel;
      });
  }

  t(key: string): string {
    return this.translationService.get(key);
  }

  // API Key methods
  toggleApiKeyVisibility(): void {
    this.isApiKeyVisible = !this.isApiKeyVisible;
  }

  testApiKey(): void {
    this.apiTested = false;
    this.apiTesting = true;
    this.apiError = '';
    this.apiSuccess = false;
    
    const apiKey = this.apiKeyInput || this.currentApiKey;
    if (!apiKey) {
      this.apiTesting = false;
      this.apiError = this.t('settings.apiKeyRequired');
      return;
    }

    // Use Observable-based method
    this.apiService.testApiKey$(apiKey)
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
    if (this.apiService.isValidApiKey(this.apiKeyInput)) {
      this.apiService.saveApiKey(this.apiKeyInput);
      this.currentApiKey = this.apiKeyInput;
      this.apiKeyInput = '';
      this.apiTested = false;
      this.apiSuccess = false;
      // Reload models after saving API key
      this.loadModels();
    }
  }

  clearApiKey(): void {
    this.apiService.clearApiKey();
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

  // Model methods
  loadModels(): void {
    if (!this.apiService.isConfigured()) {
      this.modelsError = this.t('settings.configureApiKeyFirst');
      this.models = [];
      return;
    }

    this.isLoadingModels = true;
    this.modelsError = '';

    this.apiService.getModels$()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (fetchedModels) => {
          this.models = fetchedModels;
          
          // If current model is not in the list, try to find it
          if (!this.models.find(m => m.id === this.currentModel)) {
            // Model not found, keep current selection
          }
          this.isLoadingModels = false;
        },
        error: (error) => {
          console.warn('Failed to fetch models from API:', error);
          this.modelsError = this.t('settings.usingFallbackModels');
          // In case of error, getModels$() will return fallback models
          this.isLoadingModels = false;
        }
      });
  }

  saveModel(): void {
    if (this.selectedModel) {
      localStorage.setItem('selected-model', this.selectedModel);
      this.currentModel = this.selectedModel;
      this.isModelSaving = true;
      setTimeout(() => {
        this.isModelSaving = false;
      }, 500);
    }
  }

  getModelName(modelId: string): string {
    const model = this.models.find(m => m.id === modelId);
    return model?.name || modelId;
  }

  getSelectedModelInfo(): OpenRouterModel | undefined {
    return this.models.find(m => m.id === this.selectedModel);
  }

  isConfigured(): boolean {
    return this.apiService.isConfigured();
  }

  // Get tier badge class
  getTierBadgeClass(tier: string): string {
    switch (tier) {
      case 'premium':
        return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400';
      case 'standard':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
      case 'budget':
        return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
      default:
        return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400';
    }
  }

  getProviderIcon(provider: string): string {
    const icons: Record<string, string> = {
      'Anthropic': '🧠',
      'OpenAI': '🤖',
      'Google': '🔍',
      'Meta': '🌐',
      'Mistral': '❄️',
      'DeepSeek': '🔮',
      'Cohere': '🌊',
      'Perplexity': '✨'
    };
    return icons[provider] || '💻';
  }

  get filteredModels(): OpenRouterModel[] {
    let result = this.models;
    
    // Filter by free only - models with "free" in the name
    if (this.showFreeOnly) {
      result = result.filter(m => m.name.toLowerCase().includes('free'));
    }
    
    // Filter by search query
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

  getCurrentModelInfo(): OpenRouterModel | undefined {
    return this.models.find(m => m.id === this.currentModel);
  }
}
