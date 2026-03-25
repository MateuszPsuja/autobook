import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'app_theme';
  private readonly DARK_CLASS = 'dark';

  constructor() {
    this.initializeTheme();
  }

  /**
   * Initialize theme from localStorage or system preference
   */
  private initializeTheme(): void {
    const savedTheme = localStorage.getItem(this.THEME_KEY);
    
    if (savedTheme === 'dark') {
      this.enableDarkMode();
    } else if (savedTheme === 'light') {
      this.disableDarkMode();
    } else {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        this.enableDarkMode();
      }
    }
  }

  /**
   * Toggle between light and dark mode
   */
  toggleTheme(): void {
    const isDark = this.isDarkMode();
    if (isDark) {
      this.disableDarkMode();
    } else {
      this.enableDarkMode();
    }
  }

  /**
   * Enable dark mode
   */
  enableDarkMode(): void {
    document.documentElement.classList.add(this.DARK_CLASS);
    localStorage.setItem(this.THEME_KEY, 'dark');
  }

  /**
   * Disable dark mode
   */
  disableDarkMode(): void {
    document.documentElement.classList.remove(this.DARK_CLASS);
    localStorage.setItem(this.THEME_KEY, 'light');
  }

  /**
   * Check if dark mode is currently enabled
   */
  isDarkMode(): boolean {
    return document.documentElement.classList.contains(this.DARK_CLASS);
  }

  /**
   * Get current theme
   */
  getCurrentTheme(): 'light' | 'dark' {
    return this.isDarkMode() ? 'dark' : 'light';
  }

  /**
   * Set theme explicitly
   */
  setTheme(theme: 'light' | 'dark'): void {
    if (theme === 'dark') {
      this.enableDarkMode();
    } else {
      this.disableDarkMode();
    }
  }
}