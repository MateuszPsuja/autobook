import { TestBed } from '@angular/core/testing';
import { CharacterService } from './character.service';
import { ApiService } from '../../core/api.service';
import { JsonParserService } from '../../shared/utils/json-parser.service';
import { ChapterBrief } from '../../models/book-state.model';
import { CharacterStore, CharacterState } from '../../models/character.model';
import { of, throwError } from 'rxjs';

describe('CharacterService', () => {
  let service: CharacterService;
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

  const mockCharacterStore: CharacterStore = {
    Hero: createMockCharacterState()
  };

  const mockAnalysisResponse = {
    violations: [],
    suggestions: ['Good consistency'],
    characterStates: {
      Hero: {
        emotionalState: 'Excited',
        physicalState: 'Healthy',
        location: 'Village',
        keyDevelopments: ['Met the mentor']
      }
    }
  };

  beforeEach(() => {
    const apiSpy = jasmine.createSpyObj('ApiService', ['chatCompletion']);
    const jsonSpy = jasmine.createSpyObj('JsonParserService', ['parse']);

    // Default: return empty observable for chatCompletion
    apiSpy.chatCompletion.and.returnValue(of({
      id: 'test',
      choices: [{
        message: { role: 'assistant', content: JSON.stringify(mockAnalysisResponse) },
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
        CharacterService,
        { provide: ApiService, useValue: apiSpy },
        { provide: JsonParserService, useValue: jsonSpy }
      ]
    });

    service = TestBed.inject(CharacterService);
    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
    jsonParserSpy = TestBed.inject(JsonParserService) as jasmine.SpyObj<JsonParserService>;
  });

  describe('Service Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });
  });

  describe('checkCharacterConsistency', () => {
    it('should call chatCompletion with correct request', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockAnalysisResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(mockAnalysisResponse);

      service.checkCharacterConsistency('Test content', mockBrief, mockCharacterStore, 'test/model').subscribe({
        next: (result) => {
          expect(result).toBeDefined();
          expect(result.violations).toEqual([]);
          done();
        },
        error: done.fail
      });

      expect(apiServiceSpy.chatCompletion).toHaveBeenCalled();
      const callArgs = apiServiceSpy.chatCompletion.calls.mostRecent().args[0];
      expect(callArgs.model).toBe('test/model');
      expect(callArgs.messages.length).toBe(2);
      expect(callArgs.temperature).toBe(0.3);
    });

    it('should parse violations from response', (done) => {
      const violationsResponse = {
        ...mockAnalysisResponse,
        violations: [{ characterName: 'Hero', issue: 'Out of character behavior', location: 'Chapter 1', severity: 'High', suggestedFix: 'Fix behavior' }]
      };

      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(violationsResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(violationsResponse);

      service.checkCharacterConsistency('Test content', mockBrief, mockCharacterStore, 'test/model').subscribe({
        next: (result) => {
          expect(result.violations.length).toBe(1);
          expect(result.violations[0].issue).toBe('Out of character behavior');
          done();
        },
        error: done.fail
      });
    });

    it('should handle API errors gracefully', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(throwError(() => new Error('API Error')));

      service.checkCharacterConsistency('Test content', mockBrief, mockCharacterStore, 'test/model').subscribe({
        next: (result) => {
          // Should return empty result on error
          expect(result.violations).toEqual([]);
          expect(result.suggestions).toContain('Failed to analyze character consistency');
          done();
        },
        error: done.fail
      });
    });
  });

  describe('checkCharacterConsistencyWithUsage', () => {
    it('should return usage data along with result', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockAnalysisResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(mockAnalysisResponse);

      service.checkCharacterConsistencyWithUsage('Test content', mockBrief, mockCharacterStore, 'test/model').subscribe({
        next: (result) => {
          expect(result.data).toBeDefined();
          expect(result.usage.promptTokens).toBe(100);
          expect(result.usage.completionTokens).toBe(200);
          expect(result.usage.totalTokens).toBe(300);
          done();
        },
        error: done.fail
      });
    });

    it('should handle missing usage data', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockAnalysisResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      } as any));

      jsonParserSpy.parse.and.returnValue(mockAnalysisResponse);

      service.checkCharacterConsistencyWithUsage('Test content', mockBrief, mockCharacterStore, 'test/model').subscribe({
        next: (result) => {
          expect(result.usage.promptTokens).toBe(0);
          expect(result.usage.completionTokens).toBe(0);
          expect(result.usage.totalTokens).toBe(0);
          done();
        },
        error: done.fail
      });
    });
  });

  describe('updateCharacterStates', () => {
    it('should update character states from response', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockAnalysisResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(mockAnalysisResponse);

      service.updateCharacterStates('Test content', mockBrief, mockCharacterStore, 1, 'test/model').subscribe({
        next: (updatedStore) => {
          expect(updatedStore['Hero']).toBeDefined();
          expect(updatedStore['Hero'].currentStatus.emotionalState).toBe('Excited');
          done();
        },
        error: done.fail
      });
    });

    it('should preserve original store on API error', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(throwError(() => new Error('API Error')));

      service.updateCharacterStates('Test content', mockBrief, mockCharacterStore, 1, 'test/model').subscribe({
        next: (updatedStore) => {
          expect(updatedStore).toEqual(mockCharacterStore);
          done();
        },
        error: done.fail
      });
    });

    it('should not update unknown characters', (done) => {
      const unknownCharacterResponse = {
        ...mockAnalysisResponse,
        characterStates: {
          UnknownCharacter: {
            emotionalState: 'Mysterious',
            physicalState: 'Unknown',
            location: 'Shadow realm',
            keyDevelopments: []
          }
        }
      };

      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(unknownCharacterResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(unknownCharacterResponse);

      service.updateCharacterStates('Test content', mockBrief, mockCharacterStore, 1, 'test/model').subscribe({
        next: (updatedStore) => {
          expect(updatedStore['UnknownCharacter']).toBeUndefined();
          done();
        },
        error: done.fail
      });
    });
  });

  describe('updateCharacterStatesWithUsage', () => {
    it('should return usage data along with updated store', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockAnalysisResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 150, completion_tokens: 250, total_tokens: 400 }
      }));

      jsonParserSpy.parse.and.returnValue(mockAnalysisResponse);

      service.updateCharacterStatesWithUsage('Test content', mockBrief, mockCharacterStore, 1, 'test/model').subscribe({
        next: (result) => {
          expect(result.data['Hero']).toBeDefined();
          expect(result.usage.totalTokens).toBe(400);
          done();
        },
        error: done.fail
      });
    });
  });
});
