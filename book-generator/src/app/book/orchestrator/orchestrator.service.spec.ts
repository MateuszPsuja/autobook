import { TestBed } from '@angular/core/testing';
import { OrchestratorService } from './orchestrator.service';
import { BookStateService } from '../state/book-state.service';
import { ArchitectService } from '../agents/architect.service';
import { AuthorService } from '../agents/author.service';
import { CriticService } from '../agents/critic.service';
import { CharacterService } from '../agents/character.service';
import { ContinuityService } from '../agents/continuity.service';
import { PersistenceService } from '../../core/persistence.service';
import { BookConfig, Genre, WritingStyle, Tone, PointOfView, Tense, Audience, PlotArchetype, ActStructure, WorldType, BookLength, ChapterLength } from '../../models/book-config.model';
import { Blueprint, ChapterBrief, CriticContext } from '../../models/book-state.model';
import { ChapterDraft } from '../../models/chapter.model';
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

    TestBed.configureTestingModule({
      providers: [
        OrchestratorService,
        { provide: BookStateService, useValue: bookStateServiceSpy },
        { provide: ArchitectService, useValue: architectServiceSpy },
        { provide: AuthorService, useValue: authorServiceSpy },
        { provide: CriticService, useValue: criticServiceSpy },
        { provide: CharacterService, useValue: characterServiceSpy },
        { provide: ContinuityService, useValue: continuityServiceSpy },
        { provide: PersistenceService, useValue: persistenceServiceSpy }
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
