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

    it('should treat an all-zeros / empty JSON as a parse failure', (done) => {
      // The model returned a structurally valid but content-empty
      // critique object — the kind a model produces when it
      // complies literally with an "empty critique" rescue prompt.
      // We must NOT let this slip through as a real critique,
      // because the UI would render a 0/10 panel instead of the
      // "unavailable" panel the user actually wants.
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: '{"scores":{},"overallScore":0,"feedback":"","mustFix":[],"suggestions":[]}' },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      }));

      jsonParserSpy.parse.and.callFake((raw: string) => JSON.parse(raw));

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: (critique) => {
          expect(critique).toBeDefined();
          // The empty critique should be converted to the
          // unavailableReason sentinel, not passed through as a
          // valid (but content-less) CritiqueReport.
          expect(critique.unavailableReason).toBeDefined();
          expect(critique.unavailableReason!.length).toBeGreaterThan(0);
          done();
        },
        error: done.fail
      });
    });

    it('should re-run the original evaluation (with the chapter) when the first response is unparseable JSON', (done) => {
      // First call: model returns broken JSON (parse will fail).
      // Second call (rescue): model returns a real critique.
      // The rescue must re-run the ORIGINAL evaluation — the
      // extract-JSON-from-bad-output approach was unreliable
      // because the model is bad at fixing its own broken JSON.
      const brokenResponse: any = {
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: '{"scores":a, "overallScore":0}' },
          finish_reason: 'stop',
          index: 0
        }],
        created: 1, model: 'test/model', object: 'chat.completion',
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
      };
      const goodResponse: any = {
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: '{"scores":{"prose":7,"pacing":7,"showVsTell":7,"dialogue":7,"continuity":7,"hookStrength":7,"thematicResonance":7},"overallScore":7,"feedback":"Solid chapter with good pacing.","mustFix":["trim the opening"],"suggestions":["add more sensory detail"]}' },
          finish_reason: 'stop', index: 0
        }],
        created: 1, model: 'test/model', object: 'chat.completion',
        usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130 }
      };
      // The json parser will throw on the broken JSON and succeed
      // on the good JSON.
      jsonParserSpy.parse.and.callFake((raw: string) => JSON.parse(raw));
      apiServiceSpy.chatCompletion.and.returnValues(of(brokenResponse), of(goodResponse));

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: (critique) => {
          expect(critique).toBeDefined();
          // The rescue's parsed result should win, not the
          // unavailableReason sentinel.
          expect(critique.unavailableReason).toBeUndefined();
          expect(critique.feedback).toBe('Solid chapter with good pacing.');
          expect(critique.overallScore).toBe(7);
          // Two API calls: the original and the rescue.
          expect(apiServiceSpy.chatCompletion).toHaveBeenCalledTimes(2);
          done();
        },
        error: done.fail
      });
    });

    it('should retry the rescue up to MAX_CRITIC_RETRIES times before giving up', (done) => {
      // All four responses (1 original + 3 rescues) come back
      // unparseable. The service must consume all of them, then
      // surface the unavailableReason sentinel — the chapter is
      // still safe to export, the user just doesn't get a critique.
      const brokenResponse: any = {
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: 'not valid json at all' },
          finish_reason: 'stop', index: 0
        }],
        created: 1, model: 'test/model', object: 'chat.completion',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      };
      jsonParserSpy.parse.and.callFake((raw: string) => JSON.parse(raw));
      apiServiceSpy.chatCompletion.and.returnValue(of(brokenResponse));

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: (critique) => {
          expect(critique).toBeDefined();
          expect(critique.unavailableReason).toBeDefined();
          // 1 original + 3 rescues = 4 total API calls.
          expect(apiServiceSpy.chatCompletion).toHaveBeenCalledTimes(4);
          done();
        },
        error: done.fail
      });
    });

    it('should succeed on a later rescue retry (not just the first one)', (done) => {
      // First two calls (original + rescue #1) return broken JSON.
      // Third call (rescue #2) succeeds. The first parseable
      // response must win, even if it isn't the rescue we tried first.
      const brokenResponse: any = {
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: 'definitely not json' },
          finish_reason: 'stop', index: 0
        }],
        created: 1, model: 'test/model', object: 'chat.completion',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      };
      const goodResponse: any = {
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: '{"scores":{"prose":9,"pacing":9,"showVsTell":9,"dialogue":9,"continuity":9,"hookStrength":9,"thematicResonance":9},"overallScore":9,"feedback":"Nailed it.","mustFix":[],"suggestions":["keep going"]}' },
          finish_reason: 'stop', index: 0
        }],
        created: 1, model: 'test/model', object: 'chat.completion',
        usage: { prompt_tokens: 10, completion_tokens: 40, total_tokens: 50 }
      };
      jsonParserSpy.parse.and.callFake((raw: string) => JSON.parse(raw));
      apiServiceSpy.chatCompletion.and.returnValues(
        of(brokenResponse), // original
        of(brokenResponse), // rescue #1 — still broken
        of(goodResponse)    // rescue #2 — finally clean
      );

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: (critique) => {
          expect(critique).toBeDefined();
          expect(critique.unavailableReason).toBeUndefined();
          expect(critique.overallScore).toBe(9);
          expect(critique.feedback).toBe('Nailed it.');
          // 3 API calls: 1 original + 2 rescues (the third rescue
          // never happened because the second one succeeded).
          expect(apiServiceSpy.chatCompletion).toHaveBeenCalledTimes(3);
          done();
        },
        error: done.fail
      });
    });

    it('should bump the rescue temperature on each retry attempt', (done) => {
      // The rescue's whole point is to give the model a different
      // sample when the first one came out broken. A retry that
      // re-uses temperature 0.1 deterministically would just produce
      // the same broken output again. Verify the temperature goes up
      // across rescue attempts.
      const brokenResponse: any = {
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: 'still not json' },
          finish_reason: 'stop', index: 0
        }],
        created: 1, model: 'test/model', object: 'chat.completion',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      };
      jsonParserSpy.parse.and.callFake((raw: string) => JSON.parse(raw));
      apiServiceSpy.chatCompletion.and.returnValue(of(brokenResponse));

      service.evaluateChapter('Test content', mockBrief, mockContext).subscribe({
        next: () => {
          const temps = apiServiceSpy.chatCompletion.calls.allArgs().map(args => args[0].temperature);
          // The original is 0.3 (from buildRequest); the three
          // rescues are 0.1, 0.2, 0.3. We only care that the
          // rescue temperatures are non-decreasing and that they
          // differ from the original.
          const rescueTemps = temps.slice(1);
          expect(rescueTemps.length).toBe(3);
          // Use toBeCloseTo — 0.1 + 0.2 in JS is 0.30000000000000004
          // and a strict `toBe(0.3)` would flake on floating point.
          expect(rescueTemps[0]).toBeCloseTo(0.1, 10);
          expect(rescueTemps[1]).toBeCloseTo(0.2, 10);
          expect(rescueTemps[2]).toBeCloseTo(0.3, 10);
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
