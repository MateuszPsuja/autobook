import { Injectable, computed, signal } from '@angular/core';
import { LLMProvider, ProviderConfig, ProviderConfigMap } from './provider.types';
import { LLM_PROVIDERS, getDefaultProvider, getProvider } from './providers';

/**
 * Owns the multi-provider state: which provider is active, and the per-provider
 * config (api key, baseUrl, selected model) stored in localStorage.
 *
 * Storage layout:
 *   - `llm_active_provider` -> string provider id
 *   - `llm_provider_config`  -> JSON `{ [providerId]: { apiKey?, baseUrl?, model? } }`
 *   - `selected-model`       -> kept for backwards compatibility; on first read
 *                              we migrate it into the openrouter slot if the
 *                              legacy `openrouter_api_key` is present.
 *   - `openrouter_api_key`   -> legacy; migrated into the new structure on
 *                              first read and then removed.
 *
 * The state is exposed as Angular signals so templates and computed values
 * react automatically when the user switches providers or saves a new key.
 */
@Injectable({ providedIn: 'root' })
export class ProviderService {
  private static readonly ACTIVE_KEY = 'llm_active_provider';
  private static readonly CONFIG_KEY = 'llm_provider_config';
  /** Legacy keys kept for one-shot migration. */
  private static readonly LEGACY_KEY = 'openrouter_api_key';
  private static readonly LEGACY_MODEL_KEY = 'selected-model';

  /** Active provider id (signal so consumers re-render on change). */
  private readonly activeIdSignal = signal<string>(this.migrateAndReadActiveId());

  /** Per-provider config keyed by provider id. */
  private readonly configSignal = signal<ProviderConfigMap>(this.migrateAndReadConfigs());

  readonly activeProvider = computed<LLMProvider>(() => {
    const id = this.activeIdSignal();
    return getProvider(id) ?? getDefaultProvider();
  });

  readonly activeConfig = computed<ProviderConfig>(() => {
    const provider = this.activeProvider();
    return this.configSignal()[provider.id] ?? {};
  });

  readonly allProviders = LLM_PROVIDERS;

  /** True if the active provider has everything it needs to make a request. */
  readonly isActiveConfigured = computed<boolean>(() => {
    const provider = this.activeProvider();
    if (provider.requiresApiKey && !this.getApiKey(provider.id)) return false;
    if (provider.baseUrlEditable && !this.getBaseUrl(provider.id)) return false;
    return true;
  });

  // === Active provider ===

  getActiveProvider(): LLMProvider {
    return this.activeProvider();
  }

  getActiveProviderId(): string {
    return this.activeIdSignal();
  }

  setActiveProvider(id: string): void {
    if (!getProvider(id)) return;
    this.activeIdSignal.set(id);
    localStorage.setItem(ProviderService.ACTIVE_KEY, id);
  }

  // === Per-provider config ===

  getConfig(providerId: string): ProviderConfig {
    return this.configSignal()[providerId] ?? {};
  }

  getApiKey(providerId?: string): string | null {
    const id = providerId ?? this.getActiveProviderId();
    return this.getConfig(id).apiKey ?? null;
  }

  getBaseUrl(providerId?: string): string | null {
    const provider = getProvider(providerId ?? this.getActiveProviderId());
    if (!provider) return null;
    const override = this.getConfig(provider.id).baseUrl;
    return override && override.trim().length > 0 ? override : provider.baseUrl;
  }

  getSelectedModel(providerId?: string): string | null {
    return this.getConfig(providerId ?? this.getActiveProviderId()).model ?? null;
  }

  saveProviderConfig(providerId: string, patch: Partial<ProviderConfig>): void {
    const provider = getProvider(providerId);
    if (!provider) return;
    const next: ProviderConfigMap = { ...this.configSignal() };
    const current = next[providerId] ?? {};
    next[providerId] = { ...current, ...patch };
    this.configSignal.set(next);
    localStorage.setItem(ProviderService.CONFIG_KEY, JSON.stringify(next));
  }

  saveApiKey(apiKey: string, providerId?: string): void {
    this.saveProviderConfig(providerId ?? this.getActiveProviderId(), { apiKey });
  }

  clearApiKey(providerId?: string): void {
    this.saveProviderConfig(providerId ?? this.getActiveProviderId(), { apiKey: null });
  }

  saveBaseUrl(baseUrl: string, providerId?: string): void {
    this.saveProviderConfig(providerId ?? this.getActiveProviderId(), { baseUrl });
  }

  saveSelectedModel(model: string, providerId?: string): void {
    this.saveProviderConfig(providerId ?? this.getActiveProviderId(), { model });
    // Keep the legacy `selected-model` key in sync so other components
    // (and any external code) that still read it keep working.
    localStorage.setItem(ProviderService.LEGACY_MODEL_KEY, model);
  }

  isConfigured(providerId?: string): boolean {
    const id = providerId ?? this.getActiveProviderId();
    const provider = getProvider(id);
    if (!provider) return false;
    if (provider.requiresApiKey && !this.getApiKey(id)) return false;
    if (provider.baseUrlEditable && !this.getBaseUrl(id)) return false;
    return true;
  }

  // === Migration ===

  /**
   * One-shot migration from the old single-provider storage layout.
   * Runs at construction time so the rest of the app can ignore the
   * legacy keys entirely.
   */
  private migrateAndReadActiveId(): string {
    const stored = localStorage.getItem(ProviderService.ACTIVE_KEY);
    if (stored && getProvider(stored)) return stored;
    return getDefaultProvider().id;
  }

  private migrateAndReadConfigs(): ProviderConfigMap {
    const raw = localStorage.getItem(ProviderService.CONFIG_KEY);
    let parsed: ProviderConfigMap = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as ProviderConfigMap;
      } catch {
        parsed = {};
      }
    }

    // Backwards-compat: if the user had an old `openrouter_api_key` and
    // a `selected-model`, fold them into the new structure. We only do
    // this once — the legacy keys are removed right after.
    const legacyKey = localStorage.getItem(ProviderService.LEGACY_KEY);
    const legacyModel = localStorage.getItem(ProviderService.LEGACY_MODEL_KEY);
    if (legacyKey && !parsed['openrouter']?.apiKey) {
      parsed['openrouter'] = {
        ...(parsed['openrouter'] ?? {}),
        apiKey: legacyKey,
        ...(legacyModel && !parsed['openrouter']?.model ? { model: legacyModel } : {})
      };
      localStorage.setItem(ProviderService.CONFIG_KEY, JSON.stringify(parsed));
    }
    if (legacyKey) localStorage.removeItem(ProviderService.LEGACY_KEY);

    return parsed;
  }
}
