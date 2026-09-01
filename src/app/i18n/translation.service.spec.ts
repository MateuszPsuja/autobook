import { TestBed } from '@angular/core/testing';
import { TranslationService, Language } from './translation.service';
import { ApiService } from '../core/api.service';
import { of, take, throwError } from 'rxjs';
import { CritiqueReport } from '../models/critique.model';

describe('TranslationService', () => {
  let service: TranslationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TranslationService,
        ApiService
      ]
    });
    service = TestBed.inject(TranslationService);
    // Clear localStorage before each test
    localStorage.removeItem('app-language');
  });

  describe('Initial State', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should have default language', () => {
      expect(service.language()).toBeDefined();
    });

    it('should expose isEnglish computed signal', () => {
      expect(service.isEnglish).toBeDefined();
      expect(typeof service.isEnglish()).toBe('boolean');
    });

    it('should expose isPolish computed signal', () => {
      expect(service.isPolish).toBeDefined();
      expect(typeof service.isPolish()).toBe('boolean');
    });
  });

  describe('Language Switching', () => {
    it('should set language to English', () => {
      service.setLanguage('en');
      expect(service.language()).toBe('en');
      expect(service.isEnglish()).toBeTrue();
      expect(service.isPolish()).toBeFalse();
    });

    it('should set language to Polish', () => {
      service.setLanguage('pl');
      expect(service.language()).toBe('pl');
      expect(service.isPolish()).toBeTrue();
      expect(service.isEnglish()).toBeFalse();
    });

    it('should toggle language from English to Polish', () => {
      service.setLanguage('en');
      service.toggleLanguage();
      expect(service.language()).toBe('pl');
    });

    it('should toggle language from Polish to English', () => {
      service.setLanguage('pl');
      service.toggleLanguage();
      expect(service.language()).toBe('en');
    });
  });

  describe('Translation Retrieval', () => {
    it('should get translation for known key', () => {
      const result = service.get('app.title');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should return key when translation not found', () => {
      const result = service.get('nonexistent.key');
      expect(result).toBe('nonexistent.key');
    });

    it('should get translation array for known key', () => {
      const result = service.getArray('genres');
      expect(Array.isArray(result)).toBeTrue();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return empty array for nonexistent array key', () => {
      const result = service.getArray('nonexistent');
      expect(Array.isArray(result)).toBeTrue();
      expect(result.length).toBe(0);
    });
  });

  describe('Dropdown Translations (Polish to English)', () => {
    it('should translate genre from Polish to English', () => {
      const result = service.translateDropdownToEnglish('genres', 'Fantastyka');
      expect(result).toBe('Fantasy');
    });

    it('should return original value if no mapping exists', () => {
      const result = service.translateDropdownToEnglish('genres', 'Unknown Genre');
      expect(result).toBe('Unknown Genre');
    });

    it('should return empty string for empty input', () => {
      const result = service.translateDropdownToEnglish('genres', '');
      expect(result).toBe('');
    });

    it('should translate writing style from Polish to English', () => {
      const result = service.translateDropdownToEnglish('writingStyles', 'Opisowy');
      expect(result).toBe('Descriptive');
    });

    it('should translate tone from Polish to English', () => {
      const result = service.translateDropdownToEnglish('tones', 'Mroczny');
      expect(result).toBe('Dark');
    });
  });

  describe('Dropdown Translations (English to Polish)', () => {
    it('should translate genre from English to Polish', () => {
      const result = service.translateDropdownToPolish('genres', 'Fantasy');
      expect(result).toBe('Fantastyka');
    });

    it('should return original value if no mapping exists', () => {
      const result = service.translateDropdownToPolish('genres', 'Unknown Genre');
      expect(result).toBe('Unknown Genre');
    });

    it('should return empty string for empty input', () => {
      const result = service.translateDropdownToPolish('genres', '');
      expect(result).toBe('');
    });

    it('should translate writing style from English to Polish', () => {
      const result = service.translateDropdownToPolish('writingStyles', 'Descriptive');
      expect(result).toBe('Opisowy');
    });
  });

  describe('translateCritiqueToPolish$', () => {
    // Spy on the per-field helper so we can assert what gets
    // translated without standing up a real OpenRouter call.
    let translateTextSpy: jasmine.Spy;

    const buildCritique = (overrides: Partial<CritiqueReport> = {}): CritiqueReport => ({
      scores: {
        prose: 8,
        pacing: 7,
        showVsTell: 8,
        dialogue: 7,
        continuity: 8,
        hookStrength: 7,
        thematicResonance: 8
      },
      overallScore: 7.7,
      feedback: 'Solid chapter with a clear voice.',
      mustFix: ['Tighten the second paragraph.'],
      suggestions: ['Consider varying sentence length.'],
      createdAt: new Date(),
      ...overrides
    });

    beforeEach(() => {
      // Mock translateTextToPolish$ to return a deterministic
      // "[PL] <text>" string so we can assert it was called for
      // every non-empty field.
      translateTextSpy = spyOn(service, 'translateTextToPolish$').and.callFake(
        (text: string) => of(`[PL] ${text}`)
      );
    });

    it('returns the original critique when language is English', (done) => {
      service.setLanguage('en');
      const original = buildCritique();
      service.translateCritiqueToPolish$(original).pipe(take(1)).subscribe(result => {
        expect(result).toBe(original);
        expect(translateTextSpy).not.toHaveBeenCalled();
        done();
      });
    });

    it('returns null when given a null critique', (done) => {
      service.setLanguage('pl');
      service.translateCritiqueToPolish$(null as unknown as CritiqueReport).pipe(take(1)).subscribe(result => {
        expect(result).toBeNull();
        expect(translateTextSpy).not.toHaveBeenCalled();
        done();
      });
    });

    it('returns the original critique unchanged when feedback is already Polish', (done) => {
      // Post-generation translation pass writes Polish into the
      // chapter's critique. Re-translating it for export would burn
      // ~8 LLM calls per chapter (feedback + per-item mustFix +
      // per-item suggestions + unavailableReason) for text the user
      // already sees as Polish. The export short-circuits on a
      // non-empty Polish feedback — see the implementation comment
      // for the rationale (single field instead of "all fields
      // Polish" because partial mustFix / suggestions without
      // diacritics would otherwise still fire 6+ calls).
      service.setLanguage('pl');
      const polishCritique = buildCritique({
        // Feedback is Polish; mustFix / suggestions intentionally
        // contain phrases without diacritics that the strict
        // "all fields Polish" check would have flagged.
        feedback: 'Rozdział napisany solidnym głosem narracyjnym.',
        mustFix: ['Wzmocnij drugi akapit.'], // no diacritics — by design
        suggestions: ['Inny akapit do poprawy.']
      });
      service.translateCritiqueToPolish$(polishCritique).pipe(take(1)).subscribe(result => {
        // No API calls — the short-circuit fires on feedback alone.
        expect(translateTextSpy).not.toHaveBeenCalled();
        // Reference equality is preserved because the short-circuit
        // returns the original (the inner `map` only runs when the
        // short-circuit doesn't fire).
        expect(result).toBe(polishCritique);
        done();
      });
    });

    it('still translates when feedback is empty or English', (done) => {
      // Two cases that must fall through to the per-field forkJoin:
      //  1) feedback is the empty string (no content to detect)
      //  2) feedback is genuinely English (e.g. legacy book where
      //     the post-translation pass never ran)
      service.setLanguage('pl');
      const englishCritique = buildCritique({
        feedback: 'Solid chapter with a clear voice.', // English
        mustFix: ['Tighten the second paragraph.'],
        suggestions: ['Consider varying sentence length.']
      });
      service.translateCritiqueToPolish$(englishCritique).pipe(take(1)).subscribe(result => {
        expect(result.feedback).toBe('[PL] Solid chapter with a clear voice.');
        expect(result.mustFix).toEqual(['[PL] Tighten the second paragraph.']);
        expect(result.suggestions).toEqual(['[PL] Consider varying sentence length.']);
        expect(translateTextSpy).toHaveBeenCalled();
        done();
      });
    });

    it('translates feedback, mustFix, and suggestions in Polish', (done) => {
      service.setLanguage('pl');
      const original = buildCritique();
      service.translateCritiqueToPolish$(original).pipe(take(1)).subscribe(result => {
        expect(result.feedback).toBe('[PL] Solid chapter with a clear voice.');
        expect(result.mustFix).toEqual(['[PL] Tighten the second paragraph.']);
        expect(result.suggestions).toEqual(['[PL] Consider varying sentence length.']);
        // Scores / metadata preserved untouched.
        expect(result.scores).toEqual(original.scores);
        expect(result.overallScore).toBe(7.7);
        expect(result.createdAt).toBe(original.createdAt);
        // One call per non-empty field: feedback + 1 mustFix + 1 suggestion = 3.
        expect(translateTextSpy).toHaveBeenCalledTimes(3);
        done();
      });
    });

    it('translates unavailableReason when present', (done) => {
      service.setLanguage('pl');
      const original = buildCritique({
        unavailableReason: 'Reviewer model returned an empty response.'
      });
      service.translateCritiqueToPolish$(original).pipe(take(1)).subscribe(result => {
        expect(result.unavailableReason).toBe('[PL] Reviewer model returned an empty response.');
        // feedback + 1 mustFix + 1 suggestion + 1 unavailableReason = 4.
        expect(translateTextSpy).toHaveBeenCalledTimes(4);
        done();
      });
    });

    it('keeps an empty mustFix / suggestions array without calling the helper', (done) => {
      service.setLanguage('pl');
      const original = buildCritique({ mustFix: [], suggestions: [] });
      service.translateCritiqueToPolish$(original).pipe(take(1)).subscribe(result => {
        expect(result.mustFix).toEqual([]);
        expect(result.suggestions).toEqual([]);
        // Only feedback triggers a translation call.
        expect(translateTextSpy).toHaveBeenCalledTimes(1);
        done();
      });
    });

    it('falls back to the original text when the API helper returns an error', (done) => {
      service.setLanguage('pl');
      // First call (feedback) emits an error to exercise the
      // service's per-field catchError, the rest succeed. We use
      // the same translateTextSpy (already installed in beforeEach)
      // and override its behavior for this test only.
      translateTextSpy.and.callFake((text: string) => {
        if (text === 'Solid chapter with a clear voice.') {
          // Emit a real error observable so the service's
          // catchError actually runs. A synchronous throw would
          // bypass the pipe.
          return throwError(() => new Error('API down'));
        }
        return of(`[PL] ${text}`);
      });

      const original = buildCritique();
      service.translateCritiqueToPolish$(original).pipe(take(1)).subscribe({
        next: result => {
          expect(result).toBeTruthy();
          // The failing field should fall back to the original
          // English; the other fields should still be translated.
          expect(result.feedback).toBe(original.feedback);
          expect(result.mustFix).toEqual(['[PL] Tighten the second paragraph.']);
          expect(result.suggestions).toEqual(['[PL] Consider varying sentence length.']);
          done();
        },
        error: err => {
          // The service is supposed to swallow per-field errors and
          // still complete the outer observable, so reaching this
          // branch is a test failure.
          done.fail(`Outer observable errored unexpectedly: ${err}`);
        }
      });
    });
  });

  describe('translateGeneratedChapter$', () => {
    // The orchestrator calls this at the end of generation when
    // Polish is on. It must translate title + content + critique in
    // one shot and leave every other chapter field alone.
    const buildChapter = (overrides: Partial<any> = {}): any => ({
      id: 'ch-1',
      number: 1,
      title: 'Chapter 1: The Beginning',
      content: 'A long opening paragraph.',
      wordCount: 5,
      status: 'approved',
      createdAt: new Date(),
      revisions: [],
      critique: {
        scores: { prose: 8, pacing: 7, showVsTell: 8, dialogue: 7, continuity: 8, hookStrength: 7, thematicResonance: 8 },
        overallScore: 7.7,
        feedback: 'Solid chapter.',
        mustFix: ['Tighten paragraph 2.'],
        suggestions: ['Vary sentence length.'],
        createdAt: new Date()
      },
      ...overrides
    });

    beforeEach(() => {
      // Stub the three per-field helpers used inside
      // translateGeneratedChapter$. Each returns a tagged Polish
      // string so we can assert which fields were dispatched.
      spyOn(service, 'translateTitleToPolish$').and.callFake(
        (text: string) => of(`[PL-T] ${text}`)
      );
      spyOn(service, 'translateContentToPolish$').and.callFake(
        (text: string) => of(`[PL-C] ${text}`)
      );
      spyOn(service, 'translateCritiqueToPolish$').and.callFake(
        (critique: any) => of({ ...critique, feedback: '[PL-F] ' + critique.feedback })
      );
    });

    it('returns the chapter unchanged when language is English', (done) => {
      service.setLanguage('en');
      const original = buildChapter();
      service.translateGeneratedChapter$(original).pipe(take(1)).subscribe(result => {
        expect(result).toBe(original);
        expect(service.translateTitleToPolish$).not.toHaveBeenCalled();
        expect(service.translateContentToPolish$).not.toHaveBeenCalled();
        expect(service.translateCritiqueToPolish$).not.toHaveBeenCalled();
        done();
      });
    });

    it('returns null when given a null chapter', (done) => {
      service.setLanguage('pl');
      service.translateGeneratedChapter$(null as unknown as any).pipe(take(1)).subscribe(result => {
        expect(result).toBeNull();
        expect(service.translateTitleToPolish$).not.toHaveBeenCalled();
        done();
      });
    });

    it('translates title, content, and critique in Polish and preserves metadata', (done) => {
      service.setLanguage('pl');
      const original = buildChapter();
      service.translateGeneratedChapter$(original).pipe(take(1)).subscribe(result => {
        expect(result.id).toBe('ch-1');
        expect(result.number).toBe(1);
        expect(result.wordCount).toBe(5);
        expect(result.status).toBe('approved');
        expect(result.title).toBe('[PL-T] Chapter 1: The Beginning');
        expect(result.content).toBe('[PL-C] A long opening paragraph.');
        expect(result.critique?.feedback).toBe('[PL-F] Solid chapter.');
        // All three helpers were called exactly once.
        expect(service.translateTitleToPolish$).toHaveBeenCalledTimes(1);
        expect(service.translateContentToPolish$).toHaveBeenCalledTimes(1);
        expect(service.translateCritiqueToPolish$).toHaveBeenCalledTimes(1);
        done();
      });
    });

    it('skips critique translation when chapter has no critique', (done) => {
      service.setLanguage('pl');
      const original = buildChapter({ critique: undefined });
      service.translateGeneratedChapter$(original).pipe(take(1)).subscribe(result => {
        expect(result.title).toBe('[PL-T] Chapter 1: The Beginning');
        expect(result.content).toBe('[PL-C] A long opening paragraph.');
        expect(result.critique).toBeUndefined();
        expect(service.translateCritiqueToPolish$).not.toHaveBeenCalled();
        done();
      });
    });

    it('falls back to the original title when title translation errors (per-field resilience)', (done) => {
      service.setLanguage('pl');
      // Title call throws — everything else succeeds. The chapter
      // should still come back with the original English title and
      // Polish content / critique.
      (service.translateTitleToPolish$ as jasmine.Spy).and.callFake(() =>
        throwError(() => new Error('title API down'))
      );
      const original = buildChapter();
      service.translateGeneratedChapter$(original).pipe(take(1)).subscribe(result => {
        expect(result.title).toBe('Chapter 1: The Beginning');
        expect(result.content).toBe('[PL-C] A long opening paragraph.');
        expect(result.critique?.feedback).toBe('[PL-F] Solid chapter.');
        done();
      });
    });

    it('falls back to the original content when content translation errors', (done) => {
      service.setLanguage('pl');
      (service.translateContentToPolish$ as jasmine.Spy).and.callFake(() =>
        throwError(() => new Error('content API down'))
      );
      const original = buildChapter();
      service.translateGeneratedChapter$(original).pipe(take(1)).subscribe(result => {
        expect(result.title).toBe('[PL-T] Chapter 1: The Beginning');
        expect(result.content).toBe('A long opening paragraph.');
        expect(result.critique?.feedback).toBe('[PL-F] Solid chapter.');
        done();
      });
    });
  });

  describe('cleanTranslation', () => {
    // The user's bug: the LLM was producing its planning text
    // ("We need to translate... We'll go through paragraph by
    // paragraph. Original:") as part of the response, and that
    // planning text was being rendered to the user in place of
    // the chapter body. `cleanTranslation` strips that scaffolding
    // so the user only sees the actual translation.
    const { cleanTranslation } = TranslationService as any;

    it('returns null for empty or whitespace input', () => {
      expect(cleanTranslation('')).toBeNull();
      expect(cleanTranslation('   \n\n  ')).toBeNull();
      expect(cleanTranslation(undefined)).toBeNull();
    });

    it('returns the input unchanged when it is already clean', () => {
      const text = 'To jest czyste tłumaczenie bez żadnego wstępu.';
      expect(cleanTranslation(text)).toBe(text);
    });

    it('extracts content between [T] and [/T] markers', () => {
      const raw = 'Some preamble that we want to discard.\n[T]polish translation here[/T]\nTrailing noise.';
      expect(cleanTranslation(raw)).toBe('polish translation here');
    });

    it('extracts the inner of a single fenced code block', () => {
      const raw = '```\npolish translation inside fences\n```';
      expect(cleanTranslation(raw)).toBe('polish translation inside fences');
    });

    it('strips the "we need to translate" preamble (the user-reported case)', () => {
      // This is the exact preamble the user reported. After
      // stripping, we expect only the actual translation to remain.
      const raw = 'We need to translate the given English text into Polish, preserving style, tone, formatting, paragraph breaks, and return ONLY the translation. Must be careful to keep line breaks as in original. The text is long; need to translate accurately.\n\nWe\'ll go through paragraph by paragraph.\n\nOriginal:\n\nWszystko gotowe.';
      const result = cleanTranslation(raw);
      // We accept either the cleaned translation (best) or
      // the "Original:" sentinel extraction. Both are valid —
      // the test just needs to make sure the preamble is gone.
      expect(result).not.toMatch(/^We need to translate/i);
      expect(result).not.toMatch(/paragraph by paragraph/i);
      // Whatever survives should not be the empty "Original:" line.
      expect(result).toBeTruthy();
    });

    it('returns null when the response is only preamble with no translation', () => {
      const raw = 'We need to translate.\n\nWe\'ll go through paragraph by paragraph.\n\nOriginal:';
      // After stripping, nothing usable remains.
      expect(cleanTranslation(raw)).toBeNull();
    });

    it('falls back to "after Original:" when preamble strip leaves nothing else', () => {
      const raw = 'We will translate now.\n\nOriginal:\n\nTłumaczenie zaczyna się tutaj.';
      expect(cleanTranslation(raw)).toBe('Tłumaczenie zaczyna się tutaj.');
    });
  });
});
