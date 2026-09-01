import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Observable, of, EMPTY, throwError, forkJoin } from 'rxjs';
import { map, switchMap, catchError, take, delay as rxDelay } from 'rxjs/operators';
import en from './en.json';
import pl from './pl.json';
import { ApiService } from '../core/api.service';
import { ProviderService } from '../core/providers/provider.service';
import { CritiqueReport } from '../models/critique.model';
import { Chapter } from '../models/chapter.model';
import { isRefusalOrSafety } from '../shared/utils/safety.util';

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
    'Opowiadanie': 'Short Story',
    'Nowela': 'Novella',
    'Powieść': 'Novel',
    'Epika': 'Epic'
  },
  chapterLengths: {
    'Krótki': 'Short',
    'Standardowy': 'Standard',
    'Długi': 'Long'
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
    'Short Story': 'Opowiadanie',
    'Novella': 'Nowela',
    'Novel': 'Powieść',
    'Epic': 'Epika'
  },
  chapterLengths: {
    'Short': 'Krótki',
    'Standard': 'Standardowy',
    'Long': 'Długi'
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
  private providerService = inject(ProviderService);
  
  private currentLanguage = signal<Language>(this.getStoredLanguage());
  
  readonly language = computed(() => this.currentLanguage());
  
  readonly isEnglish = computed(() => this.currentLanguage() === 'en');
  readonly isPolish = computed(() => this.currentLanguage() === 'pl');

  /**
   * Cheap heuristic for "this string is already in Polish". Looks for
   * the diacritics that don't occur in English source text: ą, ć, ę,
   * ł, ń, ó, ś, ź, ż and their uppercase forms. Used by the chapter
   * viewer to skip an API call when the source critique is already
   * Polish (e.g. after the post-generation translation pass).
   *
   * The check is intentionally low-cost and conservative — it
   * returns true only when at least one Polish-specific character is
   * present, so an English string with the occasional "a" or "e"
   * doesn't false-positive.
   */
  looksPolish(text: string | null | undefined): boolean {
    if (!text) return false;
    return /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text);
  }

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
   * Translate with retry using RxJS. Every successful response is
   * run through `cleanTranslation()` to strip LLM planning text
   * (e.g. "We'll go through paragraph by paragraph. Original:") that
   * some models emit before getting to the actual translation —
   * without that step the planning text ended up rendered in the
   * reader in place of the chapter body. If the cleaned response is
   * empty, we retry; if we still get nothing usable after all
   * retries the outer callers fall back to the original text.
   *
   * Retry budget: 15 attempts with exponential backoff capped at
   * 8s. The cap matters — without it, the 10th retry would wait
   * 8.5 minutes, and a chapter's worth of title + content + critique
   * translations could each burn that, leaving the user staring at
   * a frozen "Translating…" header for an hour.
   */
  private translateWithRetry(
    text: string,
    systemPrompt: string,
    maxTokens: number = 4000
  ): Observable<string> {
    const maxRetries = 15;
    const maxBackoffMs = 8000;

    return new Observable<string>(subscriber => {
      let attempt = 0;

      const tryTranslate = () => {
        attempt++;
        const messages = [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: text }
        ];

        const request = {
          model: this.providerService.getSelectedModel() || this.apiService.getDefaultModel().id,
          messages,
          temperature: 0.3,
          max_tokens: maxTokens
        };

        this.apiService.chatCompletion(request).pipe(
          take(1)
        ).subscribe({
          next: response => {
            const content = response.choices?.[0]?.message?.content;
            const finishReason = response.choices?.[0]?.finish_reason;

            // Safety-filter / content-policy responses are not a
            // translation — they're a refusal. Retry the same way
            // we retry an empty response; the model might pick a
            // different code path on a re-prompt, and if all
            // retries hit the safety filter, the caller falls back
            // to the original text (so the chapter stays in
            // English rather than rendering a metadata block).
            if (isRefusalOrSafety(content, finishReason)) {
              if (attempt < maxRetries) {
                const delayMs = Math.min(maxBackoffMs, 500 * Math.pow(1.7, attempt - 1));
                console.warn(
                  `Translation attempt ${attempt}/${maxRetries} returned a safety / content-policy response (finish_reason=${finishReason ?? 'n/a'}), retrying in ${Math.round(delayMs)}ms...`
                );
                setTimeout(tryTranslate, delayMs);
                return;
              }
              console.error(
                `Translation gave up after ${maxRetries} attempts (model kept returning safety responses)`
              );
              subscriber.error(new Error('Translation returned a safety / content-policy response after all retries'));
              return;
            }

            const cleaned = TranslationService.cleanTranslation(content || '');

            if (cleaned) {
              subscriber.next(cleaned);
              subscriber.complete();
            } else if (attempt < maxRetries) {
              const delayMs = Math.min(maxBackoffMs, 500 * Math.pow(1.7, attempt - 1));
              console.warn(
                `Translation attempt ${attempt}/${maxRetries} returned no usable content (raw length=${(content || '').length}), retrying in ${Math.round(delayMs)}ms...`
              );
              setTimeout(tryTranslate, delayMs);
            } else {
              console.error(
                `Translation gave up after ${maxRetries} attempts (last raw length=${(content || '').length})`
              );
              subscriber.error(new Error('Translation returned empty content after all retries'));
            }
          },
          error: error => {
            console.warn(`Translation attempt ${attempt}/${maxRetries} failed:`, error);
            if (attempt < maxRetries) {
              const delayMs = Math.min(maxBackoffMs, 500 * Math.pow(1.7, attempt - 1));
              setTimeout(tryTranslate, delayMs);
            } else {
              console.error(`Translation gave up after ${maxRetries} attempts`);
              subscriber.error(error);
            }
          }
        });
      };

      tryTranslate();
    });
  }

  /**
   * Strip LLM planning / preamble / scaffolding from a raw
   * translation response. Several models occasionally produce
   * output like:
   *
   *   "We need to translate the given English text into Polish,
   *    preserving style, tone, formatting, paragraph breaks, and
   *    return ONLY the translation. ... We'll go through paragraph
   *    by paragraph. Original:"
   *
   *   <actual translation>
   *
   * …or wrap the translation in markdown code fences. Without
   * cleaning, that scaffolding was being rendered to the user
   * inside the chapter body / feedback panel. Strategy:
   *
   *   1. If the response has a [T]...[/T] marker pair (we now
   *      instruct models to use it), return the inner content.
   *   2. Else if the response is wrapped in a single ``` fenced
   *      code block, return the block contents.
   *   3. Else strip known preamble lines (case-insensitive)
   *      until we find something that looks like actual translated
   *      text. Returns the cleaned text, or null when nothing
   *      usable remains (caller retries / falls back).
   */
  static cleanTranslation(raw: string): string | null {
    if (!raw) return null;
    const text = raw.trim();
    if (!text) return null;

    // 1. Explicit [T]...[/T] markers (our prompt asks for them).
    const markerMatch = text.match(/\[T\]([\s\S]*?)\[\/T\]/);
    if (markerMatch && markerMatch[1] && markerMatch[1].trim()) {
      return markerMatch[1].trim();
    }

    // 2. A single fenced code block (```...```) wrapping the body.
    const fenceMatch = text.match(/^```(?:[a-zA-Z]*\n)?([\s\S]*?)```\s*$/);
    if (fenceMatch && fenceMatch[1] && fenceMatch[1].trim()) {
      return fenceMatch[1].trim();
    }

    // 3. Strip known preamble / scaffold lines until we find
    //    something that looks like the actual translation. We
    //    keep stripping while the first remaining line matches
    //    one of the well-known "I'm about to translate"
    //    phrasings. The list is intentionally broad: a stricter
    //    filter would let through novel planning phrasings the
    //    user has already hit in production.
    const preamblePatterns: RegExp[] = [
      // "we need to translate..." / "we will translate..." /
      // "let's translate..." / "let me translate..." /
      // "i will translate..." / "i'll translate..."
      /^(we need to translate[^\n]*|we will translate[^\n]*|we'?ll translate[^\n]*|let'?s translate[^\n]*|let me translate[^\n]*|let us translate[^\n]*|i will translate[^\n]*|i'?ll translate[^\n]*|i'?m going to translate[^\n]*|i am going to translate[^\n]*)/i,
      // "we'll go through..." / "we will proceed..."
      /^(we'?ll go through[^\n]*|we will go through[^\n]*|i'?ll go through[^\n]*|i will go through[^\n]*|we'?ll proceed[^\n]*|i'?ll proceed[^\n]*|i will proceed[^\n]*)/i,
      // "paragraph by paragraph" / "section by section"
      /^(paragraph by paragraph[^\n]*|section by section[^\n]*|line by line[^\n]*|sentence by sentence[^\n]*)/i,
      // Acknowledgement openers: "Sure." / "Of course." / "Certainly."
      /^(sure[^\n,.]*[,.]\s*$|of course[^\n,.]*[,.]\s*$|certainly[^\n,.]*[,.]\s*$|okay[^\n,.]*[,.]\s*$|alright[^\n,.]*[,.]\s*$|got it[^\n,.]*[,.]\s*$|i understand[^\n,.]*[,.]\s*$|here you go[^\n,.]*[,.]\s*$)/i,
      // Header lines like "Original:" / "Translation:" / "Tłumaczenie:"
      /^(original[:：].*|translation[:：].*|tlumaczenie[:：].*|tłumaczenie[:：].*|translated text[:：].*|here is the translation[:：]?\s*|here'?s the translation[:：]?\s*|translated version[:：]?\s*|polish translation[:：]?\s*|przetłumaczone[:：]?\s*|tl[:：].*|tłum[:：].*|translated content[:：]?\s*)/i
    ];

    let lines = text.split(/\r?\n/);
    let stripped = 0;
    while (lines.length > 0) {
      const first = lines[0].trim();
      if (!first) {
        // Skip leading blank lines.
        lines.shift();
        stripped++;
        continue;
      }
      const matchesPreamble = preamblePatterns.some(p => p.test(first));
      if (!matchesPreamble) break;
      lines.shift();
      stripped++;
    }

    let cleaned = lines.join('\n').trim();
    if (!cleaned) {
      // Last-resort: try to find a Polish block after a sentinel
      // line like "Original:" that some models emit before the
      // actual translation. Drop the sentinel itself (no newline
      // required — the sentinel can be the last line of the
      // response, in which case the replace still strips it and
      // `afterSentinel` is empty, and we return null so the
      // caller retries instead of rendering the bare "Original:"
      // header).
      const sentinelIdx = text.search(/^\s*original[:：]\s*$/im);
      if (sentinelIdx < 0) {
        return null;
      }
      const afterSentinel = text.slice(sentinelIdx).replace(/^\s*original[:：]\s*/i, '').trim();
      if (!afterSentinel) {
        return null;
      }
      cleaned = afterSentinel;
    }

    if (!cleaned) return null;
    return cleaned;
  }

  /**
   * Translate text field to English using AI - returns Observable
   * Used for character names, backgrounds, themes, etc.
   */
  translateTextToEnglish$(text: string): Observable<string> {
    if (!text || this.isEnglish()) return of(text);
    if (!text.trim()) return of(text);

    const systemPrompt = 'You are a translator. Translate the Polish text below into English. ' +
      'Wrap your response with [T] and [/T] markers, e.g. "[T]translation[/T]". ' +
      'Do not include any preamble, explanation, or the original text inside or outside the markers.';

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

    const systemPrompt = 'You are a translator. Translate the English text below into Polish. ' +
      'Wrap your response with [T] and [/T] markers, e.g. "[T]tłumaczenie[/T]". ' +
      'Do not include any preamble, explanation, or the original text inside or outside the markers.';

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

    const systemPrompt = 'You are a professional literary translator. Translate the English book content below into Polish. ' +
      'Preserve the writing style, tone, formatting, and paragraph breaks. ' +
      'Wrap your response with [T] and [/T] markers, e.g. "[T]polish content[/T]". ' +
      'Do not include any preamble, plan, explanation, or the original text inside or outside the markers. ' +
      'Do not say "we will go through paragraph by paragraph" or "Original:" — start directly with the Polish translation inside the markers.';

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

    const systemPrompt = 'Translate the English book chapter title below into Polish. ' +
      'Wrap your response with [T] and [/T] markers, e.g. "[T]polish title[/T]". ' +
      'Do not include any preamble, explanation, or the original text inside or outside the markers.';

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

  /**
   * Translate a critique's text fields (feedback, mustFix, suggestions,
   * unavailableReason) to Polish. Runs the field translations in
   * parallel via forkJoin so the user waits for the slowest one,
   * not the sum of all of them.
   *
   * Returns the original report unchanged when the current language
   * is English, or when every translatable field is already in
   * Polish (the post-generation translation pass writes Polish
   * text into `chapter.critique` for new runs — without this
   * short-circuit, the export would re-translate every chapter's
   * critique for the entire book, firing one LLM call per item in
   * `mustFix`/`suggestions` on top of the per-field feedback /
   * unavailableReason calls. For a 5-chapter book that was 30-40
   * wasted chat completions). Empty / missing fields are preserved
   * as-is. On a translation failure for any field, that field is
   * left as the original English text (logged) rather than failing
   * the whole critique — partial Polish is better than nothing.
   */
  translateCritiqueToPolish$(critique: CritiqueReport): Observable<CritiqueReport> {
    if (!critique) {
      return of(null as unknown as CritiqueReport);
    }
    if (this.isEnglish()) {
      return of(critique);
    }

    // Already-Polish short-circuit. The post-generation translation
    // pass translates the entire critique to Polish and writes it
    // back to the chapter state. The export (and the chapter
    // viewer) re-call us on every chapter, so a strict "all fields
    // Polish" check would still fire 6-8 LLM calls per chapter
    // whenever the post-translation pass left any single mustFix /
    // suggestions item untranslated (e.g. a `safeText$` failure
    // for one item, a per-field retry that exhausted its budget,
    // or simply a Polish phrase with no diacritics like
    // "Wzmocnij akapit" that the heuristic can't fingerprint).
    //
    // The user-visible signal is `feedback` — that's what the
    // critique panel shows prominently. If feedback is in Polish
    // the rest of the critique is almost certainly Polish too
    // (it was translated by the same model in the same pass), and
    // the few items without diacritics aren't worth 6+ LLM calls
    // to round-trip. We short-circuit on a non-empty Polish
    // feedback; empty / English feedback falls through to the
    // per-field forkJoin as before.
    if (critique.feedback && critique.feedback.trim() && this.looksPolish(critique.feedback)) {
      return of(critique);
    }

    const safeText$ = (text: string | undefined): Observable<string> => {
      if (!text || !text.trim()) return of(text || '');
      // Per-field short-circuit: a single Polish item in a mostly-
      // English critique shouldn't cost an LLM call either. This
      // also matters when the whole critique is Polish (the
      // top-level `allFieldsPolish` check passes through here with
      // every individual field Polish, so each is a no-op).
      if (this.looksPolish(text)) return of(text);
      return this.translateTextToPolish$(text).pipe(
        catchError(err => {
          console.warn('Critique field translation to Polish failed:', err);
          return of(text);
        })
      );
    };

    const safeList$ = (items: string[] | undefined): Observable<string[]> => {
      if (!items || items.length === 0) return of(items || []);
      const translated$ = items.map(item => safeText$(item));
      return forkJoin(translated$);
    };

    return forkJoin({
      feedback: safeText$(critique.feedback),
      mustFix: safeList$(critique.mustFix),
      suggestions: safeList$(critique.suggestions),
      unavailableReason: safeText$(critique.unavailableReason)
    }).pipe(
      map(({ feedback, mustFix, suggestions, unavailableReason }) => ({
        ...critique,
        feedback,
        mustFix,
        suggestions,
        unavailableReason: unavailableReason || critique.unavailableReason
      }))
    );
  }

  /**
   * Translate every user-visible text field of a generated chapter
   * (title, content, and critique if present) to Polish. Used by
   * the orchestrator's post-generation step so the viewer's state
   * ends up in the user's chosen language without per-render work.
   *
   * The title, content, and critique translations all run in
   * parallel via forkJoin. If the current language is English the
   * chapter is returned unchanged. On any per-field failure (after
   * the per-field retry budget in `translateWithRetry` is exhausted)
   * the field falls back to its original text — so a broken API
   * call for one field can't take the whole chapter down. The
   * user gets a partially-Polish chapter rather than a fully-broken
   * one.
   */
  translateGeneratedChapter$(chapter: Chapter): Observable<Chapter> {
    if (!chapter) {
      return of(null as unknown as Chapter);
    }
    if (this.isEnglish()) {
      return of(chapter);
    }

    const safeTitle$ = this.translateTitleToPolish$(chapter.title).pipe(
      catchError(err => {
        console.warn(`Title translation to Polish failed for chapter "${chapter.title}"; keeping English title.`, err);
        return of(chapter.title);
      })
    );
    const safeContent$ = this.translateContentToPolish$(chapter.content).pipe(
      catchError(err => {
        console.warn(`Content translation to Polish failed for chapter ${chapter.number} (${chapter.content.length} chars); keeping English content.`, err);
        return of(chapter.content);
      })
    );
    const safeCritique$ = chapter.critique
      ? this.translateCritiqueToPolish$(chapter.critique)
      : of(undefined);

    return forkJoin({
      title: safeTitle$,
      content: safeContent$,
      critique: safeCritique$
    }).pipe(
      map(({ title, content, critique }) => ({
        ...chapter,
        title,
        content,
        critique: critique || chapter.critique
      }))
    );
  }
}
