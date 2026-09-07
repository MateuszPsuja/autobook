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
      'beginStream$', 'appendStream$', 'endStream$', 'clearLiveStreamBuffer',
      'incrementErrorCount', 'incrementRetryCount',
      'getErrorCount$', 'getRetryCount$'
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
      liveStreamStartedAt: null
    });

    architectServiceSpy = jasmine.createSpyObj('ArchitectService', ['generateBlueprintWithUsage', 'generateBlueprintStreamingWithUsage']);
    architectServiceSpy.generateBlueprintWithUsage.and.returnValue(of({
      data: mockBlueprint,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
    }));
    architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(of({
      data: mockBlueprint,
      usage: { promptTokens: 0, completionTokens: 50, totalTokens: 50 }
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

    criticServiceSpy = jasmine.createSpyObj('CriticService', ['evaluateChapterWithUsage', 'evaluateChapterStreamingWithUsage']);
    criticServiceSpy.evaluateChapterWithUsage.and.returnValue(of({
      data: mockCritique,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
    }));
    criticServiceSpy.evaluateChapterStreamingWithUsage.and.returnValue(of({
      data: mockCritique,
      usage: { promptTokens: 0, completionTokens: 50, totalTokens: 50 }
    }));

    characterServiceSpy = jasmine.createSpyObj('CharacterService', [
      'checkCharacterConsistencyWithUsage', 'checkCharacterConsistencyStreamingWithUsage',
      'updateCharacterStatesWithUsage'
    ]);
    characterServiceSpy.checkCharacterConsistencyWithUsage.and.returnValue(of({
      data: { violations: [], suggestions: [] },
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 }
    }));
    characterServiceSpy.checkCharacterConsistencyStreamingWithUsage.and.returnValue(of({
      data: { violations: [], suggestions: [] },
      usage: { promptTokens: 0, completionTokens: 50, totalTokens: 50 }
    }));
    characterServiceSpy.updateCharacterStatesWithUsage.and.returnValue(of({
      data: { Hero: mockCharacterState },
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 }
    }));

    continuityServiceSpy = jasmine.createSpyObj('ContinuityService', ['checkContinuityWithUsage', 'checkContinuityStreamingWithUsage']);
    continuityServiceSpy.checkContinuityWithUsage.and.returnValue(of({
      data: { issues: [], overallContinuity: 'Good' },
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 }
    }));
    continuityServiceSpy.checkContinuityStreamingWithUsage.and.returnValue(of({
      data: { issues: [], overallContinuity: 'Good' },
      usage: { promptTokens: 0, completionTokens: 50, totalTokens: 50 }
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
          // The orchestrator routes the architect call through the
          // streaming sibling so the Live Output card shows the
          // blueprint JSON as it arrives.
          expect(architectServiceSpy.generateBlueprintStreamingWithUsage).toHaveBeenCalledWith(mockConfig);
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
          // Orchestrator uses the streaming siblings for every agent
          // (architect / author / critic / reviser / character /
          // continuity) so the Live Output card shows prose and JSON
          // as it arrives. The non-streaming variants stay available
          // as fallback / for unit tests that explicitly verify them.
          expect(authorServiceSpy.writeChapterStreamingWithUsage).toHaveBeenCalled();
          expect(criticServiceSpy.evaluateChapterStreamingWithUsage).toHaveBeenCalled();
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
        architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(of({
          data: { ...mockBlueprint, prologue: prologueBrief },
          usage: { promptTokens: 0, completionTokens: 50, totalTokens: 50 }
        }));

        service.orchestrate({ ...mockConfig, hasPrologue: true }).subscribe({
          complete: () => {
            // The prologue runs through the same author + critic
            // + character + continuity chain as a numbered chapter.
            expect(authorServiceSpy.writeChapterStreamingWithUsage).toHaveBeenCalled();
            expect(criticServiceSpy.evaluateChapterStreamingWithUsage).toHaveBeenCalled();
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
        architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(of({
          data: { ...mockBlueprint, epilogue: epilogueBrief },
          usage: { promptTokens: 0, completionTokens: 50, totalTokens: 50 }
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
        architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(of({
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
        architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(of({
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
        architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(of({
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
        architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(of({
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

      it('retries and falls through with a truncation marker when the author keeps returning tail-truncated drafts', (done) => {
        // Reproduces the user's reported bug: the author returns a
        // tail-truncated draft on every attempt ("He kept glancing").
        // After 3 retries the orchestrator should fall through with
        // the most recent draft, append the truncation marker, set
        // state.error to quote the tail, and let the numbered
        // chapters ship.
        //
        // We only stub the prologue call (number=0) to return
        // truncated prose. Numbered chapters go through the default
        // mock which returns a complete draft so we can assert the
        // retry count for the prologue alone without the chapter
        // call getting conflated.
        const truncatedContent = 'The air pressed close, as if held by invisible hands.\n\nHe kept glancing';
        const completeContent = 'The dawn found her walking toward the harbor.\n\nShe carried the lantern high.';
        authorServiceSpy.writeChapterStreamingWithUsage.and.callFake((brief: ChapterBrief) => {
          if (brief.number === 0) {
            return of({
              draft: { ...mockDraft, content: truncatedContent, wordCount: 12 },
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
            });
          }
          return of({
            draft: { ...mockDraft, content: completeContent, wordCount: 12 },
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
          });
        });
        const prologueBrief = {
          number: 0, title: 'Prologue', plotBeat: 'A stranger leaves a map.', povCharacter: 'the stranger',
          emotionalState: 'purposeful', location: 'A doorstep', keyEvents: ['k'], hookType: 'h', targetWordCount: 1000,
        };
        architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(of({
          data: { ...mockBlueprint, prologue: prologueBrief },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        }));

        service.orchestrate({ ...mockConfig, hasPrologue: true }).subscribe({
          complete: () => {
            // The author was called 3 times for the prologue
            // (maxRetries=3) — every attempt returned the same
            // truncated draft, so the orchestrator retried each time.
            // Plus one call for chapter 1 (complete on first try).
            const allCalls = (authorServiceSpy.writeChapterStreamingWithUsage as jasmine.Spy).calls.allArgs();
            const prologueCalls = allCalls.filter((args: any[]) => args[0]?.number === 0);
            expect(prologueCalls.length).toBe(3);

            // The prologue still got approved — the fallback ships
            // the most recent truncated draft with a marker appended
            // so reviewers can see what got generated.
            const prologueStateCalls = bookStateServiceSpy.setPrologue.calls.allArgs()
              .filter(args => args[0] != null);
            expect(prologueStateCalls.length).toBe(1);
            const prologue = prologueStateCalls[0][0] as Chapter;
            expect(prologue.content).toContain('He kept glancing');
            expect(prologue.content).toContain('[… incomplete — generation cut off …]');

            // state.error was set with a message that quotes the
            // truncated tail so the reviewer can see what got cut.
            const errorCalls = bookStateServiceSpy.setError.calls.allArgs()
              .map(c => c[0])
              .filter((msg: unknown): msg is string => typeof msg === 'string');
            const truncationError = errorCalls.find(msg =>
              msg.includes('truncated') && msg.includes('He kept glancing')
            );
            expect(truncationError).toBeTruthy();

            // Numbered chapters still went through the pipeline.
            expect(bookStateServiceSpy.setChapters).toHaveBeenCalled();
            done();
          },
          error: (err) => {
            done.fail('orchestrate should not error on truncated prologue: ' + (err?.message || err));
          }
        });
      }, 15000);

      it('retries and falls through with a truncation marker for a dangling-tail prologue (long previous paragraph + trailing function word)', (done) => {
        // Reproduces the user-reported bug as an integration test: the
        // previous paragraph is long (so the old two-line guard alone
        // would have accepted the draft as a deliberate stylistic
        // fragment), but the tail ends mid-enumeration on a dangling
        // auxiliary word. After the dangling-word check fires, the
        // orchestrator should retry, and after 3 retries it should
        // fall through with the marker and state.error quoting the tail.
        const longPrev =
          'I stood. I brushed the moss from my knees, then turned toward the sound of the river, and began to walk.';
        const truncatedContent =
          longPrev + '\n\nSomething was coming. Something I had forgotten, or had never known, or had';
        const completeContent = 'The dawn found her walking toward the harbor.\n\nShe carried the lantern high.';
        authorServiceSpy.writeChapterStreamingWithUsage.and.callFake((brief: ChapterBrief) => {
          if (brief.number === 0) {
            return of({
              draft: { ...mockDraft, content: truncatedContent, wordCount: 30 },
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
            });
          }
          return of({
            draft: { ...mockDraft, content: completeContent, wordCount: 12 },
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
          });
        });
        const prologueBrief = {
          number: 0, title: 'Prologue', plotBeat: 'A stranger leaves a map.', povCharacter: 'the stranger',
          emotionalState: 'purposeful', location: 'A doorstep', keyEvents: ['k'], hookType: 'h', targetWordCount: 1000,
        };
        architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(of({
          data: { ...mockBlueprint, prologue: prologueBrief },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        }));

        service.orchestrate({ ...mockConfig, hasPrologue: true }).subscribe({
          complete: () => {
            // The author was called 3 times for the prologue
            // (maxRetries=3) — every attempt returned the same
            // dangling-tail truncated draft, so the orchestrator
            // retried each time. Plus one call for chapter 1.
            const allCalls = (authorServiceSpy.writeChapterStreamingWithUsage as jasmine.Spy).calls.allArgs();
            const prologueCalls = allCalls.filter((args: any[]) => args[0]?.number === 0);
            expect(prologueCalls.length).toBe(3);

            // The prologue still got approved — the fallback ships
            // the most recent dangling-tail truncated draft with a
            // marker appended so reviewers can see what got generated.
            const prologueStateCalls = bookStateServiceSpy.setPrologue.calls.allArgs()
              .filter(args => args[0] != null);
            expect(prologueStateCalls.length).toBe(1);
            const prologue = prologueStateCalls[0][0] as Chapter;
            expect(prologue.content).toContain('or had never known, or had');
            expect(prologue.content).toContain('[… incomplete — generation cut off …]');

            // state.error was set with a message that quotes the
            // truncated tail so the reviewer can see what got cut.
            const errorCalls = bookStateServiceSpy.setError.calls.allArgs()
              .map(c => c[0])
              .filter((msg: unknown): msg is string => typeof msg === 'string');
            const truncationError = errorCalls.find(msg =>
              msg.includes('truncated') && msg.includes('or had')
            );
            expect(truncationError).toBeTruthy();

            // Numbered chapters still went through the pipeline.
            expect(bookStateServiceSpy.setChapters).toHaveBeenCalled();
            done();
          },
          error: (err) => {
            done.fail('orchestrate should not error on dangling-tail prologue: ' + (err?.message || err));
          }
        });
      }, 15000);

      it('does not retry when the author returns a complete draft on the first attempt', (done) => {
        const completeContent = 'The dawn found her walking toward the harbor.\n\nShe carried the lantern high.';
        authorServiceSpy.writeChapterStreamingWithUsage.and.returnValue(of({
          draft: { ...mockDraft, content: completeContent, wordCount: 12 },
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        }));
        const prologueBrief = {
          number: 0, title: 'Prologue', plotBeat: 'A', povCharacter: 'the stranger',
          emotionalState: 'p', location: 'L', keyEvents: ['k'], hookType: 'h', targetWordCount: 1000,
        };
        architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(of({
          data: { ...mockBlueprint, prologue: prologueBrief },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        }));

        service.orchestrate({ ...mockConfig, hasPrologue: true }).subscribe({
          complete: () => {
            // Exactly one author call for the prologue (the draft
            // was complete, no retry needed) plus one for chapter 1.
            const allCalls = (authorServiceSpy.writeChapterStreamingWithUsage as jasmine.Spy).calls.allArgs();
            const prologueCalls = allCalls.filter((args: any[]) => args[0]?.number === 0);
            expect(prologueCalls.length).toBe(1);
            const prologueStateCalls = bookStateServiceSpy.setPrologue.calls.allArgs()
              .filter(args => args[0] != null);
            expect(prologueStateCalls.length).toBe(1);
            const prologue = prologueStateCalls[0][0] as Chapter;
            expect(prologue.content).not.toContain('[… incomplete — generation cut off …]');
            done();
          },
          error: (err) => {
            done.fail('orchestrate should not error: ' + (err?.message || err));
          }
        });
      });
    });

    it('should handle architect errors', (done) => {
      architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(throwError(() => new Error('Blueprint error')));

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
          expect(characterServiceSpy.checkCharacterConsistencyStreamingWithUsage).toHaveBeenCalled();
          const callArgs = characterServiceSpy.checkCharacterConsistencyStreamingWithUsage.calls.mostRecent().args;
          expect(callArgs[3]).toBe('test/model'); // model parameter
          done();
        }
      });
    });

    it('should pass model parameter to continuity service', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(continuityServiceSpy.checkContinuityStreamingWithUsage).toHaveBeenCalled();
          const callArgs = continuityServiceSpy.checkContinuityStreamingWithUsage.calls.mostRecent().args;
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
          liveStreamStartedAt: null
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

  describe('retryChapters', () => {
    // Builds a chapter-brief list with N chapters so retryChapters
    // can resolve `blueprint.chapters.find(b => b.number === n)`
    // for any number in 1..N. The brief fields are minimal — the
    // retry path doesn't care about content, only the chapter's
    // number and the brief existence.
    const buildBriefs = (n: number) => Array.from({ length: n }, (_, i) => ({
      number: i + 1,
      title: `Chapter ${i + 1}`,
      plotBeat: `Beat ${i + 1}`,
      povCharacter: 'Hero',
      emotionalState: 'steady',
      location: 'Somewhere',
      keyEvents: [`event ${i + 1}`],
      hookType: 'hook',
      targetWordCount: 1000,
    }));

    // Builds a fully approved Chapter with the given number — used
    // to seed `state.chapters` so we can prove prior chapters keep
    // their indices after a retry.
    const approvedChapter = (n: number): Chapter => ({
      id: `chapter-${n}`,
      number: n,
      title: `Chapter ${n}`,
      content: `prior content for chapter ${n}`,
      wordCount: 100,
      status: 'approved',
      createdAt: new Date(),
      approvedAt: new Date(),
      revisions: [],
    });

    // Override the per-test `getState` to return the chapters and
    // blueprint we want for the retry. The orchestrator reads
    // `state.blueprint` once at the top of `retryChapters`, then
    // calls `getState` continuously during the pipeline (for
    // `characterState`, `previousChapters`, etc.). Each test needs
    // a coherent snapshot.
    const seedState = (chapters: Chapter[], blueprint: Blueprint | null = null) => {
      bookStateServiceSpy.getState.and.returnValue({
        chapters,
        characterStore: { Hero: mockCharacterState },
        worldStateDoc: 'Test world',
        status: 'completed',
        activeAgent: null,
        blueprint: blueprint ?? { ...mockBlueprint, chapters: buildBriefs(chapters.length + 3) },
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
        liveStreamStartedAt: null
      });
    };

    it('completes without writing when called with an empty numbers list', (done) => {
      service.retryChapters([], mockConfig).subscribe({
        next: () => {},
        complete: () => {
          expect(authorServiceSpy.writeChapterStreamingWithUsage).not.toHaveBeenCalled();
          // No state mutation should have happened — the early
          // return path skips the per-chapter loop and the finalize
          // helper. setSkippedChapters would only run inside a real
          // retry loop.
          expect(bookStateServiceSpy.setSkippedChapters).not.toHaveBeenCalled();
          expect(bookStateServiceSpy.setStatus).not.toHaveBeenCalled();
          done();
        }
      });
    });

    it('filters non-positive numbers before processing', (done) => {
      seedState([], { ...mockBlueprint, chapters: buildBriefs(5) });

      service.retryChapters([0, -1, -7], mockConfig).subscribe({
        next: () => {},
        complete: () => {
          // After filtering, the list is empty → no-op.
          expect(authorServiceSpy.writeChapterStreamingWithUsage).not.toHaveBeenCalled();
          expect(bookStateServiceSpy.setStatus).not.toHaveBeenCalled();
          done();
        }
      });
    });

    it('errors when no blueprint is available', (done) => {
      bookStateServiceSpy.getState.and.returnValue({
        chapters: [],
        characterStore: {},
        worldStateDoc: '',
        status: 'completed',
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
        liveStreamStartedAt: null
      });

      service.retryChapters([1, 2, 3], mockConfig).subscribe({
        error: (err) => {
          expect(err.message).toContain('No blueprint');
          expect(authorServiceSpy.writeChapterStreamingWithUsage).not.toHaveBeenCalled();
          done();
        }
      });
    });

    it('only invokes the author service for the requested chapter numbers', (done) => {
      seedState([approvedChapter(1), approvedChapter(2), approvedChapter(4)], {
        ...mockBlueprint,
        chapters: buildBriefs(5)
      });

      const callsByNumber: number[] = [];
      authorServiceSpy.writeChapterStreamingWithUsage.and.callFake((brief: ChapterBrief) => {
        callsByNumber.push(brief.number);
        return of({
          draft: { ...mockDraft, chapterId: `chapter-${brief.number}` },
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
        });
      });

      // Only retry chapter 3 — leave chapters 1, 2, 4, 5 alone.
      service.retryChapters([3], mockConfig).subscribe({
        next: () => {},
        complete: () => {
          expect(callsByNumber).toEqual([3]);
          done();
        }
      });
    });

    it('preserves prior approved chapters at their original indices after a successful retry', (done) => {
      seedState([approvedChapter(1), approvedChapter(2)], {
        ...mockBlueprint,
        chapters: buildBriefs(3)
      });

      authorServiceSpy.writeChapterStreamingWithUsage.and.callFake((brief: ChapterBrief) => of({
        draft: {
          ...mockDraft,
          chapterId: `chapter-${brief.number}`,
          content: `New content for chapter ${brief.number}, ending with a period.`,
        },
        usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
      }));

      service.retryChapters([3], mockConfig).subscribe({
        next: () => {},
        complete: () => {
          // The most recent setChapters call should have ch1 at
          // index 0, ch2 at index 1, and the freshly-approved ch3
          // inserted at index 2.
          const allCalls = bookStateServiceSpy.setChapters.calls.allArgs();
          const latest: Chapter[] = allCalls[allCalls.length - 1][0];
          expect(latest.length).toBe(3);
          expect(latest[0].id).toBe('chapter-1');
          expect(latest[1].id).toBe('chapter-2');
          expect(latest[2].id).toBe('chapter-3');
          expect(latest[2].content).toBe('New content for chapter 3, ending with a period.');
          // Successful retry → empty skipped list.
          expect(bookStateServiceSpy.setSkippedChapters).toHaveBeenCalledWith([]);
          // Final status reflects the clean retry.
          const statuses = bookStateServiceSpy.setStatus.calls.allArgs().map(c => c[0]);
          expect(statuses[statuses.length - 1]).toBe('completed');
          done();
        }
      });
    });

    it('keeps a failing retry on the skipped list and flips status to error', (done) => {
      // The retry path takes 2s × maxRetries (3 attempts, 2 between)
      // before failing — bump the Jasmine timeout.
      seedState([approvedChapter(1), approvedChapter(2)], {
        ...mockBlueprint,
        chapters: buildBriefs(3)
      });
      authorServiceSpy.writeChapterStreamingWithUsage.and.returnValue(throwError(() => new Error('still broken')));

      service.retryChapters([3], mockConfig).subscribe({
        next: () => {},
        complete: () => {
          // prior chapters untouched
          expect(bookStateServiceSpy.setChapters).not.toHaveBeenCalled();
          // still on the skipped list
          const skippedCalls = bookStateServiceSpy.setSkippedChapters.calls.allArgs().map(c => c[0]);
          expect(skippedCalls[skippedCalls.length - 1]).toEqual([3]);
          // failure → error so the export gate stays loud
          const statuses = bookStateServiceSpy.setStatus.calls.allArgs().map(c => c[0]);
          expect(statuses[statuses.length - 1]).toBe('error');
          done();
        }
      });
    }, 15000);

    it('processes multiple retry targets in ascending number order', (done) => {
      seedState([], {
        ...mockBlueprint,
        chapters: buildBriefs(5)
      });

      const callsByNumber: number[] = [];
      authorServiceSpy.writeChapterStreamingWithUsage.and.callFake((brief: ChapterBrief) => {
        callsByNumber.push(brief.number);
        return of({
          draft: { ...mockDraft, chapterId: `chapter-${brief.number}` },
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 }
        });
      });

      // Pass them deliberately out of order — the orchestrator
      // should sort and process 2 then 4.
      service.retryChapters([4, 2], mockConfig).subscribe({
        next: () => {},
        complete: () => {
          expect(callsByNumber).toEqual([2, 4]);
          done();
        }
      });
    });

    it('keeps chapter 3 at its correct index even when chapters 4 and 5 were approved earlier', (done) => {
      // Scenario covered by the plan: a previous run skipped ch3
      // but approved 1, 2, 4, 5 — the orchestrator's append-only
      // pipeline produced [ch1, ch2, ch4, ch5]. A retry of ch3
      // must land at index 2 (between ch2 and ch4), not at the
      // tail.
      seedState([approvedChapter(1), approvedChapter(2), approvedChapter(4), approvedChapter(5)], {
        ...mockBlueprint,
        chapters: buildBriefs(5)
      });

      service.retryChapters([3], mockConfig).subscribe({
        next: () => {},
        complete: () => {
          const allCalls = bookStateServiceSpy.setChapters.calls.allArgs();
          const latest: Chapter[] = allCalls[allCalls.length - 1][0];
          expect(latest.map(c => c.number)).toEqual([1, 2, 3, 4, 5]);
          done();
        }
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

  describe('live-stream buffer wiring', () => {
    // The 6-agent pipeline (architect / author / critic / reviser /
    // character / continuity) must all open a stream window via
    // `beginStream$` and close it via `endStream$` so the Live
    // Output card shows prose or JSON as each agent emits deltas.
    // The orchestrator opens the architect window synchronously at
    // the top of `orchestrate()`; the others are wrapped in
    // `finalize()` so `endStream$` fires whether the agent succeeded
    // or errored.
    it('opens and closes the live-stream window for every pipeline agent', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          // The architect pipe's `finalize(() => endStream$())`
          // runs AFTER the consumer's complete callback in RxJS 7+,
          // so on the same tick the spy only reflects the calls
          // that fired during the inner subscribe chain. Schedule
          // the assertion on a microtask so the architect finalize
          // has a chance to run before we read the count.
          setTimeout(() => {
            const beginCalls = (bookStateServiceSpy.beginStream$ as jasmine.Spy).calls.allArgs()
              .map(c => c[0]);
            const endCalls = (bookStateServiceSpy.endStream$ as jasmine.Spy).calls.count();

            // architect / author / critic / reviser / character /
            // continuity — each appears at least once in the begin
            // calls. reviser only opens a window when a revision is
            // needed (critic score < 7 + revisionCount < 3), but the
            // mock critique has overallScore = 8 so it does NOT run.
            // The begin-stream count for the other 5 is non-zero;
            // reviser appears 0 times here.
            expect(beginCalls).toContain('architect');
            expect(beginCalls).toContain('author');
            expect(beginCalls).toContain('critic');
            expect(beginCalls).toContain('character');
            expect(beginCalls).toContain('continuity');
            // endStream$ fires once per agent that opened a window
            // (finalize on the architect pipe) plus once per agent
            // run that opened its own window (critic / character /
            // continuity). On a clean run with no revision that is
            // 1 (architect finalize) + 1 (author success) + 1
            // (critic) + 1 (character) + 1 (continuity) = 5.
            expect(endCalls).toBeGreaterThanOrEqual(4);
            done();
          }, 0);
        }
      });
    });

    it('clears the live-stream buffer when orchestrate() is called (regenerate-clears-buffer)', () => {
      // The Regenerate button kicks off a fresh orchestrate() call.
      // Stale text from the previous run must be wiped synchronously
      // (inside the subscriber function) before any new agent starts.
      // We assert via the spy — the real BookStateService has its own
      // behaviour covered in book-state.service.spec.ts.
      service.orchestrate(mockConfig).subscribe();

      // clearLiveStreamBuffer is called inside the subscriber body,
      // which runs synchronously when .subscribe() is invoked.
      expect(bookStateServiceSpy.clearLiveStreamBuffer).toHaveBeenCalled();
    });
  });

  describe('error and retry counters', () => {
    // The orchestrator increments `errorCount` once per agent
    // failure and `retryCount` once per scheduled retry. A clean
    // run (no failures) must leave both at zero so the live output
    // card chips and the stats KPI tiles don't false-positive.
    it('keeps both counters at zero on a clean run', (done) => {
      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          expect(bookStateServiceSpy.incrementErrorCount).not.toHaveBeenCalled();
          expect(bookStateServiceSpy.incrementRetryCount).not.toHaveBeenCalled();
          done();
        }
      });
    });

    it('increments the error counter when the architect blueprint call fails', (done) => {
      architectServiceSpy.generateBlueprintStreamingWithUsage.and.returnValue(throwError(() => new Error('blueprint down')));

      service.orchestrate(mockConfig).subscribe({
        error: () => {
          expect(bookStateServiceSpy.incrementErrorCount).toHaveBeenCalled();
          done();
        }
      });
    });

    it('increments the error counter once per author attempt failure across retries', (done) => {
      // 3 author attempts, all error out before the per-section
      // skip rule kicks in. Each failed attempt counts as one
      // error; the first attempt does NOT count as a retry.
      authorServiceSpy.writeChapterStreamingWithUsage.and.returnValue(throwError(() => new Error('author down')));

      service.orchestrate(mockConfig).subscribe({
        complete: () => {
          // 3 failed author attempts → 3 error increments.
          expect((bookStateServiceSpy.incrementErrorCount as jasmine.Spy).calls.count()).toBe(3);
          // 2 retries scheduled (attempts 2 and 3) → 2 retry
          // increments. The third failure has no follow-up attempt
          // so it does not bump the retry counter.
          expect((bookStateServiceSpy.incrementRetryCount as jasmine.Spy).calls.count()).toBe(2);
          done();
        }
      });
    }, 15000);
  });
});
