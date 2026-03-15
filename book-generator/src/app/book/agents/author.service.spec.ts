import { TestBed } from '@angular/core/testing';
import { AuthorService } from './author.service';
import { ApiService } from '../../core/api.service';
import { ChapterBrief, AuthorContext } from '../../models/book-state.model';
import { ChapterDraft } from '../../models/chapter.model';
import { CharacterState } from '../../models/character.model';
import { of, Subject, throwError } from 'rxjs';

describe('AuthorService', () => {
  let service: AuthorService;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;

  const mockBrief: ChapterBrief = {
    number: 1,
    title: 'Chapter 1: The Beginning',
    plotBeat: 'Introduction',
    povCharacter: 'Hero',
    emotionalState: 'Curious',
    location: 'Village',
    keyEvents: ['Meet mentor', 'Receive quest'],
    hookType: 'Mystery',
    targetWordCount: 2500
  };

  const createMockCharacterState = (): CharacterState => ({
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
  });

  const mockContext: AuthorContext = {
    model: 'test/model',
    chapterBrief: mockBrief,
    previousChapters: [],
    characterState: createMockCharacterState(),
    worldState: 'The world is at peace.'
  };

  beforeEach(() => {
    const spy = jasmine.createSpyObj('ApiService', ['chatCompletion', 'chatCompletionStream']);
    
    TestBed.configureTestingModule({
      providers: [
        AuthorService,
        { provide: ApiService, useValue: spy }
      ]
    });

    service = TestBed.inject(AuthorService);
    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
  });

  describe('Service Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });
  });

  describe('writeChapter', () => {
    it('should call chatCompletionStream with correct request', (done) => {
      // Create a Subject that mimics the streaming behavior
      const mockSubject = new Subject<string>();
      
      apiServiceSpy.chatCompletionStream.and.returnValue(mockSubject.asObservable());

      const result = service.writeChapter(mockBrief, mockContext);
      
      let callCount = 0;
      result.subscribe({
        next: (draft) => {
          callCount++;
          // First emission should have content
          if (callCount === 1) {
            expect(draft.content).toBeDefined();
          }
        },
        complete: () => {
          done();
        }
      });

      // Emit some test content
      mockSubject.next('Test content');
      mockSubject.complete();

      expect(apiServiceSpy.chatCompletionStream).toHaveBeenCalled();
    });
  });

  describe('reviseChapter', () => {
    const mockDraft: ChapterDraft = {
      chapterId: 'chapter-1',
      content: 'Original chapter content.',
      wordCount: 3,
      progress: 100,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const mockCritique = {
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
    };

    it('should call chatCompletion with correct request', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { 
            role: 'assistant', 
            content: 'Revised chapter content.' 
          },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      const result = service.reviseChapter(mockDraft, mockCritique, mockBrief, 'test/model');
      
      result.subscribe({
        next: (draft) => {
          expect(draft).toBeDefined();
          expect(draft.content).toBe('Revised chapter content.');
          done();
        },
        error: done.fail
      });

      expect(apiServiceSpy.chatCompletion).toHaveBeenCalled();
    });

    it('should handle API errors', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(throwError(() => new Error('API Error')));

      const result = service.reviseChapter(mockDraft, mockCritique, mockBrief, 'test/model');
      
      result.subscribe({
        next: () => done.fail('Should have errored'),
        error: (error) => {
          expect(error).toBeDefined();
          done();
        }
      });
    });
  });
});
