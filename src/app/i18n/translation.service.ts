import { Injectable, signal, effect, inject } from '@angular/core';
import { Observable, of, throwError, forkJoin } from 'rxjs';
import { map, catchError, take } from 'rxjs/operators';
import en from './en.json';
import { ApiService } from '../core/api.service';
import { ProviderService } from '../core/providers/provider.service';
import { CritiqueReport } from '../models/critique.model';
import { Chapter } from '../models/chapter.model';
import { BookConfig, CharacterProfile } from '../models/book-config.model';
import { isRefusalOrSafety } from '../shared/utils/safety.util';
import { ExportLanguage, LANGUAGE_DISPLAY_NAME } from './export-labels';

export type { ExportLanguage } from './export-labels';

export type TranslationValue = string | string[] | { [key: string]: TranslationValue };

/**
 * The UI itself is English-only — there is no Polish (or any other
 * language) version of the interface. `en.json` is the only resource
 * bundle the UI translations read from.
 */
const translations: Record<'en', TranslationValue> = { en };

/**
 * Try to extract a JSON object from a string the model returned.
 *
 * The model's output is wrapped in [T]…[/T] markers and goes
 * through `cleanTranslation()` first, so by the time we get here
 * the string is usually a bare JSON object. We still try a few
 * fallback shapes because some models emit a fenced code block
 * around the JSON, or accidentally include a leading sentence.
 *
 * Returns `null` when no parseable JSON object can be recovered
 * — the caller then falls back to the original English text.
 */
function parseJsonInMarkers(raw: string | null | undefined): any | null {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;

  // Fast path: starts with `{` and ends with `}`.
  if (text.startsWith('{') && text.endsWith('}')) {
    try { return JSON.parse(text); } catch { /* fall through */ }
  }

  // Try to find the first `{` and the matching `}`.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const candidate = text.slice(first, last + 1);
    try { return JSON.parse(candidate); } catch { /* fall through */ }
  }

  // Try a fenced code block (`\`\`\`json ... \`\`\``).
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) {
    const candidate = fence[1].trim();
    try { return JSON.parse(candidate); } catch { /* fall through */ }
  }

  return null;
}

/**
 * Merge a (possibly partial) JSON critique object returned by
 * the LLM into the source `CritiqueReport`. Every field falls
 * back to the English original when the LLM response is
 * missing or wrong-typed — partial Polish is still better than
 * nothing, and the field-level fallbacks mean a truncated
 * response still produces a usable file.
 */
function mergeTranslatedCritique(source: CritiqueReport, translated: any | null): CritiqueReport {
  if (!translated || typeof translated !== 'object') return source;
  return {
    ...source,
    feedback: typeof translated.feedback === 'string' && translated.feedback
      ? translated.feedback
      : source.feedback,
    mustFix: Array.isArray(translated.mustFix)
      ? translated.mustFix.filter((s: any) => typeof s === 'string' && s.trim())
      : (Array.isArray(source.mustFix) ? source.mustFix : []),
    suggestions: Array.isArray(translated.suggestions)
      ? translated.suggestions.filter((s: any) => typeof s === 'string' && s.trim())
      : (Array.isArray(source.suggestions) ? source.suggestions : []),
    unavailableReason: typeof translated.unavailableReason === 'string' && translated.unavailableReason
      ? translated.unavailableReason
      : source.unavailableReason
  };
}

/**
 * Same idea for character profiles. Name is preserved as-is from
 * the source (proper nouns don't get translated), background /
 * motivations / flaws / arc are merged from the LLM response
 * with English fallbacks.
 */
function mergeTranslatedProfile(source: CharacterProfile | undefined, translated: any | null | undefined): CharacterProfile {
  if (!source) return source as unknown as CharacterProfile;
  if (!translated || typeof translated !== 'object') return source;
  return {
    ...source,
    name: source.name,
    background: typeof translated.background === 'string' && translated.background
      ? translated.background
      : source.background,
    motivations: Array.isArray(translated.motivations)
      ? translated.motivations.filter((s: any) => typeof s === 'string' && s.trim())
      : (Array.isArray(source.motivations) ? source.motivations : []),
    flaws: Array.isArray(translated.flaws)
      ? translated.flaws.filter((s: any) => typeof s === 'string' && s.trim())
      : (Array.isArray(source.flaws) ? source.flaws : []),
    arc: typeof translated.arc === 'string' && translated.arc
      ? translated.arc
      : source.arc
  };
}

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  private readonly STORAGE_KEY = 'app-language';
  private apiService = inject(ApiService);
  private providerService = inject(ProviderService);

  /**
   * The user's currently-selected export target language. Persisted
   * in localStorage so the next session opens with the same target
   * picked. Defaults to English so an uninitialised client does not
   * accidentally trigger a full-book LLM translation on first export.
   */
  private currentExportLanguage = signal<ExportLanguage>(this.getStoredExportLanguage());

  readonly exportLanguage = this.currentExportLanguage.asReadonly();

  constructor() {
    effect(() => {
      localStorage.setItem(this.STORAGE_KEY, this.currentExportLanguage());
    });
  }

  private getStoredExportLanguage(): ExportLanguage {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored && this.isExportLanguage(stored)) {
      return stored;
    }
    return 'en';
  }

  private isExportLanguage(value: string): value is ExportLanguage {
    return value in LANGUAGE_DISPLAY_NAME;
  }

  setExportLanguage(lang: ExportLanguage): void {
    this.currentExportLanguage.set(lang);
  }

  /**
   * Cheap, language-agnostic UI translation lookup. The app's UI is
   * English-only, so this is just a thin wrapper around `en.json`
   * with a key-path traversal and an English fallback. Kept for
   * backwards compatibility with existing call sites; no language
   * argument — the bundle is hardcoded to English.
   */
  get(key: string): string {
    const keys = key.split('.');
    let value: TranslationValue = translations.en;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as { [key: string]: TranslationValue })[k];
      } else {
        return key;
      }
    }

    return typeof value === 'string' ? value : key;
  }

  getArray(key: string): string[] {
    const keys = key.split('.');
    let value: TranslationValue = translations.en;

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
   * Strip LLM planning / preamble / scaffolding from a raw
   * translation response. Several models occasionally produce
   * output like:
   *
   *   "We need to translate the given English text into French,
   *    preserving style, tone, formatting, paragraph breaks, and
   *    return ONLY the translation. ... We'll go through paragraph
   *    by paragraph. Original:"
   *
   *   <actual translation>
   *
   * …or wrap the translation in markdown code fences. Without
   * cleaning, that scaffolding was being rendered to the user
   * inside the chapter body. Strategy:
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
      // Header lines like "Original:" / "Translation:" / target-language variants
      /^(original[:：].*|translation[:：].*|translated text[:：].*|here is the translation[:：]?\s*|here'?s the translation[:：]?\s*|translated version[:：]?\s*|translated content[:：]?\s*)/i
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
      // Last-resort: try to find a non-English block after a sentinel
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
   * Build a system prompt for translating English source text into
   * `target`. The same [T]...[/T] marker / no-preamble instructions
   * we used for Polish, but with the target language interpolated so
   * the model knows what to translate into.
   */
  private buildTranslationPrompt(target: ExportLanguage, kind: 'text' | 'title' | 'content'): string {
    const langName = LANGUAGE_DISPLAY_NAME[target];

    switch (kind) {
      case 'title':
        return `You are a translator. Translate the English book chapter title below into ${langName}. ` +
          `Wrap your response with [T] and [/T] markers, e.g. "[T]translated title[/T]". ` +
          `Do not include any preamble, explanation, or the original text inside or outside the markers.`;
      case 'content':
        return `You are a professional literary translator. Translate the English book content below into ${langName}. ` +
          `Preserve the writing style, tone, formatting, and paragraph breaks. ` +
          `Wrap your response with [T] and [/T] markers, e.g. "[T]translated content[/T]". ` +
          `Do not include any preamble, plan, explanation, or the original text inside or outside the markers. ` +
          `Do not say "we will go through paragraph by paragraph" or "Original:" — start directly with the translation inside the markers.`;
      case 'text':
      default:
        return `You are a translator. Translate the English text below into ${langName}. ` +
          `Wrap your response with [T] and [/T] markers, e.g. "[T]translation[/T]". ` +
          `Do not include any preamble, explanation, or the original text inside or outside the markers.`;
    }
  }

  /**
   * Translate a free-form text field (character background, theme,
   * short label, …) into the target language. Falls back to the
   * original text on failure rather than aborting the whole export.
   *
   * Kept for callers that still want a single-field translation,
   * but the export now prefers the per-chapter and per-metadata
   * batched calls below — they make ONE LLM request per chapter
   * / metadata blob instead of one per field, which keeps the
   * OpenRouter concurrency manageable and slashes the API bill
   * (a 5-chapter book used to fire ~50 parallel completions).
   */
  translateTextTo$(text: string, target: ExportLanguage): Observable<string> {
    if (!text) return of(text);
    if (typeof text !== 'string' || !text.trim()) return of(text);
    if (target === 'en') return of(text);

    return this.translateWithRetry(text, this.buildTranslationPrompt(target, 'text')).pipe(
      catchError(error => {
        console.error(`Translation to ${target} failed:`, error);
        return of(text);
      })
    );
  }

  /**
   * Translate a long-form chapter body into the target language.
   * Kept for callers that still want a single-field translation.
   * The export now uses the batched `translateChapterTo$` instead.
   */
  translateContentTo$(content: string, target: ExportLanguage): Observable<string> {
    if (!content) return of(content);
    if (typeof content !== 'string' || !content.trim()) return of(content);
    if (target === 'en') return of(content);

    return this.translateWithRetry(content, this.buildTranslationPrompt(target, 'content'), 8000).pipe(
      catchError(error => {
        console.error(`Content translation to ${target} failed:`, error);
        return of(content);
      })
    );
  }

  /**
   * Translate a chapter title into the target language. The "Chapter
   * N:" prefix is stripped before sending (the export rebuilds it
   * with the localised "Chapter"/"Rozdział"/"Chapitre" word in the
   * PDF / markdown labels) and re-attached after the translation
   * returns, using the target language's "Chapter" word.
   *
   * Kept for callers that still want a single-field translation.
   */
  translateTitleTo$(title: string, target: ExportLanguage, chapterWord: string): Observable<string> {
    if (!title) return of(title);
    if (typeof title !== 'string' || !title.trim()) return of(title);
    if (target === 'en') return of(title);

    // Strip "Chapter X: " prefix if present.
    const match = title.match(/^Chapter\s+\d+:\s*(.*)$/i);
    const titlePart = match ? match[1] : title;
    const chapterNum = title.match(/^Chapter\s+(\d+)/i)?.[1] || '';

    return this.translateWithRetry(titlePart, this.buildTranslationPrompt(target, 'title'), 500).pipe(
      map(translatedTitle => {
        if (match && chapterNum) {
          return `${chapterWord} ${chapterNum}: ${translatedTitle}`;
        }
        return translatedTitle;
      }),
      catchError(error => {
        console.error(`Title translation to ${target} failed:`, error);
        return of(title);
      })
    );
  }

  /**
   * Translate a critique's text fields (feedback, mustFix,
   * suggestions, unavailableReason) in ONE LLM call. The model
   * receives a JSON payload and returns a JSON object with the
   * same keys, wrapped in [T]…[/T] markers. On any failure
   * (parse error, API error, missing keys) the function falls
   * back to the original English critique so the rest of the
   * export still ships.
   *
   * Kept for backwards compat — the export now folds critique
   * translation into the per-chapter batched call
   * (`translateChapterTo$`) so the whole chapter is one LLM
   * request, not three+.
   */
  translateCritiqueTo$(critique: CritiqueReport, target: ExportLanguage): Observable<CritiqueReport> {
    if (!critique) {
      return of(null as unknown as CritiqueReport);
    }
    if (target === 'en') {
      return of(critique);
    }

    const payload: any = {
      feedback: critique.feedback || '',
      mustFix: Array.isArray(critique.mustFix) ? critique.mustFix : [],
      suggestions: Array.isArray(critique.suggestions) ? critique.suggestions : [],
      unavailableReason: critique.unavailableReason || ''
    };

    const langName = LANGUAGE_DISPLAY_NAME[target];
    const systemPrompt = `You are a translator. Translate the English book critique below into ${langName}. ` +
      `Preserve the JSON structure exactly: a top-level object with the keys "feedback" (string), ` +
      `"mustFix" (array of strings), "suggestions" (array of strings), and "unavailableReason" (string). ` +
      `Wrap your response with [T] and [/T] markers, e.g. "[T]{...}[/T]". ` +
      `Do not include any preamble, explanation, or the original text inside or outside the markers. ` +
      `Preserve the number of items in the mustFix and suggestions arrays.`;

    return this.translateWithRetry(JSON.stringify(payload), systemPrompt, 2000).pipe(
      map(cleaned => {
        const parsed = parseJsonInMarkers(cleaned);
        return mergeTranslatedCritique(critique, parsed && typeof parsed === 'object' ? parsed : null);
      }),
      catchError(err => {
        console.warn(`Critique translation to ${target} failed; keeping English copy.`, err);
        return of(critique);
      })
    );
  }

  /**
   * Translate a full chapter (title + content + critique) in ONE
   * LLM call. The model receives a JSON payload with the source
   * fields and returns a JSON object with the translated fields,
   * wrapped in [T]…[/T] markers so `cleanTranslation` strips any
   * preamble.
   *
   * This is the export's per-chapter translation path. The old
   * implementation fired 8+ parallel completions per chapter
   * (title + content + critique feedback + per-item mustFix +
   * per-item suggestions + unavailableReason), which adds up to
   * ~50 simultaneous requests for a 5-chapter book and crowds
   * out other API traffic. Batching into one call per chapter
   * cuts that down to N parallel calls (one per chapter) while
   * still producing a localised result.
   */
  translateChapterTo$(chapter: Chapter, target: ExportLanguage, chapterWord: string): Observable<Chapter> {
    if (!chapter) {
      return of(null as unknown as Chapter);
    }
    if (target === 'en') {
      return of(chapter);
    }

    const payload: any = {
      chapterWord,
      title: chapter.title || '',
      content: chapter.content || '',
      critique: chapter.critique
        ? {
            feedback: chapter.critique.feedback || '',
            mustFix: Array.isArray(chapter.critique.mustFix) ? chapter.critique.mustFix : [],
            suggestions: Array.isArray(chapter.critique.suggestions) ? chapter.critique.suggestions : [],
            unavailableReason: chapter.critique.unavailableReason || ''
          }
        : null
    };

    const langName = LANGUAGE_DISPLAY_NAME[target];
    const systemPrompt = `You are a literary translator. Translate the English book chapter below into ${langName}. ` +
      `The input is a JSON object with the keys "title" (string), "content" (string), ` +
      `"chapterWord" (the localised "Chapter" word, e.g. "Rozdział" for Polish — keep it as-is in the output title), ` +
      `and an optional "critique" object with "feedback" (string), ` +
      `"mustFix" (array of strings), "suggestions" (array of strings), "unavailableReason" (string). ` +
      `Return a JSON object with the SAME keys and translated values. ` +
      `For the title, re-emit it with the "chapterWord" prefix if the original had a "Chapter N:" prefix. ` +
      `Wrap your entire JSON response with [T] and [/T] markers, e.g. "[T]{...}[/T]". ` +
      `Do not include any preamble, explanation, or the original text inside or outside the markers. ` +
      `Preserve paragraph breaks and the number of items in the mustFix and suggestions arrays.`;

    return this.translateWithRetry(JSON.stringify(payload), systemPrompt, 12000).pipe(
      map(cleaned => {
        const parsed = parseJsonInMarkers(cleaned);
        if (!parsed || typeof parsed !== 'object') {
          return chapter;
        }
        return {
          ...chapter,
          title: typeof parsed.title === 'string' && parsed.title
            ? parsed.title
            : chapter.title,
          content: typeof parsed.content === 'string' && parsed.content
            ? parsed.content
            : chapter.content,
          critique: chapter.critique
            ? mergeTranslatedCritique(chapter.critique, parsed.critique)
            : chapter.critique
        };
      }),
      catchError(err => {
        console.warn(`Chapter translation to ${target} failed for chapter ${chapter.number} ("${chapter.title}"); keeping English copy.`, err);
        return of(chapter);
      })
    );
  }

  /**
   * Translate every chapter of a book into the target language.
   * One LLM call per chapter; chapters are translated in
   * parallel via `forkJoin` so a 5-chapter book fires 5
   * parallel calls instead of the previous ~50.
   */
  translateBookTo$(chapters: Chapter[], target: ExportLanguage, chapterWord: string): Observable<Chapter[]> {
    if (target === 'en') {
      return of(chapters);
    }
    return forkJoin(
      chapters.map(chapter => this.translateChapterTo$(chapter, target, chapterWord))
    );
  }

  /**
   * Translate the user-typed book metadata that ends up on the
   * cover, back cover, and title page of the export. The
   * orchestrator writes English, so without this pass the cover
   * ships the English title, English genre eyebrow, English
   * themes subtitle, and English protagonist name in the
   * back-cover blurb — even when the chapters themselves are
   * already translated into the target language.
   *
   * One LLM call for the whole metadata blob. The model receives
   * a JSON payload and returns a JSON object with the same keys,
   * wrapped in [T]…[/T] markers. On any failure the function
   * falls back to the original English metadata so the export
   * still completes.
   *
   * The structural enums (style, tone, pov, tense, audience,
   * plotArchetype, actStructure, worldType, targetLength,
   * chapterLength) are intentionally not translated — they only
   * feed the orchestrator's English prompts and never appear in
   * the exported file. The `genre` value lives in the type as a
   * `Genre` enum (e.g. "Fantasy") but the translated string is
   * not a valid `Genre` literal, so the result widens that field
   * to plain `string` — call sites that need the enum back fall
   * through to a no-op when the value isn't a known literal.
   */
  translateBookMetadataTo$(config: BookConfig, target: ExportLanguage): Observable<BookConfig> {
    if (target === 'en' || !config) {
      return of(config);
    }

    const payload: any = {
      title: config.title || '',
      genre: config.genre || '',
      plot: config.plot || '',
      themes: Array.isArray(config.themes) ? config.themes : [],
      protagonist: config.protagonist
        ? {
            name: config.protagonist.name || '',
            background: config.protagonist.background || '',
            motivations: Array.isArray(config.protagonist.motivations) ? config.protagonist.motivations : [],
            flaws: Array.isArray(config.protagonist.flaws) ? config.protagonist.flaws : [],
            arc: config.protagonist.arc || ''
          }
        : null,
      antagonist: config.antagonist
        ? {
            name: config.antagonist.name || '',
            background: config.antagonist.background || '',
            motivations: Array.isArray(config.antagonist.motivations) ? config.antagonist.motivations : [],
            flaws: Array.isArray(config.antagonist.flaws) ? config.antagonist.flaws : [],
            arc: config.antagonist.arc || ''
          }
        : null
    };

    const langName = LANGUAGE_DISPLAY_NAME[target];
    const systemPrompt = `You are a translator. Translate the English book metadata below into ${langName}. ` +
      `The input is a JSON object with "title" (string), "genre" (string), "plot" (string), ` +
      `"themes" (array of strings), and a "protagonist" / "antagonist" object each with ` +
      `"name" (string), "background" (string), "motivations" (array of strings), ` +
      `"flaws" (array of strings), "arc" (string). ` +
      `IMPORTANT: keep proper nouns (character names) as-is — do not translate "Aelara", "John", etc. ` +
      `Return a JSON object with the SAME keys and translated values. ` +
      `Wrap your entire JSON response with [T] and [/T] markers, e.g. "[T]{...}[/T]". ` +
      `Do not include any preamble, explanation, or the original text inside or outside the markers.`;

    return this.translateWithRetry(JSON.stringify(payload), systemPrompt, 2000).pipe(
      map(cleaned => {
        const parsed = parseJsonInMarkers(cleaned);
        if (!parsed || typeof parsed !== 'object') {
          return config;
        }
        return {
          ...config,
          title: typeof parsed.title === 'string' && parsed.title
            ? parsed.title
            : config.title,
          genre: (typeof parsed.genre === 'string' && parsed.genre
            ? parsed.genre
            : config.genre) as BookConfig['genre'],
          plot: typeof parsed.plot === 'string' && parsed.plot
            ? parsed.plot
            : config.plot,
          themes: Array.isArray(parsed.themes)
            ? parsed.themes.filter((s: any) => typeof s === 'string' && s.trim())
            : (Array.isArray(config.themes) ? config.themes : []),
          protagonist: mergeTranslatedProfile(config.protagonist, parsed.protagonist),
          antagonist: mergeTranslatedProfile(config.antagonist, parsed.antagonist)
        };
      }),
      catchError(err => {
        console.warn(`Book metadata translation to ${target} failed; keeping English copy.`, err);
        return of(config);
      })
    );
  }
}
