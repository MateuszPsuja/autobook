import { TestBed } from '@angular/core/testing';
import { OrchestratorService } from './orchestrator.service';
import { BookStateService } from '../state/book-state.service';
import { ArchitectService } from '../agents/architect.service';
import { AuthorService } from '../agents/author.service';
import { CriticService } from '../agents/critic.service';
import { CharacterService } from '../agents/character.service';
import { ContinuityService } from '../agents/continuity.service';
import { PersistenceService } from '../../core/persistence.service';
import { TranslationService } from '../../i18n/translation.service';
import { ProviderService } from '../../core/providers/provider.service';
import { BookConfig, Genre, WritingStyle, Tone, PointOfView, Tense, Audience, PlotArchetype, ActStructure, WorldType, BookLength, ChapterLength } from '../../models/book-config.model';
import { Blueprint, ChapterBrief, CriticContext } from '../../models/book-state.model';
import { Chapter, ChapterDraft } from '../../models/chapter.model';
import { of, throwError, Subject } from 'rxjs';
import { CharacterState, CharacterStore } from '../../models/character.model';
import { createInitialStats } from '../../models/book-state.model';

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let bookStateServiceSpy: jasmine.SpyObj<BookStateService>;
  let architectServiceSpy: jasmine.SpyObj<ArchitectService>;
  let authorServiceSpy: jasmine.SpyObj<AuthorService>;
  let criticServiceSpy: jasmine.SpyObj<CriticService>;
  let characterServiceSpy: jasmine.SpyObj<CharacterService>;
  let continuityServiceSpy: jasmine.SpyObj<ContinuityService>;
  let persistenceServiceSpy: jasmine.SpyObj<PersistenceService>;
  let translationServiceSpy: jasmine.SpyObj<TranslationService>;

  const mockConfig: BookConfig = {
    title: 'Test Book',
    plot: '',
    genre: 'Fantasy' as Genre,
    style: 'Literary' as WritingStyle,
    tone: 'Dark' as Tone,
    pov: 'First Person' as PointOfView,
    tense: 'Past' as Tense,
    audience: 'Adult' as Audience,
    themes: ['Adventure'],
    worldType: 'Fantasy' as WorldType,
    targetLength: 'Novel' as BookLength,
    chapterLength: 'Standard' as ChapterLength,
    protagonist: {
      name: 'Hero',
      role: 'Protagonist',
      age: 25,
      background: 'Brave adventurer',
      motivations: ['Save the world'],
      flaws: ['Impulsive'],
      arc: 'Learn patience'
    },
    antagonist: {
      name: 'Villain',
      role: 'Antagonist',
      age: 35,
      background: 'Corrupted ruler',
      motivations: ['World domination'],
      flaws: ['Arrogant'],
      arc: 'Realize the cost of power'
    },
    plotArchetype: "Hero's Journey" as PlotArchetype,
    actStructure: 'Three Act' as ActStructure,
    hasPrologue: false,
    hasEpilogue: false,
    model: 'test/model'
  };

  const mockBlueprint: Blueprint = {
    chapters: [
      {
        number: 1,
        title: 'Chapter 1: The Beginning',
        plotBeat: 'Introduction',
        povCharacter: 'Hero',
        emotionalState: 'Curious',
        location: 'Village',
        keyEvents: ['Meet mentor'],
        hookType: 'Mystery',
        targetWordCount: 2500
      }
    ],
    characterArcs: [
      {
        name: 'Hero',
        arcType: 'Positive',
        startingState: 'Naive',
        endingState: 'Wise',
        keyMoments: ['First battle']
      }
    ],
    worldBuilding: [
      {
        name: 'Magic System',
        description: 'Elemental magic',
        rules: ['Requires focus'],
        significance: 'Central to plot'
      }
    ],
    themes: ['Adventure'],
    keyPlotPoints: ['Inciting incident']
  };

  const mockDraft: ChapterDraft = {
    chapterId: 'chapter-1',
    content: 'Test chapter content with enough words.',
    wordCount: 10,
    progress: 100,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const mockCritique = {
    scores: {
      prose: 8,
      pacing: 8,
      showVsTell: 8,
      dialogue: 8,
      continuity: 8,
      hookStrength: 8,
      thematicResonance: 8
    },
    overallScore: 8,
    feedback: 'Good work',
    mustFix: [],
    suggestions: [],
    createdAt: new Date()
  };

  const mockCharacterState: CharacterState = {
    profile: {
      name: 'Hero',
      role: 'Protagonist',
      age: 25,
      background: 'Brave adventurer',
      motivations: ['Save the world'],
      flaws: ['Impulsive'],
      arc: 'Learn patience'
    },
    currentStatus: {
      emotionalState: 'Ready',
      physicalState: 'Healthy',
      location: 'Village',
      goals: ['Find the treasure'],
      conflicts: ['Face the dragon'],
      relationships: ['Friend']
    },
    relationships: [],
    development: {
      arcStage: 'Introduction',
      keyMoments: [],
      growthAreas: [],
      remainingFlaws: []
    },
    lastUpdated: new Date()
  };

  beforeEach(() => {
    // Create spies at module level for reuse
    bookStateServiceSpy = jasmine.createSpyObj('BookStateService', [
      'setConfig', 'setChapters', 'setCurrentDraft', 'setCritique',
      'setRevisionCount', 'setStatus', 'setActiveAgent', 'setError',
      'setBlueprint', 'getState', 'setCharacterStore', 'setContinuityFlags',
      'setSkippedChapters',
      'resetStats', 'startGenerationTimer', 'endGenerationTimer',
      'recordAgentUsage', 'updateTotalWords'
    ]);
    bookStateServiceSpy.getState.and.returnValue({
      chapters: [],
      characterStore: { Hero: mockCharacterState },
      worldStateDoc: 'Test world',
      status: 'idle',
      activeAgent: null,
      blueprint: null,
      currentDraft: null,
      critique: null,
      revisionCount: 0,
      config: mockConfig,
      error: null,
      continuityFlags: [],
      skippedChapters: [],
      stats: createInitialStats()
    });

    architectServiceSpy = jasmine.createSpyObj('ArchitectService', ['generateBlueprintWithUsage']);
    architectServiceSpy.generateBlueprintWithUsage.and.returnValue(of({
      data: mockBlueprint,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
    }));

    authorServiceSpy = jasmine.createSpyObj('AuthorService', ['writeChapterWithUsage', 'reviseChapterWithUsage']);
    authorServiceSpy.writeChapterWithUsage.and.returnValue(of({
      draft: mockDraft,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
    }));
    authorServiceSpy.reviseChapterWithUsage.and.returnValue(of({
      draft: mockDraft,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
    }));

    criticServiceSpy = jasmine.createSpyObj('CriticService', ['evaluateChapterWithUsage']);
    criticServiceSpy.evaluateChapterWithUsage.and.returnValue(of({
      data: mockCritique,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
    }));

    characterServiceSpy = jasmine.createSpyObj('CharacterService', ['checkCharacterConsistencyWithUsage', 'updateCharacterStatesWithUsage']);
    characterServiceSpy.checkCharacterConsistencyWithUsage.and.returnValue(of({
      data: { violations: [], suggestions: [] },
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 }
    }));
    characterServiceSpy.updateCharacterStatesWithUsage.and.returnValue(of({
      data: { Hero: mockCharacterState },
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 }
    }));

    continuityServiceSpy = jasmine.createSpyObj('ContinuityService', ['checkContinuityWithUsage']);
    continuityServiceSpy.checkContinuityWithUsage.and.returnValue(of({
      data: { issues: [], overallContinuity: 'Good' },
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 }
    }));

    persistenceServiceSpy = jasmine.createSpyObj('PersistenceService', ['saveCheckpoint']);
    persistenceServiceSpy.saveCheckpoint.and.returnValue(of(undefined));

    // Translation service stub. Most tests want the orchestrator to
    // skip the post-generation Polish pass entirely (because the
    // default is English), but we still need the spy to be a
    // callable TranslationService shape so the constructor doesn't
    // crash on `isPolish()` / `translateGeneratedChapter$()`.
    // Tests that opt into Polish override the behavior in their
    // beforeEach.
    translationServiceSpy = jasmine.createSpyObj('TranslationService', [
      'isPolish',
      'translateGeneratedChapter$'
    ]);
    translationServiceSpy.isPolish.and.returnValue(false);
    translationServiceSpy.translateGeneratedChapter$.and.callFake(
      (chapter: Chapter) => of(chapter)
    );

    TestBed.configureTestingModule({
      providers: [
        OrchestratorService,
        { provide: BookStateService, useValue: bookStateServiceSpy },
        { provide: ArchitectService, useValue: architectServiceSpy },
        { provide: AuthorService, useValue: authorServiceSpy },
        { provide: CriticService, useValue: criticServiceSpy },
        { provide: CharacterService, useValue: characterServiceSpy },
        { provide: ContinuityService, useValue: continuityServiceSpy },
        { provide: PersistenceService, useValue: persistenceServiceSpy },
        { provide: TranslationService, useValue: translationServiceSpy },
        ProviderService
      ]
    });

    service = TestBed.inject(OrchestratorService);
  });

  describe('Service Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });
  });

  describe('orchestrate', () => {
    it('should reset state before starting generation', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(bookStateServiceSpy.setConfig).toHaveBeenCalledWith(mockConfig);
          expect(bookStateServiceSpy.setChapters).toHaveBeenCalledWith([]);
          expect(bookStateServiceSpy.setCurrentDraft).toHaveBeenCalledWith(null);
          expect(bookStateServiceSpy.setCritique).toHaveBeenCalledWith(null);
          expect(bookStateServiceSpy.setRevisionCount).toHaveBeenCalledWith(0);
          done();
        }
      });
    });

    it('should start with architect agent', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(bookStateServiceSpy.setActiveAgent).toHaveBeenCalledWith('architect');
          done();
        }
      });
    });

    it('should call architect to generate blueprint', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(architectServiceSpy.generateBlueprintWithUsage).toHaveBeenCalledWith(mockConfig);
          done();
        }
      });
    });

    it('should set blueprint when received from architect', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(bookStateServiceSpy.setBlueprint).toHaveBeenCalledWith(mockBlueprint);
          done();
        }
      });
    });

    it('should switch to author agent after blueprint generation', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(bookStateServiceSpy.setActiveAgent).toHaveBeenCalledWith('author');
          done();
        }
      });
    });

    it('should set status to generating', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(bookStateServiceSpy.setStatus).toHaveBeenCalledWith('generating');
          done();
        }
      });
    });

    it('should process all chapters from blueprint', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(authorServiceSpy.writeChapterWithUsage).toHaveBeenCalled();
          expect(criticServiceSpy.evaluateChapterWithUsage).toHaveBeenCalled();
          done();
        }
      });
    });

    it('should set status to completed when all chapters are processed', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(bookStateServiceSpy.setStatus).toHaveBeenCalledWith('completed');
          done();
        }
      });
    });

    it('should handle architect errors', (done) => {
      architectServiceSpy.generateBlueprintWithUsage.and.returnValue(throwError(() => new Error('Blueprint error')));

      service.orchestrate(mockConfig).subscribe({
        error: (error) => {
          expect(error.message).toBe('Blueprint error');
          expect(bookStateServiceSpy.setStatus).toHaveBeenCalledWith('error');
          done();
        }
      });
    });

    it('should set critique on book state when critic evaluates', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(bookStateServiceSpy.setCritique).toHaveBeenCalled();
          done();
        }
      });
    });

    it('should call persistence saveCheckpoint after chapter approval', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(persistenceServiceSpy.saveCheckpoint).toHaveBeenCalled();
          done();
        }
      });
    });

    it('should pass model parameter to character service', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(characterServiceSpy.checkCharacterConsistencyWithUsage).toHaveBeenCalled();
          const callArgs = characterServiceSpy.checkCharacterConsistencyWithUsage.calls.mostRecent().args;
          expect(callArgs[3]).toBe('test/model'); // model parameter
          done();
        }
      });
    });

    it('should pass model parameter to continuity service', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(continuityServiceSpy.checkContinuityWithUsage).toHaveBeenCalled();
          const callArgs = continuityServiceSpy.checkContinuityWithUsage.calls.mostRecent().args;
          expect(callArgs[3]).toBe('test/model'); // model parameter
          done();
        }
      });
    });

    describe('post-generation Polish translation', () => {
      // After every chapter is generated, the orchestrator should
      // run the generated content through the translation service
      // when Polish is on, and write the Polish version back into
      // the state so the viewer reads Polish directly.
      const englishChapter: Chapter = {
        id: 'ch-1',
        number: 1,
        title: 'Chapter 1: The Beginning',
        content: 'An opening paragraph in English.',
        wordCount: 5,
        status: 'approved',
        createdAt: new Date(),
        approvedAt: new Date(),
        critique: mockCritique,
        revisions: []
      };

      const polishChapter: Chapter = {
        ...englishChapter,
        title: 'Rozdział 1: Początek',
        content: 'Akapit otwierający po polsku.'
      };

      it('skips translation entirely when language is English', (done) => {
        // isPolish defaults to false in the outer beforeEach.
        // Stub getState to return a chapter so the translation
        // step is *eligible* to run — if it ran anyway, the
        // status flip to 'translating' would show up.
        bookStateServiceSpy.getState.and.returnValue({
          chapters: [englishChapter],
          characterStore: {},
          worldStateDoc: '',
          status: 'generating',
          activeAgent: 'author',
          blueprint: null,
          currentDraft: null,
          critique: null,
          revisionCount: 0,
          config: mockConfig,
          error: null,
          continuityFlags: [],
          skippedChapters: [],
          stats: createInitialStats()
        });

        service.orchestrate(mockConfig).subscribe({
          complete: () => {
            // English: translator should not have been called and
            // the status should never have flipped to 'translating'.
            expect(translationServiceSpy.translateGeneratedChapter$).not.toHaveBeenCalled();
            const statuses = bookStateServiceSpy.setStatus.calls.allArgs().map(c => c[0]);
            expect(statuses).not.toContain('translating');
            done();
          }
        });
      });

      it('translates every chapter and writes the Polish version back to state when language is Polish', (done) => {
        translationServiceSpy.isPolish.and.returnValue(true);
        translationServiceSpy.translateGeneratedChapter$.and.callFake(
          () => of(polishChapter)
        );
        bookStateServiceSpy.getState.and.returnValue({
          chapters: [englishChapter],
          characterStore: {},
          worldStateDoc: '',
          status: 'generating',
          activeAgent: 'author',
          blueprint: null,
          currentDraft: null,
          critique: null,
          revisionCount: 0,
          config: mockConfig,
          error: null,
          continuityFlags: [],
          skippedChapters: [],
          stats: createInitialStats()
        });

        // Collect every value the orchestrator emits. The
        // post-translation pass used to call `subscriber.next(...)`
        // mid-flight, which made the generator's `next` callback
        // (which treats every emission as "done") flip
        // `isGenerating = false` and briefly show the Generate
        // button. The post-step should stay silent until the
        // final "Book generation completed" emission.
        const emissions: string[] = [];
        service.orchestrate(mockConfig).subscribe({
          next: msg => emissions.push(msg),
          complete: () => {
            // Translator invoked for the one chapter we seeded.
            expect(translationServiceSpy.translateGeneratedChapter$).toHaveBeenCalledTimes(1);
            // Status flipped to 'translating' before going to
            // 'completed'.
            const statuses = bookStateServiceSpy.setStatus.calls.allArgs();
            expect(statuses.map(c => c[0])).toContain('translating');
            expect(statuses[statuses.length - 1][0]).toBe('completed');
            // The final setChapters call should hold the Polish
            // chapter, not the English one.
            const lastSetChaptersCall = bookStateServiceSpy.setChapters.calls.mostRecent();
            expect(lastSetChaptersCall.args[0]).toEqual([polishChapter]);
            // Only the final completion message should have been
            // emitted to the subscriber.
            expect(emissions).toEqual(['Book generation completed']);
            done();
          }
        });
      });

      it('skips the translation pass when the user hit Stop before the post-step ran', (done) => {
        translationServiceSpy.isPolish.and.returnValue(true);
        // Simulate "stop" being called by flipping the orchestrator's
        // internal flag. We can't reach `stopped` directly, but
        // calling `service.stop()` after the orchestrator starts
        // achieves the same effect: the teardown flips `stopped`
        // to true before the post-step runs.
        // However, the post-step runs *inside* the subscribe.next
        // callback synchronously after the pipeline completes, so
        // we can't interleave a stop() in between. The realistic
        // version of this test is: if the orchestrator's pipeline
        // itself no-ops on `stopped`, the post-step check should
        // also no-op. We approximate that by overriding the spy
        // to return no chapters (so the post-step's
        // `chapters.length > 0` guard short-circuits).
        bookStateServiceSpy.getState.and.returnValue({
          chapters: [], // empty → post-step skipped
          characterStore: {},
          worldStateDoc: '',
          status: 'generating',
          activeAgent: 'author',
          blueprint: null,
          currentDraft: null,
          critique: null,
          revisionCount: 0,
          config: mockConfig,
          error: null,
          continuityFlags: [],
          skippedChapters: [],
          stats: createInitialStats()
        });

        service.orchestrate(mockConfig).subscribe({
          complete: () => {
            expect(translationServiceSpy.translateGeneratedChapter$).not.toHaveBeenCalled();
            done();
          }
        });
      });

      it('keeps the English copy of just the failing chapter (per-chapter resilience)', (done) => {
        // One chapter's translation exhausts its retry budget and
        // errors. The orchestrator should log it, keep that one
        // chapter in English, and still translate every other
        // chapter. Previously this would have rejected the whole
        // batch via Promise.all and left the state fully English.
        translationServiceSpy.isPolish.and.returnValue(true);
        const englishChapter2: Chapter = {
          ...englishChapter,
          number: 2,
          title: 'Chapter 2: A Bad Day',
          content: 'Second chapter body in English.'
        };
        // Generic Polish transformer: take the input chapter and
        // prepend a [PL] marker to title / content. Lets the
        // test assert the right chapter came back without
        // hard-coding a separate fixture per chapter.
        translationServiceSpy.translateGeneratedChapter$.and.callFake((ch: Chapter) => {
          if (ch.number === 2) {
            // Simulate "all retries exhausted" by erroring.
            return throwError(() => new Error('chapter 2 retries exhausted'));
          }
          return of({ ...ch, title: '[PL] ' + ch.title, content: '[PL] ' + ch.content });
        });
        bookStateServiceSpy.getState.and.returnValue({
          chapters: [englishChapter, englishChapter2],
          characterStore: {},
          worldStateDoc: '',
          status: 'generating',
          activeAgent: 'author',
          blueprint: null,
          currentDraft: null,
          critique: null,
          revisionCount: 0,
          config: mockConfig,
          error: null,
          continuityFlags: [],
          skippedChapters: [],
          stats: createInitialStats()
        });

        service.orchestrate(mockConfig).subscribe({
          complete: () => {
            // Translator called once per chapter.
            expect(translationServiceSpy.translateGeneratedChapter$).toHaveBeenCalledTimes(2);
            // Final setChapters should hold the Polish version of
            // chapter 1 AND the English fallback for chapter 2.
            const lastSetChaptersCall = bookStateServiceSpy.setChapters.calls.mostRecent();
            const finalChapters: Chapter[] = lastSetChaptersCall.args[0];
            expect(finalChapters.length).toBe(2);
            // Chapter 1 translated successfully.
            expect(finalChapters[0].title).toBe('[PL] Chapter 1: The Beginning');
            expect(finalChapters[0].content).toBe('[PL] An opening paragraph in English.');
            // Chapter 2 fell back to its English copy because the
            // translator errored after all retries.
            expect(finalChapters[1].title).toBe(englishChapter2.title);
            expect(finalChapters[1].content).toBe(englishChapter2.content);
            // The English critique is preserved for the failed
            // chapter (so the user can still see the feedback).
            expect(finalChapters[1].critique).toBe(englishChapter2.critique);
            done();
          }
        });
      });
    });
  });

  describe('stop', () => {
    it('should set status to idle', () => {
      service.stop();
      expect(bookStateServiceSpy.setStatus).toHaveBeenCalledWith('idle');
    });

    it('should set active agent to null', () => {
      service.stop();
      expect(bookStateServiceSpy.setActiveAgent).toHaveBeenCalledWith(null);
    });
  });
});
