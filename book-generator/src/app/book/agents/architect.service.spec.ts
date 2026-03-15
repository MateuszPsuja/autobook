import { TestBed } from '@angular/core/testing';
import { ArchitectService } from './architect.service';
import { ApiService } from '../../core/api.service';
import { JsonParserService } from '../../shared/utils/json-parser.service';
import { BookConfig, Genre, WritingStyle, Tone, PointOfView, Tense, Audience, PlotArchetype, ActStructure, WorldType, BookLength, ChapterLength } from '../../models/book-config.model';
import { Blueprint } from '../../models/book-state.model';
import { of, throwError } from 'rxjs';

describe('ArchitectService', () => {
  let service: ArchitectService;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;

  const mockConfig: BookConfig = {
    title: 'Test Book',
    genre: 'Fantasy' as Genre,
    style: 'Literary' as WritingStyle,
    tone: 'Dark' as Tone,
    pov: 'First Person' as PointOfView,
    tense: 'Past' as Tense,
    audience: 'Adult' as Audience,
    themes: ['Adventure', 'Friendship'],
    worldType: 'Fantasy' as WorldType,
    targetLength: 'Novel' as BookLength,
    chapterLength: 'Standard' as ChapterLength,
    model: 'test/model',
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
    hasEpilogue: false
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
        keyEvents: ['Meet mentor', 'Receive quest'],
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
        keyMoments: ['First battle', 'Sacrifice']
      }
    ],
    worldBuilding: [
      {
        name: 'Magic System',
        description: 'Elemental magic',
        rules: ['Requires focus', 'Has limits'],
        significance: 'Central to plot'
      }
    ],
    themes: ['Adventure', 'Friendship'],
    keyPlotPoints: ['Inciting incident', 'Midpoint revelation', 'Climax']
  };

  beforeEach(() => {
    const spy = jasmine.createSpyObj('ApiService', ['chatCompletion', 'chatCompletionStream']);
    
    TestBed.configureTestingModule({
      providers: [
        ArchitectService,
        JsonParserService,
        { provide: ApiService, useValue: spy }
      ]
    });

    service = TestBed.inject(ArchitectService);
    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
  });

  describe('Service Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });
  });

  describe('generateBlueprint', () => {
    it('should call chatCompletion with correct request', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockBlueprint) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      const result = service.generateBlueprint(mockConfig);
      
      result.subscribe({
        next: (blueprint) => {
          expect(blueprint).toBeDefined();
          expect(blueprint.chapters).toBeDefined();
          done();
        },
        error: done.fail
      });

      // Verify API was called
      expect(apiServiceSpy.chatCompletion).toHaveBeenCalled();
      const callArgs = apiServiceSpy.chatCompletion.calls.mostRecent().args[0];
      expect(callArgs.model).toBe(mockConfig.model);
      expect(callArgs.messages).toBeDefined();
      expect(callArgs.messages.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse JSON response into Blueprint', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockBlueprint) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }));

      const result = service.generateBlueprint(mockConfig);
      
      result.subscribe({
        next: (blueprint) => {
          expect(blueprint.chapters).toEqual(mockBlueprint.chapters);
          expect(blueprint.themes).toEqual(mockBlueprint.themes);
          done();
        },
        error: done.fail
      });
    });

    it('should handle API errors', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(throwError(() => new Error('API Error')));

      const result = service.generateBlueprint(mockConfig);
      
      result.subscribe({
        next: () => done.fail('Should have errored'),
        error: (error) => {
          expect(error).toBeDefined();
          done();
        }
      });
    });

    it('should handle malformed JSON response', (done) => {
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

      const result = service.generateBlueprint(mockConfig);
      
      result.subscribe({
        next: () => done.fail('Should have errored'),
        error: (error) => {
          expect(error).toBeDefined();
          done();
        }
      });
    });
  });

  describe('generateBlueprintWithUsage', () => {
    it('should return data and usage when API responds with valid content', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{
          message: { role: 'assistant', content: JSON.stringify(mockBlueprint) },
          finish_reason: 'stop',
          index: 0
        }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }));

      const result = service.generateBlueprintWithUsage(mockConfig);

      result.subscribe({
        next: (res) => {
          expect(res).toBeDefined();
          expect(res.data).toEqual(mockBlueprint);
          expect(res.usage).toBeDefined();
          expect(res.usage.totalTokens).toBe(30);
          done();
        },
        error: done.fail
      });
    });

    it('should error when response has empty choices', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      }));

      const result = service.generateBlueprintWithUsage(mockConfig);

      result.subscribe({
        next: () => done.fail('Should have errored for empty choices'),
        error: (err) => {
          expect(err).toBeDefined();
          done();
        }
      });
    });

    it('should error when message content is missing', (done) => {
      apiServiceSpy.chatCompletion.and.returnValue(of({
        id: 'test',
        choices: [{ message: {} as any, finish_reason: 'stop', index: 0 }],
        created: 123,
        model: 'test/model',
        object: 'chat.completion',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      }));

      const result = service.generateBlueprintWithUsage(mockConfig);

      result.subscribe({
        next: () => done.fail('Should have errored for missing content'),
        error: (err) => {
          expect(err).toBeDefined();
          done();
        }
      });
    });
  });
});
