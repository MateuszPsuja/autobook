import { TestBed } from '@angular/core/testing';
import { OrchestratorService } from './orchestrator.service';
import { BookStateService } from '../state/book-state.service';
import { ArchitectService } from '../agents/architect.service';
import { AuthorService } from '../agents/author.service';
import { CriticService } from '../agents/critic.service';
import { CharacterService } from '../agents/character.service';
import { ContinuityService } from '../agents/continuity.service';
import { PersistenceService } from '../../core/persistence.service';
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
      'setSkippedChapters', 'setCurrentChapter',
      'setPrologue', 'setEpilogue',
      'resetStats', 'startGenerationTimer', 'endGenerationTimer',
      'recordAgentUsage', 'updateTotalWords',
      'beginStream$', 'appendStream$', 'endStream$', 'clearLiveStreamBuffer'
    ]);
    bookStateServiceSpy.getState.and.returnValue({
      chapters: [],
      characterStore: { Hero: mockCharacterState },
      worldStateDoc: 'Test world',
      status: 'idle',
      activeAgent: null,
      blueprint: null,
      prologue: null,
      epilogue: null,
      currentDraft: null,
      critique: null,
      revisionCount: 0,
      config: mockConfig,
      error: null,
      continuityFlags: [],
      skippedChapters: [],
      currentChapterNumber: null,
      stats: createInitialStats(),
      liveStream: '',
      liveStreamAgent: null,
      liveStreamStartedAt: null,
      liveTokensApprox: 0
    });

    architectServiceSpy = jasmine.createSpyObj('ArchitectService', ['generateBlueprintWithUsage']);
    architectServiceSpy.generateBlueprintWithUsage.and.returnValue(of({
      data: mockBlueprint,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
    }));

    authorServiceSpy = jasmine.createSpyObj('AuthorService', [
      'writeChapterWithUsage', 'reviseChapterWithUsage',
      'writeChapterStreamingWithUsage', 'reviseChapterStreamingWithUsage'
    ]);
    // The orchestrator now uses the streaming siblings for author
    // and reviser; the non-streaming ones stay as fallbacks for
    // existing tests that explicitly verify them.
    authorServiceSpy.writeChapterStreamingWithUsage.and.returnValue(of({
      draft: mockDraft,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
    }));
    authorServiceSpy.reviseChapterStreamingWithUsage.and.returnValue(of({
      draft: mockDraft,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
    }));
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
          // Orchestrator uses the streaming siblings for author /
          // reviser so the live-preview card can show prose as it
          // arrives; the non-streaming variants stay available as
          // fallback / for unit tests that explicitly verify them.
          expect(authorServiceSpy.writeChapterStreamingWithUsage).toHaveBeenCalled();
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

    describe('prologue + epilogue pipeline', () => {
      // The shared per-section pipeline (`runSectionPipeline`) runs
      // the same author → critic → reviser → character → continuity
      // chain on the prologue, the numbered chapters, and the
      // epilogue. The orchestrator routes the resulting draft to
      // the right slot (`state.prologue` / `state.epilogue` /
      // `state.chapters`) and serialises them so the prologue lands
      // before chapter 1 and the epilogue after the last chapter.
      it('runs the full pipeline for the prologue when blueprint.prologue is present', (done) => {
        const prologueBrief = {
          number: 0,
          title: 'Prologue',
          plotBeat: 'A stranger leaves an unmarked map on a doorstep.',
          povCharacter: 'the stranger',
          emotionalState: 'purposeful',
          location: 'A rain-lashed doorstep',
          keyEvents: ['The stranger arrives', 'Slips the map under the door'],
          hookType: 'The door creaks open behind them — and no one is there',
          targetWordCount: 2000,
        };
        architectServiceSpy.generateBlueprintWithUsage.and.returnValue(of({
          data: { ...mockBlueprint, prologue: prologueBrief },
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
        }));

        service.orchestrate({ ...mockConfig, hasPrologue: true }).subscribe({
          complete: () => {
            // The prologue runs through the same author + critic
            // + character + continuity chain as a numbered chapter.
            expect(authorServiceSpy.writeChapterStreamingWithUsage).toHaveBeenCalled();
            expect(criticServiceSpy.evaluateChapterWithUsage).toHaveBeenCalled();
            // The approved draft lands on `setPrologue`, not on the
            // numbered chapters list.
            expect(bookStateServiceSpy.setPrologue).toHaveBeenCalled();
            const prologueArg = bookStateServiceSpy.setPrologue.calls.mostRecent().args[0] as Chapter;
            expect(prologueArg.title).toBe('Prologue');
            done();
          }
        });
      });

      it('runs the full pipeline for the epilogue when blueprint.epilogue is present', (done) => {
        const epilogueBrief = {
          number: 0,
          title: 'Epilogue',
          plotBeat: 'Months later, Mara visits the empty study.',
          povCharacter: 'Mara',
          emotionalState: 'reflective',
          location: 'Her father\'s study',
          keyEvents: ['Mara sits at the desk', 'Opens the journal'],
          hookType: 'The wind catches the last page',
          targetWordCount: 2000,
        };
        architectServiceSpy.generateBlueprintWithUsage.and.returnValue(of({
          data: { ...mockBlueprint, epilogue: epilogueBrief },
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
        }));

        service.orchestrate({ ...mockConfig, hasEpilogue: true }).subscribe({
          complete: () => {
            expect(bookStateServiceSpy.setEpilogue).toHaveBeenCalled();
            const epilogueArg = bookStateServiceSpy.setEpilogue.calls.mostRecent().args[0] as Chapter;
            expect(epilogueArg.title).toBe('Epilogue');
            done();
          }
        });
      });

      it('orders prologue before chapter 1 and epilogue after the last chapter', (done) => {
        // Track the global call order across all three spies so we
        // can compare cross-spy indices. Each spy push records the
        // slot name into a single ordered array; per-spy call
        // histories would only give within-spy indices.
        const order: string[] = [];
        bookStateServiceSpy.setPrologue.calls.reset();
        bookStateServiceSpy.setChapters.calls.reset();
        bookStateServiceSpy.setEpilogue.calls.reset();
        bookStateServiceSpy.setPrologue.and.callFake((arg: any) => { order.push(arg ? 'setPrologue' : 'setPrologue(null)'); });
        bookStateServiceSpy.setChapters.and.callFake((arg: any) => { order.push(arg && arg.length ? 'setChapters' : 'setChapters([])'); });
        bookStateServiceSpy.setEpilogue.and.callFake((arg: any) => { order.push(arg ? 'setEpilogue' : 'setEpilogue(null)'); });

        const prologueBrief = {
          number: 0, title: 'Prologue', plotBeat: 'A', povCharacter: 'the stranger',
          emotionalState: 'p', location: 'L', keyEvents: ['k'], hookType: 'h', targetWordCount: 1000,
        };
        const epilogueBrief = {
          number: 0, title: 'Epilogue', plotBeat: 'Z', povCharacter: 'Mara',
          emotionalState: 'r', location: 'L', keyEvents: ['k'], hookType: 'h', targetWordCount: 1000,
        };
        architectServiceSpy.generateBlueprintWithUsage.and.returnValue(of({
          data: { ...mockBlueprint, prologue: prologueBrief, epilogue: epilogueBrief },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        }));

        service.orchestrate({ ...mockConfig, hasPrologue: true, hasEpilogue: true }).subscribe({
          complete: () => {
            const prologueIdx = order.indexOf('setPrologue');
            const chapterIdx = order.indexOf('setChapters');
            const epilogueIdx = order.indexOf('setEpilogue');
            expect(prologueIdx).toBeGreaterThanOrEqual(0);
            expect(chapterIdx).toBeGreaterThan(prologueIdx);
            expect(epilogueIdx).toBeGreaterThan(chapterIdx);
            done();
          }
        });
      });

      it('skips the prologue when blueprint.prologue is absent', (done) => {
        architectServiceSpy.generateBlueprintWithUsage.and.returnValue(of({
          data: { ...mockBlueprint }, // no prologue
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        }));

        service.orchestrate(mockConfig).subscribe({
          complete: () => {
            // `setPrologue` is called once at the top of
            // `orchestrate` to reset the slot to `null`; the
            // assertion is that no approved prologue chapter was
            // pushed (i.e. it was never called with a non-null
            // argument after the reset).
            const nonNullPrologueCalls = bookStateServiceSpy.setPrologue.calls.allArgs().filter(args => args[0] != null);
            expect(nonNullPrologueCalls.length).toBe(0);
            done();
          }
        });
      });

      it('skips the epilogue when blueprint.epilogue is absent', (done) => {
        architectServiceSpy.generateBlueprintWithUsage.and.returnValue(of({
          data: { ...mockBlueprint }, // no epilogue
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        }));

        service.orchestrate(mockConfig).subscribe({
          complete: () => {
            const nonNullEpilogueCalls = bookStateServiceSpy.setEpilogue.calls.allArgs().filter(args => args[0] != null);
            expect(nonNullEpilogueCalls.length).toBe(0);
            done();
          }
        });
      });

      it('continues with numbered chapters when the prologue pipeline fails', (done) => {
        // The retry path takes 2s × maxRetries before failing. The
        // 3-retry default would push past Jasmine's default 5s
        // timeout, so bump the budget for this test.
        authorServiceSpy.writeChapterStreamingWithUsage.and.returnValue(throwError(() => new Error('prologue author failed')));
        const prologueBrief = {
          number: 0, title: 'Prologue', plotBeat: 'A', povCharacter: 'the stranger',
          emotionalState: 'p', location: 'L', keyEvents: ['k'], hookType: 'h', targetWordCount: 1000,
        };
        architectServiceSpy.generateBlueprintWithUsage.and.returnValue(of({
          data: { ...mockBlueprint, prologue: prologueBrief },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        }));

        service.orchestrate({ ...mockConfig, hasPrologue: true }).subscribe({
          complete: () => {
            // Per-section skip rule: prologue failure logs an error
            // and surfaces in state.error but the numbered chapters
            // still go through the pipeline and ship.
            const nonNullPrologueCalls = bookStateServiceSpy.setPrologue.calls.allArgs().filter(args => args[0] != null);
            expect(nonNullPrologueCalls.length).toBe(0);
            expect(bookStateServiceSpy.setError).toHaveBeenCalled();
            expect(bookStateServiceSpy.setChapters).toHaveBeenCalled();
            done();
          },
          error: () => {
            done.fail('orchestrate should not error on prologue failure');
          }
        });
      }, 15000);
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

    describe('post-generation translation', () => {
      // Translation is now an export-time concern. The orchestrator
      // produces English chapters and stores them as-is; the export
      // component runs the LLM translation when the user picks a
      // non-English target language. This block just asserts the
      // orchestrator doesn't touch translation on its own.
      it('does not depend on the translation service', (done) => {
        // The orchestrator no longer has a TranslationService
        // dependency at all — it produces English chapters and
        // stops. This test mainly documents the contract so a
        // future refactor that re-adds translation here will fail
        // this test as a reminder to reconsider the export-time
        // translation path.
        bookStateServiceSpy.getState.and.returnValue({
          chapters: [],
          characterStore: {},
          worldStateDoc: '',
          status: 'generating',
          activeAgent: 'author',
          blueprint: null,
          prologue: null,
          epilogue: null,
          currentDraft: null,
          critique: null,
          revisionCount: 0,
          config: mockConfig,
          error: null,
          continuityFlags: [],
          skippedChapters: [],
          currentChapterNumber: null,
          stats: createInitialStats(),
          liveStream: '',
          liveStreamAgent: null,
          liveStreamStartedAt: null,
          liveTokensApprox: 0
        });

        service.orchestrate(mockConfig).subscribe({
          complete: () => {
            const statuses = bookStateServiceSpy.setStatus.calls.allArgs().map(c => c[0]);
            // The post-translation 'translating' status is no longer
            // emitted — only 'completed' at the end.
            expect(statuses).not.toContain('translating');
            expect(statuses[statuses.length - 1]).toBe('completed');
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
