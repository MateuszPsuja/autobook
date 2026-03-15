import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Observable, of, EMPTY, throwError, forkJoin } from 'rxjs';
import { map, switchMap, catchError, take, delay as rxDelay } from 'rxjs/operators';
import en from './en.json';
import pl from './pl.json';
import { ApiService } from '../core/api.service';

export type Language = 'en' | 'pl';

export type TranslationValue = string | string[] | { [key: string]: TranslationValue };

const translations: Record<Language, TranslationValue> = { en, pl };

// Reverse mappings for dropdown values (Polish → English)
const polishToEnglishMappings: Record<string, Record<string, string>> = {
  genres: {
    'Fantastyka': 'Fantasy',
    'Science Fiction': 'Science Fiction',
    'Kryminał': 'Mystery',
    'Thriller': 'Thriller',
    'Romans': 'Romance',
    'Horror': 'Horror',
    'Literatura Faktu': 'Literary Fiction',
    'Fikcja Historyczna': 'Historical Fiction',
    'Młodzieżowa': 'Young Adult',
    'Biografia': 'Biography'
  },
  writingStyles: {
    'Opisowy': 'Descriptive',
    'Minimalistyczny': 'Minimalist',
    'Narracyjny': 'Narrative',
    'Napędzany Dialogiem': 'Dialogue-driven',
    'Strumień Świadomości': 'Stream of Consciousness',
    'Liryczny': 'Lyrical',
    'Humorystyczny': 'Humorous',
    'Techniczny': 'Technical'
  },
  tones: {
    'Mroczny': 'Dark',
    'Lekki': 'Light',
    'Poważny': 'Serious',
    'Zabawny': 'Playful',
    'Melancholijny': 'Melancholic',
    'Optymistyczny': 'Optimistic',
    'Neutralny': 'Neutral',
    'Pełen Napięcia': 'Suspenseful'
  },
  povs: {
    'Pierwsza Osoba': 'First Person',
    'Trzecia Osoba (Ograniczona)': 'Third Person Limited',
    'Trzecia Osoba (Wszechwiedząca)': 'Third Person Omniscient',
    'Druga Osoba': 'Second Person'
  },
  tenses: {
    'Przeszły': 'Past',
    'Przyszły': 'Future',
    'Teraźniejszy': 'Present'
  },
  audiences: {
    'Dzieci': 'Children',
    'Młodzież': 'Young Adult',
    'Dorośli': 'Adult',
    'Dla Dorosłych': 'Mature'
  },
  worldTypes: {
    'Świat Rzeczywisty': 'Real World',
    'Świat Fantasy': 'Fantasy World',
    'Świat Sci-Fi': 'Sci-Fi World',
    'Historyczny': 'Historical',
    'Postapokaliptyczny': 'Post-Apocalyptic',
    'Dystopijny': 'Dystopian',
    'Utopijny': 'Utopian'
  },
  bookLengths: {
    'Opowiadanie (5000-10000 słów)': 'Short Story (5,000-10,000 words)',
    'Nowela (20000-40000 słów)': 'Novella (20,000-40,000 words)',
    'Krótka Powieść (50000-70000 słów)': 'Short Novel (50,000-70,000 words)',
    'Powieść (80000-100000 słów)': 'Novel (80,000-100,000 words)',
    'Długa Powieść (100000-150000 słów)': 'Long Novel (100,000-150,000 words)'
  },
  chapterLengths: {
    'Bardzo Krótki (500-1000 słów)': 'Very Short (500-1,000 words)',
    'Krótki (1000-2000 słów)': 'Short (1,000-2,000 words)',
    'Średni (2000-3000 słów)': 'Medium (2,000-3,000 words)',
    'Długi (3000-5000 słów)': 'Long (3,000-5,000 words)',
    'Bardzo Długi (5000-8000 słów)': 'Very Long (5,000-8,000 words)'
  },
  plotArchetypes: {
    'Podróż Bohatera': "Hero's Journey",
    'Tragedia': 'Tragedy',
    'Dorastanie': 'Coming of Age',
    'Od Zera do Bohatera': 'Rags to Riches',
    'Wyprawa': 'Quest',
    'Bunt': 'Rebellion',
    'Transformacja': 'Transformation',
    'Rejs': 'Voyage'
  },
  actStructures: {
    'Trzyaktowa': 'Three-Act Structure',
    'Pięcioaktowa': 'Five-Act Structure',
    'Piramida Freytaga': "Freytag's Pyramid",
    'Kishotenketsu': 'Kishotenketsu',
    'Sekwencyjna': 'Sequential'
  }
};

// English to Polish mappings for export
const englishToPolishMappings: Record<string, Record<string, string>> = {
  genres: {
    'Fantasy': 'Fantastyka',
    'Science Fiction': 'Science Fiction',
    'Mystery': 'Kryminał',
    'Thriller': 'Thriller',
    'Romance': 'Romans',
    'Horror': 'Horror',
    'Literary Fiction': 'Literatura Faktu',
    'Historical Fiction': 'Fikcja Historyczna',
    'Young Adult': 'Młodzieżowa',
    'Biography': 'Biografia'
  },
  writingStyles: {
    'Descriptive': 'Opisowy',
    'Minimalist': 'Minimalistyczny',
    'Narrative': 'Narracyjny',
    'Dialogue-driven': 'Napędzany Dialogiem',
    'Stream of Consciousness': 'Strumień Świadomości',
    'Lyrical': 'Liryczny',
    'Humorous': 'Humorystyczny',
    'Technical': 'Techniczny'
  },
  tones: {
    'Dark': 'Mroczny',
    'Light': 'Lekki',
    'Serious': 'Poważny',
    'Playful': 'Zabawny',
    'Melancholic': 'Melancholijny',
    'Optimistic': 'Optymistyczny',
    'Neutral': 'Neutralny',
    'Suspenseful': 'Pełen Napięcia'
  },
  povs: {
    'First Person': 'Pierwsza Osoba',
    'Third Person Limited': 'Trzecia Osoba (Ograniczona)',
    'Third Person Omniscient': 'Trzecia Osoba (Wszechwiedząca)',
    'Second Person': 'Druga Osoba'
  },
  tenses: {
    'Past': 'Przeszły',
    'Future': 'Przyszły',
    'Present': 'Teraźniejszy'
  },
  audiences: {
    'Children': 'Dzieci',
    'Young Adult': 'Młodzież',
    'Adult': 'Dorośli',
    'Mature': 'Dla Dorosłych'
  },
  worldTypes: {
    'Real World': 'Świat Rzeczywisty',
    'Fantasy World': 'Świat Fantasy',
    'Sci-Fi World': 'Świat Sci-Fi',
    'Historical': 'Historyczny',
    'Post-Apocalyptic': 'Postapokaliptyczny',
    'Dystopian': 'Dystopijny',
    'Utopian': 'Utopijny'
  },
  bookLengths: {
    'Short Story (5,000-10,000 words)': 'Opowiadanie (5000-10000 słów)',
    'Novella (20,000-40,000 words)': 'Nowela (20000-40000 słów)',
    'Short Novel (50,000-70,000 words)': 'Krótka Powieść (50000-70000 słów)',
    'Novel (80,000-100,000 words)': 'Powieść (80000-100000 słów)',
    'Long Novel (100,000-150,000 words)': 'Długa Powieść (100000-150000 słów)'
  },
  chapterLengths: {
    'Very Short (500-1,000 words)': 'Bardzo Krótki (500-1000 słów)',
    'Short (1,000-2,000 words)': 'Krótki (1000-2000 słów)',
    'Medium (2,000-3,000 words)': 'Średni (2000-3000 słów)',
    'Long (3,000-5,000 words)': 'Długi (3000-5000 słów)',
    'Very Long (5,000-8,000 words)': 'Bardzo Długi (5000-8000 słów)'
  },
  plotArchetypes: {
    "Hero's Journey": 'Podróż Bohatera',
    'Tragedy': 'Tragedia',
    'Coming of Age': 'Dorastanie',
    'Rags to Riches': 'Od Zera do Bohatera',
    'Quest': 'Wyprawa',
    'Rebellion': 'Bunt',
    'Transformation': 'Transformacja',
    'Voyage': 'Rejs'
  },
  actStructures: {
    'Three-Act Structure': 'Trzyaktowa',
    'Five-Act Structure': 'Pięcioaktowa',
    "Freytag's Pyramid": 'Piramida Freytaga',
    'Kishotenketsu': 'Kishotenketsu',
    'Sequential': 'Sekwencyjna'
  }
};

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  private readonly STORAGE_KEY = 'app-language';
  private apiService = inject(ApiService);
  
  private currentLanguage = signal<Language>(this.getStoredLanguage());
  
  readonly language = computed(() => this.currentLanguage());
  
  readonly isEnglish = computed(() => this.currentLanguage() === 'en');
  readonly isPolish = computed(() => this.currentLanguage() === 'pl');

  constructor() {
    effect(() => {
      localStorage.setItem(this.STORAGE_KEY, this.currentLanguage());
    });
  }

  private getStoredLanguage(): Language {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored === 'en' || stored === 'pl') {
      return stored;
    }
    const browserLang = navigator.language.split('-')[0];
    return browserLang === 'pl' ? 'pl' : 'en';
  }

  setLanguage(lang: Language): void {
    this.currentLanguage.set(lang);
  }

  toggleLanguage(): void {
    this.currentLanguage.update(lang => lang === 'en' ? 'pl' : 'en');
  }

  get(key: string): string {
    const keys = key.split('.');
    const lang = this.currentLanguage();
    
    // Check if language translations exist
    if (!translations[lang]) {
      console.warn(`Translation language not found: ${lang}`);
      return key;
    }
    
    let value: TranslationValue = translations[lang];
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as { [key: string]: TranslationValue })[k];
      } else {
        // Fallback to English if key not found in current language
        if (lang !== 'en' && translations['en']) {
          value = translations['en'];
          for (const fallbackKey of keys) {
            if (value && typeof value === 'object' && fallbackKey in value) {
              value = (value as { [key: string]: TranslationValue })[fallbackKey];
            } else {
              return key;
            }
          }
          return typeof value === 'string' ? value : key;
        }
        return key;
      }
    }
    
    return typeof value === 'string' ? value : key;
  }

  getArray(key: string): string[] {
    const keys = key.split('.');
    let value: TranslationValue = translations[this.currentLanguage()];
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as { [key: string]: TranslationValue })[k];
      } else {
        return [];
      }
    }
    
    if (Array.isArray(value)) {
      return value as string[];
    }
    return [];
  }

  /**
   * Translate a dropdown value from Polish to English
   * Used before sending config to AI
   */
  translateDropdownToEnglish(category: string, polishValue: string): string {
    if (!polishValue) return polishValue;
    const mapping = polishToEnglishMappings[category];
    if (!mapping) return polishValue;
    return mapping[polishValue] || polishValue;
  }

  /**
   * Translate a dropdown value from English to Polish
   * Used during export when language is Polish
   */
  translateDropdownToPolish(category: string, englishValue: string): string {
    if (!englishValue) return englishValue;
    const mapping = englishToPolishMappings[category];
    if (!mapping) return englishValue;
    return mapping[englishValue] || englishValue;
  }

  /**
   * Translate with retry using RxJS
   */
  private translateWithRetry(
    text: string,
    systemPrompt: string,
    maxTokens: number = 4000
  ): Observable<string> {
    const maxRetries = 10;
    
    return new Observable<string>(subscriber => {
      let attempt = 0;
      
      const tryTranslate = () => {
        attempt++;
        const messages = [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: text }
        ];

        const request = {
          model: localStorage.getItem('selected-model') || this.apiService.getDefaultModel().id,
          messages,
          temperature: 0.3,
          max_tokens: maxTokens
        };

        this.apiService.chatCompletion(request).pipe(
          take(1)
        ).subscribe({
          next: response => {
            const content = response.choices[0]?.message?.content;
            
            if (content && content.trim()) {
              subscriber.next(content.trim());
              subscriber.complete();
            } else if (attempt < maxRetries) {
              console.warn(`Translation attempt ${attempt} returned empty content, retrying...`);
              const delayMs = 1000 * Math.pow(2, attempt - 1);
              setTimeout(tryTranslate, delayMs);
            } else {
              subscriber.error(new Error('Translation returned empty content after all retries'));
            }
          },
          error: error => {
            console.warn(`Translation attempt ${attempt} failed:`, error);
            if (attempt < maxRetries) {
              const delayMs = 1000 * Math.pow(2, attempt - 1);
              setTimeout(tryTranslate, delayMs);
            } else {
              subscriber.error(error);
            }
          }
        });
      };

      tryTranslate();
    });
  }

  /**
   * Translate text field to English using AI - returns Observable
   * Used for character names, backgrounds, themes, etc.
   */
  translateTextToEnglish$(text: string): Observable<string> {
    if (!text || this.isEnglish()) return of(text);
    if (!text.trim()) return of(text);

    const systemPrompt = 'You are a translator. Translate the following Polish text to English. Return ONLY the translation, nothing else.';
    
    return this.translateWithRetry(text, systemPrompt).pipe(
      catchError(error => {
        console.error('Translation to English failed:', error);
        return of(text);
      })
    );
  }

  /**
   * Translate text field to English (Promise-based for backwards compatibility)
   * @deprecated Use translateTextToEnglish$() instead
   */
  translateTextToEnglish(text: string): Promise<string> {
    return new Promise(resolve => {
      this.translateTextToEnglish$(text).pipe(take(1)).subscribe(result => resolve(result));
    });
  }

  /**
   * Translate text to Polish using AI - returns Observable
   * Used during export
   */
  translateTextToPolish$(text: string): Observable<string> {
    if (!text) return of(text);
    if (!text.trim()) return of(text);

    const systemPrompt = 'You are a translator. Translate the following English text to Polish. Return ONLY the translation, nothing else.';
    
    return this.translateWithRetry(text, systemPrompt).pipe(
      catchError(error => {
        console.error('Translation to Polish failed:', error);
        return of(text);
      })
    );
  }

  /**
   * Translate text to Polish (Promise-based for backwards compatibility)
   * @deprecated Use translateTextToPolish$() instead
   */
  translateTextToPolish(text: string): Promise<string> {
    return new Promise(resolve => {
      this.translateTextToPolish$(text).pipe(take(1)).subscribe(result => resolve(result));
    });
  }

  /**
   * Translate book content (chapters) to Polish - returns Observable
   * Used during export - always translates English book content to Polish
   */
  translateContentToPolish$(content: string): Observable<string> {
    if (!content) return of(content);
    if (!content.trim()) return of(content);

    const systemPrompt = 'You are a professional literary translator. Translate the following English book content to Polish. Preserve the writing style, tone, and formatting. Maintain paragraph breaks. Return ONLY the translation.';
    
    return this.translateWithRetry(content, systemPrompt, 8000).pipe(
      catchError(error => {
        console.error('Content translation to Polish failed:', error);
        return of(content);
      })
    );
  }

  /**
   * Translate book content (Promise-based for backwards compatibility)
   * @deprecated Use translateContentToPolish$() instead
   */
  translateContentToPolish(content: string): Promise<string> {
    return new Promise(resolve => {
      this.translateContentToPolish$(content).pipe(take(1)).subscribe(result => resolve(result));
    });
  }

  /**
   * Translate chapter title to Polish - returns Observable
   */
  translateTitleToPolish$(title: string): Observable<string> {
    if (!title) return of(title);
    
    // Remove "Chapter X: " prefix if present
    const match = title.match(/^Chapter\s+\d+:\s*(.*)$/i);
    const titlePart = match ? match[1] : title;

    const systemPrompt = 'Translate the following English book chapter title to Polish. Return ONLY the translation, nothing else.';
    
    return this.translateWithRetry(titlePart, systemPrompt, 500).pipe(
      map(translatedTitle => {
        // Restore the "Chapter X: " prefix
        if (match) {
          const chapterNum = title.match(/^Chapter\s+(\d+)/i)?.[1] || '';
          return `Rozdział ${chapterNum}: ${translatedTitle}`;
        }
        return translatedTitle;
      }),
      catchError(error => {
        console.error('Title translation to Polish failed:', error);
        return of(title);
      })
    );
  }

  /**
   * Translate chapter title (Promise-based for backwards compatibility)
   * @deprecated Use translateTitleToPolish$() instead
   */
  translateTitleToPolish(title: string): Promise<string> {
    return new Promise(resolve => {
      this.translateTitleToPolish$(title).pipe(take(1)).subscribe(result => resolve(result));
    });
  }

  /**
   * Translate a full chapter (title and content) to Polish - returns Observable
   * Used during export - always translates English to Polish
   */
  translateChapterToPolish$(chapter: { title: string; content: string }): Observable<{ title: string; content: string }> {
    return forkJoin({
      title: this.translateTitleToPolish$(chapter.title),
      content: this.translateContentToPolish$(chapter.content)
    });
  }

  /**
   * Translate chapter (Promise-based for backwards compatibility)
   * @deprecated Use translateChapterToPolish$() instead
   */
  translateChapterToPolish(chapter: { title: string; content: string }): Promise<{ title: string; content: string }> {
    return new Promise(resolve => {
      this.translateChapterToPolish$(chapter).pipe(take(1)).subscribe(result => resolve(result));
    });
  }

  /**
   * Translate all chapters of a book to Polish - returns Observable
   * Used during export - always translates English to Polish
   */
  translateBookToPolish$(chapters: { title: string; content: string }[]): Observable<{ title: string; content: string }[]> {
    return forkJoin(
      chapters.map(chapter => this.translateChapterToPolish$(chapter))
    );
  }

  /**
   * Translate book (Promise-based for backwards compatibility)
   * @deprecated Use translateBookToPolish$() instead
   */
  translateBookToPolish(chapters: { title: string; content: string }[]): Promise<{ title: string; content: string }[]> {
    return new Promise(resolve => {
      this.translateBookToPolish$(chapters).pipe(take(1)).subscribe(result => resolve(result));
    });
  }
}
