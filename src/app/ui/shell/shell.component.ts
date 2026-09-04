import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ThemeService } from '../../core/theme.service';
import { ApiService } from '../../core/api.service';
import { ProviderService } from '../../core/providers/provider.service';
import { TranslationService } from '../../i18n/translation.service';
import { DialogHostComponent } from '../../core/dialog-host.component';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-shell',
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
  imports: [CommonModule, FormsModule, RouterModule, DialogHostComponent]
})
export class ShellComponent {
  protected themeService = inject(ThemeService);
  protected apiService = inject(ApiService);
  protected providerService = inject(ProviderService);
  protected translationService = inject(TranslationService);
  protected router = inject(Router);

  isDarkMode = false;
  selectedModel = '';

  // Single source of truth for the sidebar. Keeping it here means the
  // template's @for, the active-state logic, and the page-title lookup
  // all agree on the same set of routes.
  navItems: NavItem[] = [
    { path: '/config',     label: this.t('nav.configure'), icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
    { path: '/generator',  label: this.t('nav.generate'),  icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' },
    { path: '/viewer',     label: this.t('nav.view'),      icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
    { path: '/export',     label: this.t('nav.export'),    icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12' },
  ];

  constructor() {
    this.isDarkMode = this.themeService.isDarkMode();
    this.loadSelectedModel();
  }

  private loadSelectedModel(): void {
    const saved = this.providerService.getSelectedModel();
    this.selectedModel = saved || this.apiService.getDefaultModel().id;
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
    this.isDarkMode = this.themeService.isDarkMode();
  }

  isConfigured(): boolean {
    return this.apiService.isConfigured();
  }

  /** Generic nav handler. Both the sidebar buttons and any future
   *  global action (e.g. command palette) can call this with a path. */
  navigateTo(path: string): void {
    this.router.navigate([path]);
  }

  navigateToSettings(): void {
    this.router.navigate(['/settings']);
  }

  navigateToConfig(): void {
    this.router.navigate(['/config']);
  }

  navigateToGenerator(): void {
    this.router.navigate(['/generator']);
  }

  navigateToViewer(): void {
    this.router.navigate(['/viewer']);
  }

  navigateToExport(): void {
    this.router.navigate(['/export']);
  }

  t(key: string): string {
    return this.translationService.get(key);
  }

  getActivePageTitle(): string {
    const url = this.router.url;
    if (url.includes('/settings')) return this.t('pages.settings.title');
    if (url.includes('/config')) return this.t('pages.config.title');
    if (url.includes('/generator')) return this.t('pages.generator.title');
    if (url.includes('/viewer')) return this.t('pages.viewer.title');
    if (url.includes('/export')) return this.t('pages.export.title');
    return this.t('app.title');
  }

  getActivePageSubtitle(): string {
    const url = this.router.url;
    if (url.includes('/settings')) return this.t('pages.settings.subtitle');
    if (url.includes('/config')) return this.t('pages.config.subtitle');
    if (url.includes('/generator')) return this.t('pages.generator.subtitle');
    if (url.includes('/viewer')) return this.t('pages.viewer.subtitle');
    if (url.includes('/export')) return this.t('pages.export.subtitle');
    return this.t('app.subtitle');
  }

  getModelName(): string {
    // Always read from the active provider config to get the current model
    const selectedModelId = this.providerService.getSelectedModel();
    if (!selectedModelId) {
      return this.apiService.getDefaultModel().name;
    }

    // Try to find in fallback models first
    const model = this.apiService.getModelById(selectedModelId);
    if (model) {
      return model.name;
    }

    // If not found in fallback, extract a readable name from the ID
    // e.g., "nvidia/nemotron-3-nano-30b-a3b:free" -> "Nemotron 3 Nano 30B A3B"
    const parts = selectedModelId.split('/');
    if (parts.length >= 2) {
      let modelSlug = parts[1];

      // Remove :free or similar suffixes
      modelSlug = modelSlug.replace(/:.*$/, '');

      // Convert slug to readable name
      const words = modelSlug.split('-').map(word => {
        if (/^\d+$/.test(word)) {
          return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      });

      return words.join(' ');
    }
    return selectedModelId;
  }
}
