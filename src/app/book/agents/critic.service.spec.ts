import { TestBed } from '@angular/core/testing';
import { CriticService } from './critic.service';
import { ApiService } from '../../core/api.service';
import { JsonParserService } from '../../shared/utils/json-parser.service';
import { ChapterBrief, CriticContext } from '../../models/book-state.model';
import { CritiqueReport } from '../../models/critique.model';
import { CharacterState } from '../../models/character.model';
import { of, throwError } from 'rxjs';

describe('CriticService', () => {
  let service: CriticService;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;
  let jsonParserSpy: jasmine.SpyObj<JsonParserService>;

  const mockBrief: ChapterBrief = {
    number: 1,
    title: 'Chapter 1: The Beginning',
    plotBeat: 'Introduction',
    povCharacter: 'Hero',
    emotionalState: 'Curious',
    location: 'Village',
    keyEvents: ['Meet mentor'],
    hookType: 'Mystery',
    targetWordCount: 2500
  };

  const mockCharacterState: CharacterState = {
    profile: {
      name: 'Hero',
      role: 'Protagonist',
      age: 25,
      background: 'Test background',
      motivations: ['Test motivation'],
      flaws: ['Test flaw'],
      arc: 'Test arc'
    },
    currentStatus: {
      emotionalState: 'Ready',
      physicalState: 'Healthy',
      location: 'Village',
      goals: ['Test goal'],
      conflicts: ['Test conflict'],
      relationships: []
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

  const mockContext: CriticContext = {
    model: 'test/model',
    chapterBrief: mockBrief,
    chapterContent: 'Test chapter content.',
    characterState: mockCharacterState,
    worldState: 'The world is at peace.',
    previousChapters: []
  };

  const mockCritique: CritiqueReport = {
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
    feedback: 'Good chapter overall.',
    mustFix: [],
    suggestions: ['Consider improving pacing in the middle section'],
    createdAt: new Date()
  };

  beforeEach(() => {
    // Suppress expected console.error logs during tests
    spyOn(console, 'error').and.callFake(() => {});
    spyOn(console, 'warn').and.callFake(() => {});

    const apiSpy = jasmine.createSpyObj('ApiService', ['chatCompletion']);
    const jsonSpy = jasmine.createSpyObj('JsonParserService', ['parse']);

    // Default: return successful response for chatCompletion
    apiSpy.chatCompletion.and.returnValue(of({
      id: 'test',
      choices: [{
        message: { role: 'assistant', content: JSON.stringify(mockCritique) },
        finish_reason: 'stop',
        index: 0
      }],
      created: 123,
      model: 'test/model',
      object: 'chat.completion',
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
    }));

    TestBed.configureTestingModule({
      providers: [
        CriticService,
        { provide: ApiService, useValue: apiSpy },
        { provide: JsonParserService, useValue: jsonSpy }
      ]
    });

    service = TestBed.inject(CriticService);
    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
    jsonParserSpy = TestBed.inject(JsonParserService) as jasmine.SpyObj<JsonParserService>;
  });

  describe('Service Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });
  });

  describe('evaluateChapter', () => {
    it('should call chatCompletion with correct request structure', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockCritique) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(mockCritique);

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: (critique) => {
          expect(critique).toBeDefined();
          expect(critique.overallScore).toBe(7.7);
          done();
        },
        error: done.fail
      });

      expect(apiServiceSpy.chatCompletion).toHaveBeenCalled();
      const callArgs = apiServiceSpy.chatCompletion.calls.mostRecent().args[0];
      expect(callArgs.model).toBe(mockContext.model);
      expect(callArgs.messages).toBeDefined();
      expect(callArgs.messages.length).toBe(2);
      expect(callArgs.temperature).toBe(0.3);
      expect(callArgs.max_tokens).toBe(2000);
    });

    it('should parse JSON response into CritiqueReport', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockCritique) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(mockCritique);

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: (critique) => {
          expect(jsonParserSpy.parse).toHaveBeenCalled();
          expect(critique.scores).toEqual(mockCritique.scores);
          expect(critique.overallScore).toBe(7.7);
          expect(critique.feedback).toBe('Good chapter overall.');
          done();
        },
        error: done.fail
      });
    });

    it('should set createdAt date on critique', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockCritique) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(mockCritique);

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: (critique) => {
          expect(critique.createdAt).toBeDefined();
          expect(critique.createdAt instanceof Date).toBe(true);
          done();
        },
        error: done.fail
      });
    });

    it('should handle API errors by returning fallback critique', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(throwError(() => new Error('API Error')));

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: (critique) => {
          // Service catches errors and returns empty fallback
          expect(critique).toBeDefined();
          expect(critique.scores).toBeUndefined();
          done();
        },
        error: done.fail
      });
    });

    it('should handle JSON parse errors by returning fallback critique', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: 'Not valid JSON' },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.throwError(new Error('Parse error'));

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: (critique) => {
          // Service catches errors and returns empty fallback
          expect(critique).toBeDefined();
          expect(critique.scores).toBeUndefined();
          done();
        },
        error: done.fail
      });
    });

    it('should handle empty API response by returning fallback critique', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: '' },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 }
      }));

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: (critique) => {
          // Service catches all errors and returns empty fallback
          expect(critique).toBeDefined();
          expect(critique.scores).toBeUndefined();
          done();
        },
        error: done.fail
      });
    });
  });

  describe('compareRevisions', () => {
    it('should call chatCompletion for revision comparison', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: '{"improved": true}' },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue({ improved: true });

      service.compareRevisions('Original', 'Revised', mockBrief, 'test/model').subscribe({
        next: (comparison) => {
          expect(apiServiceSpy.chatCompletion).toHaveBeenCalled();
          const callArgs = apiServiceSpy.chatCompletion.calls.mostRecent().args[0];
          expect(callArgs.model).toBe('test/model');
          expect(callArgs.messages.length).toBe(2);
          expect(callArgs.max_tokens).toBe(1500);
          done();
        },
        error: done.fail
      });
    });

    it('should parse and return comparison result', (done) => {
      const comparisonResult = { improved: true, changes: ['Improved pacing'] };
      
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(comparisonResult) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(comparisonResult);

      service.compareRevisions('Original', 'Revised', mockBrief, 'test/model').subscribe({
        next: (comparison) => {
          expect(comparison).toEqual(comparisonResult);
          done();
        },
        error: done.fail
      });
    });

    it('should handle API errors in compareRevisions', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(throwError(() => new Error('API Error')));

      service.compareRevisions('Original', 'Revised', mockBrief, 'test/model').subscribe({
        next: () => done.fail('Should have errored'),
        error: (error) => {
          expect(error.message).toBe('API Error');
          done();
        }
      });
    });
  });
});
