import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ThemeService } from '../../core/theme.service';
import { ApiService } from '../../core/api.service';
import { TranslationService } from '../../i18n/translation.service';
import { PersistenceService } from '../../core/persistence.service';
import { BookStateService } from '../../book/state/book-state.service';

@Component({
  selector: 'app-shell',
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
  imports: [CommonModule, FormsModule, RouterModule]
})
export class ShellComponent {
  protected themeService = inject(ThemeService);
  protected apiService = inject(ApiService);
  protected translationService = inject(TranslationService);
  protected router = inject(Router);
  
  private persistenceService = inject(PersistenceService);
  private bookStateService = inject(BookStateService);
  
  isDarkMode = false;
  selectedModel = '';

  constructor() {
    this.isDarkMode = this.themeService.isDarkMode();
    this.loadSelectedModel();
  }

  private loadSelectedModel(): void {
    const saved = localStorage.getItem('selected-model');
    this.selectedModel = saved || this.apiService.getDefaultModel().id;
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
    this.isDarkMode = this.themeService.isDarkMode();
  }

  isConfigured(): boolean {
    return this.apiService.isConfigured();
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

  async toggleLanguage(): Promise<void> {
    const state = this.bookStateService.getState();
    const hasData = state.chapters && state.chapters.length > 0;
    
    if (hasData) {
      await this.persistenceService.clearAll();
      this.bookStateService.reset();
    }
    
    this.translationService.toggleLanguage();
  }

  isEnglish(): boolean {
    return this.translationService.isEnglish();
  }

  getModelName(): string {
    // Always read from localStorage to get the current model
    const selectedModelId = localStorage.getItem('selected-model');
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
      // Split by hyphens and capitalize each word
      const words = modelSlug.split('-').map(word => {
        // Keep numbers as-is, capitalize letters
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
