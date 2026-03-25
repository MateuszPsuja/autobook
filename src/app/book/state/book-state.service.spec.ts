import { TestBed } from '@angular/core/testing';
import { BookStateService } from './book-state.service';
import { BookConfig, Genre, WritingStyle, Tone, PointOfView, Tense, Audience, PlotArchetype, ActStructure, WorldType, BookLength, ChapterLength } from '../../models/book-config.model';
import { Blueprint, ChapterBrief, CharacterArc, Issue } from '../../models/book-state.model';
import { Chapter, ChapterDraft } from '../../models/chapter.model';
import { CharacterState, CharacterRelationship, CharacterDevelopment, CharacterStatus } from '../../models/character.model';
import { CritiqueReport } from '../../models/critique.model';

describe('BookStateService', () => {
  let service: BookStateService;

  const createMockChapter = (id: string, title: string): Chapter => ({
    id,
    number: 1,
    title,
    content: 'Test content',
    wordCount: 2,
    status: 'draft',
    createdAt: new Date(),
    revisions: []
  });

  const createMockDraft = (content: string): ChapterDraft => ({
    chapterId: 'chapter-1',
    content,
    wordCount: content.split(' ').length,
    progress: 100,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const createMockCritique = (): CritiqueReport => ({
    scores: {
      prose: 7,
      pacing: 7,
      showVsTell: 7,
      dialogue: 7,
      continuity: 7,
      hookStrength: 7,
      thematicResonance: 7
    },
    overallScore: 7,
    feedback: 'Good work',
    mustFix: [],
    suggestions: [],
    createdAt: new Date()
  });

  const createMockContinuityFlag = (): Issue => ({
    type: 'Continuity',
    description: 'Test continuity issue',
    severity: 'Medium',
    chapter: 1,
    suggestedFix: 'Fix the issue'
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [BookStateService]
    });
    service = TestBed.inject(BookStateService);
  });

  describe('Initial State', () => {
    it('should have initial state with empty chapters', () => {
      const state = service.getState();
      expect(state.chapters).toEqual([]);
    });

    it('should have initial state with idle status', () => {
      const state = service.getState();
      expect(state.status).toBe('idle');
    });

    it('should have initial state with null blueprint', () => {
      const state = service.getState();
      expect(state.blueprint).toBeNull();
    });

    it('should have initial state with empty config', () => {
      const state = service.getState();
      expect(state.config).toBeDefined();
    });
  });

  describe('getState and getState$', () => {
    it('should return current state via getState()', () => {
      const state = service.getState();
      expect(state).toBeDefined();
      expect(state.status).toBe('idle');
    });

    it('should return state as observable via getState$()', (done) => {
      service.getState$().subscribe(state => {
        expect(state).toBeDefined();
        done();
      });
    });
  });

  describe('Immutable State Updates', () => {
    it('should patch state correctly', () => {
      service.patch({ status: 'generating' });
      const state = service.getState();
      expect(state.status).toBe('generating');
    });

    it('should preserve other state properties when patching', () => {
      service.patch({ status: 'generating' });
      const state = service.getState();
      expect(state.chapters).toEqual([]);
      expect(state.blueprint).toBeNull();
    });

    it('should create new state object on patch', () => {
      const originalState = service.getState();
      service.patch({ status: 'generating' });
      const newState = service.getState();
      expect(newState).not.toBe(originalState);
    });
  });

  describe('State Setters', () => {
    it('should set config', () => {
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
          role: 'Protagonist' as const,
          age: 25,
          background: 'Test',
          motivations: ['Test'],
          flaws: ['Test'],
          arc: 'Test'
        },
        antagonist: {
          name: 'Villain',
          role: 'Antagonist' as const,
          age: 35,
          background: 'Test',
          motivations: ['Test'],
          flaws: ['Test'],
          arc: 'Test'
        },
        plotArchetype: "Hero's Journey" as PlotArchetype,
        actStructure: 'Three Act' as ActStructure,
        hasPrologue: false,
        hasEpilogue: false,
        model: 'test'
      };
      service.setConfig(mockConfig);
      expect(service.getState().config).toEqual(mockConfig);
    });

    it('should set blueprint', () => {
      const mockBlueprint: Blueprint = {
        chapters: [],
        characterArcs: [],
        worldBuilding: [],
        themes: ['test'],
        keyPlotPoints: []
      };
      service.setBlueprint(mockBlueprint);
      expect(service.getState().blueprint).toEqual(mockBlueprint);
    });

    it('should set chapters', () => {
      const mockChapters = [createMockChapter('1', 'Chapter 1')];
      service.setChapters(mockChapters);
      expect(service.getState().chapters).toEqual(mockChapters);
    });

    it('should set current draft', () => {
      const mockDraft = createMockDraft('Draft content');
      service.setCurrentDraft(mockDraft);
      expect(service.getState().currentDraft).toEqual(mockDraft);
    });

    it('should set current draft to null', () => {
      const mockDraft = createMockDraft('test');
      service.setCurrentDraft(mockDraft);
      service.setCurrentDraft(null);
      expect(service.getState().currentDraft).toBeNull();
    });

    it('should set character store', () => {
      const mockCharacterState: CharacterState = {
        profile: {
          name: 'Test',
          role: 'Protagonist',
          age: 25,
          background: 'Test',
          motivations: ['Test'],
          flaws: ['Test'],
          arc: 'Test'
        },
        currentStatus: {
          emotionalState: 'Happy',
          physicalState: 'Healthy',
          location: 'Village',
          goals: ['Test'],
          conflicts: ['Test'],
          relationships: ['Test']
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
      const mockStore = { character1: mockCharacterState };
      service.setCharacterStore(mockStore);
      expect(service.getState().characterStore).toEqual(mockStore);
    });

    it('should set world state doc', () => {
      service.setWorldStateDoc('World state content');
      expect(service.getState().worldStateDoc).toBe('World state content');
    });

    it('should set critique', () => {
      const mockCritique = createMockCritique();
      service.setCritique(mockCritique);
      expect(service.getState().critique).toEqual(mockCritique);
    });

    it('should set revision count', () => {
      service.setRevisionCount(5);
      expect(service.getState().revisionCount).toBe(5);
    });

    it('should set continuity flags', () => {
      const mockFlags = [createMockContinuityFlag()];
      service.setContinuityFlags(mockFlags);
      expect(service.getState().continuityFlags).toEqual(mockFlags);
    });

    it('should set active agent', () => {
      service.setActiveAgent('architect');
      expect(service.getState().activeAgent).toBe('architect');
    });

    it('should set active agent to null', () => {
      service.setActiveAgent('architect');
      service.setActiveAgent(null);
      expect(service.getState().activeAgent).toBeNull();
    });

    it('should set status', () => {
      service.setStatus('writing');
      expect(service.getState().status).toBe('writing');
    });

    it('should set error', () => {
      service.setError('Test error');
      expect(service.getState().error).toBe('Test error');
    });

    it('should clear error', () => {
      service.setError('Test error');
      service.setError(null);
      expect(service.getState().error).toBeNull();
    });
  });

  describe('Derived Observables', () => {
    it('should emit active agent changes', (done) => {
      service.getActiveAgent$().subscribe(agent => {
        if (agent === 'architect') {
          done();
        }
      });
      service.setActiveAgent('architect');
    });

    it('should emit status changes', (done) => {
      service.getStatus$().subscribe(status => {
        if (status === 'generating') {
          done();
        }
      });
      service.setStatus('generating');
    });

    it('should emit chapters changes', (done) => {
      service.getChapters$().subscribe(chapters => {
        if (chapters.length === 1) {
          done();
        }
      });
      service.setChapters([createMockChapter('1', 'Chapter 1')]);
    });

    it('should emit current draft changes', (done) => {
      service.getCurrentDraft$().subscribe(draft => {
        if (draft?.content === 'test') {
          done();
        }
      });
      service.setCurrentDraft(createMockDraft('test'));
    });
  });

  describe('Reset', () => {
    it('should reset state to initial values', () => {
      // Modify state
      service.setChapters([createMockChapter('1', 'Chapter 1')]);
      service.setStatus('generating');
      service.setError('Some error');

      // Reset
      service.reset();

      // Verify
      const state = service.getState();
      expect(state.chapters).toEqual([]);
      expect(state.status).toBe('idle');
      expect(state.error).toBeNull();
      expect(state.blueprint).toBeNull();
    });
  });
});
