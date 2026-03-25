import { TestBed } from '@angular/core/testing';
import { ContinuityService, ContinuityResult, ContinuityFlagsResult } from './continuity.service';
import { ApiService } from '../../core/api.service';
import { JsonParserService } from '../../shared/utils/json-parser.service';
import { ChapterBrief, Issue } from '../../models/book-state.model';
import { Chapter } from '../../models/chapter.model';
import { of, throwError } from 'rxjs';

describe('ContinuityService', () => {
  let service: ContinuityService;
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

  const mockChapter: Chapter = {
    id: 'chapter-1',
    number: 1,
    title: 'Chapter 1: The Beginning',
    content: 'Previous chapter content.',
    wordCount: 100,
    status: 'approved',
    createdAt: new Date(),
    revisions: []
  };

  const mockAnalysisResponse: any = {
    issues: [],
    overallContinuity: 'Good',
    summary: 'No continuity issues found'
  };

  const mockFlagsResponse: any = {
    resolvedFlags: ['flag1', 'flag2'],
    newFlags: [],
    remainingFlags: []
  };

  beforeEach(() => {
    const apiSpy = jasmine.createSpyObj('ApiService', ['chatCompletion']);
    const jsonSpy = jasmine.createSpyObj('JsonParserService', ['parse']);

    // Default: return successful response for chatCompletion
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
        ContinuityService,
        { provide: ApiService, useValue: apiSpy },
        { provide: JsonParserService, useValue: jsonSpy }
      ]
    });

    service = TestBed.inject(ContinuityService);
    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
    jsonParserSpy = TestBed.inject(JsonParserService) as jasmine.SpyObj<JsonParserService>;
  });

  describe('Service Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });
  });

  describe('checkContinuity', () => {
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

      service.checkContinuity('Test content', mockBrief, [mockChapter], 'test/model').subscribe({
        next: (result) => {
          expect(result).toBeDefined();
          expect(result.overallContinuity).toBe('Good');
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

    it('should add chapter number to issues', (done) => {
      const issuesResponse: any = {
        ...mockAnalysisResponse,
        issues: [
          { type: 'Continuity' as const, description: 'Time inconsistency', severity: 'Medium' as const, chapter: 0, suggestedFix: 'Fix timing' }
        ]
      };

      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(issuesResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(issuesResponse);

      service.checkContinuity('Test content', mockBrief, [mockChapter], 'test/model').subscribe({
        next: (result) => {
          expect(result.issues.length).toBe(1);
          expect(result.issues[0].chapter).toBe(1);
          done();
        },
        error: done.fail
      });
    });

    it('should handle API errors gracefully', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(throwError(() => new Error('API Error')));

      service.checkContinuity('Test content', mockBrief, [mockChapter], 'test/model').subscribe({
        next: (result) => {
          expect(result.issues).toEqual([]);
          expect(result.overallContinuity).toBe('Fair');
          done();
        },
        error: done.fail
      });
    });
  });

  describe('checkContinuityWithUsage', () => {
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

      service.checkContinuityWithUsage('Test content', mockBrief, [mockChapter], 'test/model').subscribe({
        next: (result) => {
          expect(result.data).toBeDefined();
          expect(result.usage.promptTokens).toBe(100);
          expect(result.usage.totalTokens).toBe(300);
          done();
        },
        error: done.fail
      });
    });
  });

  describe('checkContinuityFlags', () => {
    it('should call chatCompletion with correct request', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockFlagsResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(mockFlagsResponse);

      const currentFlags: Issue[] = [
        { type: 'Continuity' as const, description: 'Flag 1', severity: 'Low' as const, chapter: 1, suggestedFix: 'Fix' }
      ];

      service.checkContinuityFlags(currentFlags, 'Test content', mockBrief, 1, 'test/model').subscribe({
        next: (result) => {
          expect(result).toBeDefined();
          expect(result.resolvedFlags).toContain('flag1');
          done();
        },
        error: done.fail
      });

      expect(apiServiceSpy.chatCompletion).toHaveBeenCalled();
      const callArgs = apiServiceSpy.chatCompletion.calls.mostRecent().args[0];
      expect(callArgs.model).toBe('test/model');
      expect(callArgs.messages.length).toBe(2);
      expect(callArgs.temperature).toBe(0.2);
    });

    it('should add chapter number to new flags', (done) => {
      const newFlagsResponse: any = {
        ...mockFlagsResponse,
        newFlags: [
          { type: 'Continuity' as const, description: 'New issue', severity: 'Medium' as const, chapter: 0, suggestedFix: 'Fix' }
        ]
      };

      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(newFlagsResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      jsonParserSpy.parse.and.returnValue(newFlagsResponse);

      service.checkContinuityFlags([], 'Test content', mockBrief, 2, 'test/model').subscribe({
        next: (result) => {
          expect(result.newFlags.length).toBe(1);
          expect(result.newFlags[0].chapter).toBe(2);
          done();
        },
        error: done.fail
      });
    });

    it('should handle API errors gracefully', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(throwError(() => new Error('API Error')));

      service.checkContinuityFlags([], 'Test content', mockBrief, 1, 'test/model').subscribe({
        next: (result) => {
          expect(result.resolvedFlags).toEqual([]);
          expect(result.newFlags).toEqual([]);
          expect(result.remainingFlags).toEqual([]);
          done();
        },
        error: done.fail
      });
    });
  });

  describe('checkContinuityFlagsWithUsage', () => {
    it('should return usage data along with result', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockFlagsResponse) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 150, completion_tokens: 250, total_tokens: 400 }
      }));

      jsonParserSpy.parse.and.returnValue(mockFlagsResponse);

      service.checkContinuityFlagsWithUsage([], 'Test content', mockBrief, 1, 'test/model').subscribe({
        next: (result) => {
          expect(result.data).toBeDefined();
          expect(result.usage.totalTokens).toBe(400);
          done();
        },
        error: done.fail
      });
    });
  });
});
