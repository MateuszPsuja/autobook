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
    plot: '',
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

    it('should include an empty-plot marker in the user prompt when plot is empty', () => {
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
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }));

      service.generateBlueprint({ ...mockConfig, plot: '' }).subscribe();

      const callArgs = apiServiceSpy.chatCompletion.calls.mostRecent().args[0];
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage!.content).toContain('User Plot / Story Description');
      expect(userMessage!.content).toContain('(none');
    });

    it('should thread the user plot into the user prompt as the authoritative source', () => {
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
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }));

      const userPlot = 'A retired cartographer discovers her late father\'s map is a key to a city that doesn\'t exist on any chart.';
      service.generateBlueprint({ ...mockConfig, plot: userPlot }).subscribe();

      const callArgs = apiServiceSpy.chatCompletion.calls.mostRecent().args[0];
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage!.content).toContain('User Plot / Story Description (authoritative)');
      expect(userMessage!.content).toContain('cartographer');
      expect(userMessage!.content).toContain('city that doesn\'t exist');
    });

    it('should declare user-plot authority in the system prompt', () => {
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
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }));

      service.generateBlueprint(mockConfig).subscribe();

      const callArgs = apiServiceSpy.chatCompletion.calls.mostRecent().args[0];
      const systemMessage = callArgs.messages.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage!.content.toLowerCase()).toContain('user plot');
      expect(systemMessage!.content.toLowerCase()).toContain('authoritative');
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

    // The post-processor that rewrites placeholder titles (e.g. "Chapter",
    // "Chapter 1", "Chapter Title") is the user-facing fix for the
    // "all chapters named 'Chapter'" bug. It must:
    //   - rewrite any banned / placeholder title using the chapter's
    //     own plotBeat,
    //   - leave real, descriptive titles (like "Chapter 1: The Beginning")
    //     untouched.
    describe('placeholder-title sanitiser', () => {
      const replyWithChapters = (chapters: Array<{ number: number; title: string; plotBeat: string }>) => {
        const blueprint = { ...mockBlueprint, chapters: chapters.map((c) => ({ ...c, povCharacter: 'Hero', emotionalState: 'engaged', location: 'X', keyEvents: ['e'], hookType: 'continuation', targetWordCount: 2500 })) };
        apiServiceSpy.chatCompletion.and.returnValue(of({
          id: 'test',
          choices: [{ message: { role: 'assistant', content: JSON.stringify(blueprint) }, finish_reason: 'stop', index: 0 }],
          created: 123,
          model: 'test/model',
          object: 'chat.completion',
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        }));
      };

      it('rewrites a bare "Chapter" title from the plotBeat', (done) => {
        replyWithChapters([
          { number: 1, title: 'Chapter', plotBeat: 'Mara arrives at the lighthouse and meets the keeper.' }
        ]);
        service.generateBlueprintWithUsage(mockConfig).subscribe({
          next: (res) => {
            const t = res.data.chapters[0].title;
            expect(t).not.toBe('Chapter');
            // Cap is 8 words; "Mara arrives at the lighthouse and meets the"
            // (8 words) — "keeper" is dropped by the cap.
            expect(t).toBe('Mara Arrives at the Lighthouse and Meets the');
            done();
          },
          error: done.fail
        });
      });

      it('rewrites "Chapter 3" (no descriptive content) using the plotBeat', (done) => {
        replyWithChapters([
          { number: 3, title: 'Chapter 3', plotBeat: 'A storm rolls in and the bridge collapses.' }
        ]);
        service.generateBlueprintWithUsage(mockConfig).subscribe({
          next: (res) => {
            expect(res.data.chapters[0].title).toBe('Storm Rolls in and the Bridge Collapses');
            done();
          },
          error: done.fail
        });
      });

      it('rewrites "Chapter Title" and "Untitled" placeholders', (done) => {
        replyWithChapters([
          { number: 1, title: 'Chapter Title', plotBeat: 'The crew mutinies against the captain.' },
          { number: 2, title: 'Untitled', plotBeat: 'A second storm hits the next morning.' }
        ]);
        service.generateBlueprintWithUsage(mockConfig).subscribe({
          next: (res) => {
            expect(res.data.chapters[0].title).toBe('Crew Mutinies Against the Captain');
            expect(res.data.chapters[1].title).toBe('Second Storm Hits the Next Morning');
            done();
          },
          error: done.fail
        });
      });

      it('preserves real titles that have descriptive content after the chapter number', (done) => {
        replyWithChapters([
          { number: 1, title: 'Chapter 1: The Beginning', plotBeat: 'irrelevant' },
          { number: 2, title: 'The Last Train North', plotBeat: 'irrelevant' }
        ]);
        service.generateBlueprintWithUsage(mockConfig).subscribe({
          next: (res) => {
            expect(res.data.chapters[0].title).toBe('Chapter 1: The Beginning');
            expect(res.data.chapters[1].title).toBe('The Last Train North');
            done();
          },
          error: done.fail
        });
      });
    });
  });
});
