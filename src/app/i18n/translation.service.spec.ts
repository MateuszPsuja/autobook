import { TestBed } from '@angular/core/testing';
import { TranslationService } from './translation.service';
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

    it('should default the export language to English', () => {
      // No stored value → default to 'en' so a fresh client does
      // not accidentally fire a full-book LLM translation on first
      // export.
      expect(service.exportLanguage()).toBe('en');
    });
  });

  describe('Export Language Switching', () => {
    it('should set the export language to Spanish', () => {
      service.setExportLanguage('es');
      expect(service.exportLanguage()).toBe('es');
    });

    it('should accept every supported export language', () => {
      const codes: Array<'en' | 'pl' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'nl' | 'ru' | 'uk' | 'cs'> = [
        'en', 'pl', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'uk', 'cs'
      ];
      for (const code of codes) {
        service.setExportLanguage(code);
        expect(service.exportLanguage()).toBe(code);
      }
    });

    it('persists the export language to localStorage', () => {
      // The service writes the language to localStorage via an
      // Angular effect. Outside a TestBed-injected context the
      // effect doesn't run automatically, so we exercise the
      // write path by triggering the effect manually with
      // TestBed.flushEffects — which spins up the harness the
      // TestBed module would otherwise set up.
      TestBed.flushEffects();
      service.setExportLanguage('de');
      TestBed.flushEffects();
      const stored = localStorage.getItem('app-language');
      expect(stored).toBe('de');
    });
  });

  describe('Translation Retrieval (UI strings)', () => {
    it('should get a translation for a known key', () => {
      const result = service.get('app.title');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should return the key when the translation is not found', () => {
      const result = service.get('nonexistent.key');
      expect(result).toBe('nonexistent.key');
    });

    it('should get a translation array for a known key', () => {
      const result = service.getArray('genres');
      expect(Array.isArray(result)).toBeTrue();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return an empty array for a nonexistent key', () => {
      const result = service.getArray('nonexistent');
      expect(Array.isArray(result)).toBeTrue();
      expect(result.length).toBe(0);
    });
  });

  describe('translateTextTo$', () => {
    it('returns the original text when the target is English', (done) => {
      const result = service.translateTextTo$('Hello world', 'en');
      result.pipe(take(1)).subscribe(value => {
        expect(value).toBe('Hello world');
        done();
      });
    });

    it('returns the original text unchanged when input is empty', (done) => {
      const empty = service.translateTextTo$('', 'fr');
      const whitespace = service.translateTextTo$('   ', 'fr');
      empty.pipe(take(1)).subscribe(v1 => {
        expect(v1).toBe('');
        whitespace.pipe(take(1)).subscribe(v2 => {
          expect(v2).toBe('   ');
          done();
        });
      });
    });
  });

  describe('translateCritiqueTo$', () => {
    // The export now folds critique translation into the
    // per-chapter batched call, but the standalone helper is
    // still public for callers that want a single critique. It
    // does ONE LLM call returning a JSON object.
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

    it('returns the original critique when target is English', (done) => {
      const original = buildCritique();
      service.translateCritiqueTo$(original, 'en').pipe(take(1)).subscribe(result => {
        expect(result).toBe(original);
        done();
      });
    });

    it('returns null when given a null critique', (done) => {
      service.translateCritiqueTo$(null as unknown as CritiqueReport, 'fr').pipe(take(1)).subscribe(result => {
        expect(result).toBeNull();
        done();
      });
    });

    it('parses the JSON response and merges translated fields into the source critique', (done) => {
      // Stub the private `translateWithRetry` so we control what
      // comes back from the LLM boundary. The real implementation
      // would have wrapped the response in [T]…[/T] markers
      // already (via `cleanTranslation`), but the test stub
      // skips that for simplicity — `parseJsonInMarkers` is
      // robust enough to handle both shapes.
      const translatedJson = {
        feedback: '[FR] Solid chapter with a clear voice.',
        mustFix: ['[FR] Tighten the second paragraph.'],
        suggestions: ['[FR] Consider varying sentence length.'],
        unavailableReason: ''
      };
      spyOn(service as any, 'translateWithRetry').and.callFake(
        (_text: string, _prompt: string, _maxTokens: number) => of(JSON.stringify(translatedJson))
      );

      const original = buildCritique();
      service.translateCritiqueTo$(original, 'fr').pipe(take(1)).subscribe(result => {
        expect(result.feedback).toBe('[FR] Solid chapter with a clear voice.');
        expect(result.mustFix).toEqual(['[FR] Tighten the second paragraph.']);
        expect(result.suggestions).toEqual(['[FR] Consider varying sentence length.']);
        // Scores / metadata preserved untouched.
        expect(result.scores).toEqual(original.scores);
        expect(result.overallScore).toBe(7.7);
        expect(result.createdAt).toBe(original.createdAt);
        done();
      });
    });

    it('falls back to the original critique when the LLM call errors', (done) => {
      spyOn(service as any, 'translateWithRetry').and.callFake(
        () => throwError(() => new Error('API down'))
      );

      const original = buildCritique();
      service.translateCritiqueTo$(original, 'fr').pipe(take(1)).subscribe({
        next: result => {
          // The per-field error fallback lands on the original
          // English critique, not a partial Polish copy.
          expect(result).toBe(original);
          done();
        },
        error: err => done.fail(`Outer observable errored unexpectedly: ${err}`)
      });
    });

    it('falls back to the original critique when the LLM returns unparseable garbage', (done) => {
      // The model occasionally returns a non-JSON string (e.g.
      // an empty response after a safety refusal, or a stray
      // preamble that didn't get stripped). The merge helper
      // should land on the original English critique rather than
      // blanking the panel.
      spyOn(service as any, 'translateWithRetry').and.callFake(
        () => of('this is not JSON at all')
      );

      const original = buildCritique();
      service.translateCritiqueTo$(original, 'fr').pipe(take(1)).subscribe(result => {
        expect(result).toBe(original);
        done();
      });
    });
  });

  describe('translateChapterTo$', () => {
    // The export calls this once per chapter. It does ONE LLM
    // call returning a JSON object with the translated title,
    // content, and (optional) critique. The previous per-field
    // fanout was removed because it fired 8+ parallel
    // completions per chapter.
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

    it('returns the chapter unchanged when target is English', (done) => {
      const original = buildChapter();
      service.translateChapterTo$(original, 'en', 'Chapter').pipe(take(1)).subscribe(result => {
        expect(result).toBe(original);
        done();
      });
    });

    it('returns null when given a null chapter', (done) => {
      service.translateChapterTo$(null as unknown as any, 'fr', 'Chapitre').pipe(take(1)).subscribe(result => {
        expect(result).toBeNull();
        done();
      });
    });

    it('parses the JSON response and merges translated fields into the source chapter', (done) => {
      const translatedJson = {
        title: 'Chapitre 1 : Le Commencement',
        content: '[FR] Un long paragraphe d\'ouverture.',
        critique: {
          feedback: '[FR] Chapitre solide.',
          mustFix: ['[FR] Resserrer le deuxième paragraphe.'],
          suggestions: ['[FR] Varier la longueur des phrases.'],
          unavailableReason: ''
        }
      };
      spyOn(service as any, 'translateWithRetry').and.callFake(
        (_text: string, _prompt: string, _maxTokens: number) => of(JSON.stringify(translatedJson))
      );

      const original = buildChapter();
      service.translateChapterTo$(original, 'fr', 'Chapitre').pipe(take(1)).subscribe(result => {
        expect(result.title).toBe('Chapitre 1 : Le Commencement');
        expect(result.content).toBe('[FR] Un long paragraphe d\'ouverture.');
        expect(result.critique?.feedback).toBe('[FR] Chapitre solide.');
        expect(result.critique?.mustFix).toEqual(['[FR] Resserrer le deuxième paragraphe.']);
        expect(result.critique?.suggestions).toEqual(['[FR] Varier la longueur des phrases.']);
        // Metadata preserved.
        expect(result.id).toBe('ch-1');
        expect(result.number).toBe(1);
        expect(result.wordCount).toBe(5);
        expect(result.status).toBe('approved');
        done();
      });
    });

    it('makes exactly one LLM call per chapter (not 8+ for title + content + per-critique-field)', (done) => {
      // Regression: the old implementation fanned out into one
      // completion per field (title + content + feedback + per
      // mustFix item + per suggestion item + unavailableReason)
      // — 5+ parallel completions for one chapter. The new
      // batched call fires ONE completion per chapter.
      const spy = spyOn(service as any, 'translateWithRetry').and.callFake(
        () => of(JSON.stringify({ title: 'x', content: 'y', critique: null }))
      );

      const original = buildChapter();
      service.translateChapterTo$(original, 'fr', 'Chapitre').pipe(take(1)).subscribe(() => {
        expect(spy).toHaveBeenCalledTimes(1);
        done();
      });
    });

    it('falls back to the original chapter when the LLM call errors', (done) => {
      spyOn(service as any, 'translateWithRetry').and.callFake(
        () => throwError(() => new Error('API down'))
      );

      const original = buildChapter();
      service.translateChapterTo$(original, 'fr', 'Chapitre').pipe(take(1)).subscribe(result => {
        expect(result).toBe(original);
        done();
      });
    });

    it('skips critique translation when the chapter has no critique', (done) => {
      const original = buildChapter({ critique: undefined });
      spyOn(service as any, 'translateWithRetry').and.callFake(
        () => of(JSON.stringify({ title: '[FR-T] Title', content: '[FR-C] Body', critique: null }))
      );

      service.translateChapterTo$(original, 'fr', 'Chapitre').pipe(take(1)).subscribe(result => {
        expect(result.title).toBe('[FR-T] Title');
        expect(result.content).toBe('[FR-C] Body');
        expect(result.critique).toBeUndefined();
        done();
      });
    });
  });

  describe('translateBookTo$', () => {
    // The book's per-chapter fanout stays — 5 parallel calls
    // for a 5-chapter book is reasonable. The per-chapter call
    // itself is now batched (one LLM call per chapter), so the
    // total request count dropped from ~50 to 5.
    const buildChapter = (id: string, number: number, title: string, content: string): any => ({
      id,
      number,
      title,
      content,
      wordCount: 10,
      status: 'approved',
      createdAt: new Date(),
      revisions: []
    });

    it('returns the chapters unchanged when target is English', (done) => {
      const originals = [
        buildChapter('a', 1, 'Chapter 1', 'Body 1'),
        buildChapter('b', 2, 'Chapter 2', 'Body 2')
      ];
      const translateChapterSpy = spyOn(service, 'translateChapterTo$').and.callFake(
        (chapter: any, _target: string, _word: string) => of(chapter)
      );
      service.translateBookTo$(originals, 'en', 'Chapter').pipe(take(1)).subscribe(result => {
        expect(result).toBe(originals);
        expect(translateChapterSpy).not.toHaveBeenCalled();
        done();
      });
    });

    it('translates every chapter and returns the new array in order', (done) => {
      const chapterA = buildChapter('a', 1, 'Chapter 1', 'Body 1');
      const chapterB = buildChapter('b', 2, 'Chapter 2', 'Body 2');
      const translatedA = { ...chapterA, title: 'Chapitre 1', content: 'Corps 1' };
      const translatedB = { ...chapterB, title: 'Chapitre 2', content: 'Corps 2' };
      const translateChapterSpy = spyOn(service, 'translateChapterTo$').and.callFake(
        (chapter: any, _target: string, _word: string) =>
          of(chapter.id === 'a' ? translatedA : translatedB)
      );

      service.translateBookTo$([chapterA, chapterB], 'fr', 'Chapitre').pipe(take(1)).subscribe(result => {
        expect(result).toEqual([translatedA, translatedB]);
        // One call per chapter — no per-field fanout leaking
        // out of the chapter call.
        expect(translateChapterSpy).toHaveBeenCalledTimes(2);
        done();
      });
    });
  });

  describe('translateBookMetadataTo$', () => {
    // The cover, back-cover blurb, title page, and markdown top
    // heading read the user-typed book metadata. The export
    // translates the whole metadata blob in ONE LLM call, so
    // the cover / back cover don't trigger a fanout of
    // completions for each field separately.
    const buildConfig = (overrides: Partial<any> = {}): any => ({
      title: 'The Crystal Kingdom',
      plot: 'A hero rises against the dark lord.',
      genre: 'Fantasy',
      themes: ['Courage', 'Sacrifice', 'Hope'],
      protagonist: {
        name: 'Aelara',
        background: 'A wandering scholar with forbidden knowledge.',
        motivations: ['Find the lost tome'],
        flaws: ['Too curious for her own good'],
        arc: 'From isolated scholar to leader of a coalition'
      },
      antagonist: {
        name: 'Morreth',
        background: 'A fallen knight turned sorcerer.',
        motivations: ['Rewrite the ancient laws'],
        flaws: ['Cannot let go of past betrayals'],
        arc: 'From righteous knight to tyrant consumed by vengeance'
      },
      style: 'Literary',
      tone: 'Dark',
      pov: 'Third Person Limited',
      tense: 'Past',
      audience: 'Adult',
      plotArchetype: "Hero's Journey",
      actStructure: 'Three Act',
      worldType: 'Fantasy',
      targetLength: 'Novel',
      chapterLength: 'Standard',
      hasPrologue: false,
      hasEpilogue: false,
      model: 'test/model',
      ...overrides
    });

    it('returns the original config when target is English', (done) => {
      const original = buildConfig();
      service.translateBookMetadataTo$(original, 'en').pipe(take(1)).subscribe(result => {
        expect(result).toBe(original);
        done();
      });
    });

    it('makes exactly one LLM call for the whole metadata blob (not one per field)', (done) => {
      // Regression: the old implementation fired 10+ parallel
      // completions for the metadata (title, genre, plot, themes,
      // protagonist fields, antagonist fields). The new batched
      // call fires ONE completion for the whole metadata blob.
      const spy = spyOn(service as any, 'translateWithRetry').and.callFake(
        () => of(JSON.stringify({
          title: '[DE] The Crystal Kingdom',
          genre: '[DE] Fantasy',
          plot: '[DE] A hero rises against the dark lord.',
          themes: ['[DE] Courage', '[DE] Sacrifice', '[DE] Hope'],
          protagonist: {
            name: 'Aelara',
            background: '[DE] A wandering scholar with forbidden knowledge.',
            motivations: ['[DE] Find the lost tome'],
            flaws: ['[DE] Too curious for her own good'],
            arc: '[DE] From isolated scholar to leader of a coalition'
          },
          antagonist: {
            name: 'Morreth',
            background: '[DE] A fallen knight turned sorcerer.',
            motivations: ['[DE] Rewrite the ancient laws'],
            flaws: ['[DE] Cannot let go of past betrayals'],
            arc: '[DE] From righteous knight to tyrant consumed by vengeance'
          }
        }))
      );

      service.translateBookMetadataTo$(buildConfig(), 'de').pipe(take(1)).subscribe(() => {
        expect(spy).toHaveBeenCalledTimes(1);
        done();
      });
    });

    it('parses the JSON response and merges translated fields into the source config', (done) => {
      spyOn(service as any, 'translateWithRetry').and.callFake(
        () => of(JSON.stringify({
          title: '[DE] The Crystal Kingdom',
          genre: '[DE] Fantasy',
          plot: '[DE] A hero rises against the dark lord.',
          themes: ['[DE] Courage', '[DE] Sacrifice', '[DE] Hope'],
          protagonist: {
            name: 'Aelara',
            background: '[DE] A wandering scholar with forbidden knowledge.',
            motivations: ['[DE] Find the lost tome'],
            flaws: ['[DE] Too curious for her own good'],
            arc: '[DE] From isolated scholar to leader of a coalition'
          },
          antagonist: {
            name: 'Morreth',
            background: '[DE] A fallen knight turned sorcerer.',
            motivations: ['[DE] Rewrite the ancient laws'],
            flaws: ['[DE] Cannot let go of past betrayals'],
            arc: '[DE] From righteous knight to tyrant consumed by vengeance'
          }
        }))
      );

      const original = buildConfig();
      service.translateBookMetadataTo$(original, 'de').pipe(take(1)).subscribe(result => {
        // Title / genre / plot translated.
        expect(result.title).toBe('[DE] The Crystal Kingdom');
        expect(result.genre).toBe('[DE] Fantasy');
        expect(result.plot).toBe('[DE] A hero rises against the dark lord.');
        // Themes array translated, original order preserved.
        expect(result.themes).toEqual(['[DE] Courage', '[DE] Sacrifice', '[DE] Hope']);
        // Protagonist name preserved (proper noun), bio / motivations /
        // flaws / arc all translated.
        expect(result.protagonist.name).toBe('Aelara');
        expect(result.protagonist.background).toBe('[DE] A wandering scholar with forbidden knowledge.');
        expect(result.protagonist.motivations).toEqual(['[DE] Find the lost tome']);
        expect(result.protagonist.flaws).toEqual(['[DE] Too curious for her own good']);
        expect(result.protagonist.arc).toBe('[DE] From isolated scholar to leader of a coalition');
        // Same for the antagonist.
        expect(result.antagonist.name).toBe('Morreth');
        expect(result.antagonist.background).toBe('[DE] A fallen knight turned sorcerer.');
        expect(result.antagonist.motivations).toEqual(['[DE] Rewrite the ancient laws']);
        expect(result.antagonist.flaws).toEqual(['[DE] Cannot let go of past betrayals']);
        expect(result.antagonist.arc).toBe('[DE] From righteous knight to tyrant consumed by vengeance');
        // Non-visible fields (model, structural enums) pass through.
        expect(result.model).toBe('test/model');
        expect(result.style).toBe('Literary');
        done();
      });
    });

    it('falls back to the original config when the LLM call errors', (done) => {
      spyOn(service as any, 'translateWithRetry').and.callFake(
        () => throwError(() => new Error('API down'))
      );

      const original = buildConfig();
      service.translateBookMetadataTo$(original, 'de').pipe(take(1)).subscribe(result => {
        expect(result).toBe(original);
        done();
      });
    });

    it('tolerates a missing config without erroring', (done) => {
      service.translateBookMetadataTo$(null as any, 'de').pipe(take(1)).subscribe(result => {
        expect(result).toBeNull();
        done();
      });
    });

    it('tolerates a malformed config (array fields saved as non-arrays)', (done) => {
      // An older build of the config form persisted `themes` /
      // `motivations` / `flaws` as a single string in IndexedDB.
      // The merge helper lands on the original English values
      // rather than crashing on `.map` — and the cover ships
      // with the malformed fields blanked, which is the right
      // behaviour for the affected book.
      const malformed = {
        ...buildConfig(),
        themes: 'Courage, Sacrifice' as any,
        protagonist: {
          ...buildConfig().protagonist,
          motivations: 'Find the lost tome' as any,
          flaws: { trait: 'Too curious' } as any
        }
      };
      spyOn(service as any, 'translateWithRetry').and.callFake(
        () => of(JSON.stringify({
          title: '[DE] The Crystal Kingdom',
          genre: '[DE] Fantasy',
          themes: ['[DE] Courage', '[DE] Sacrifice'],
          protagonist: {
            name: 'Aelara',
            motivations: ['[DE] Find the lost tome'],
            flaws: ['[DE] Too curious']
          }
        }))
      );
      service.translateBookMetadataTo$(malformed, 'de').pipe(take(1)).subscribe(result => {
        expect(result.title).toBe('[DE] The Crystal Kingdom');
        expect(result.themes).toEqual(['[DE] Courage', '[DE] Sacrifice']);
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
      const text = 'Voilà une traduction propre sans aucun préambule.';
      expect(cleanTranslation(text)).toBe(text);
    });

    it('extracts content between [T] and [/T] markers', () => {
      const raw = 'Some preamble that we want to discard.\n[T]polish translation here[/T]\nTrailing noise.';
      expect(cleanTranslation(raw)).toBe('polish translation here');
    });

    it('extracts the inner of a single fenced code block', () => {
      const raw = '```\ntranslation inside fences\n```';
      expect(cleanTranslation(raw)).toBe('translation inside fences');
    });

    it('strips the "we need to translate" preamble (the user-reported case)', () => {
      const raw = 'We need to translate the given English text into French, preserving style, tone, formatting, paragraph breaks, and return ONLY the translation. Must be careful to keep line breaks as in original. The text is long; need to translate accurately.\n\nWe\'ll go through paragraph by paragraph.\n\nOriginal:\n\nTout est prêt.';
      const result = cleanTranslation(raw);
      expect(result).not.toMatch(/^We need to translate/i);
      expect(result).not.toMatch(/paragraph by paragraph/i);
      expect(result).toBeTruthy();
    });

    it('returns null when the response is only preamble with no translation', () => {
      const raw = 'We need to translate.\n\nWe\'ll go through paragraph by paragraph.\n\nOriginal:';
      expect(cleanTranslation(raw)).toBeNull();
    });

    it('falls back to "after Original:" when preamble strip leaves nothing else', () => {
      const raw = 'We will translate now.\n\nOriginal:\n\nTłumaczenie zaczyna się tutaj.';
      expect(cleanTranslation(raw)).toBe('Tłumaczenie zaczyna się tutaj.');
    });
  });
});
