import { TestBed } from '@angular/core/testing';
import { ChapterViewComponent } from './chapter-view.component';
import { BookStateService } from '../../book/state/book-state.service';
import { TranslationService } from '../../i18n/translation.service';
import { of } from 'rxjs';
import { Chapter } from '../../models/chapter.model';

describe('ChapterViewComponent', () => {
  let component: ChapterViewComponent;
  let bookStateServiceSpy: jasmine.SpyObj<BookStateService>;
  let translationServiceSpy: jasmine.SpyObj<TranslationService>;

  const mockChapters: Chapter[] = [
    {
      id: 'chapter-1',
      number: 1,
      title: 'Chapter 1: The Beginning',
      content: 'Test content for chapter 1 with more words to have a decent word count.',
      wordCount: 15,
      status: 'approved',
      createdAt: new Date(),
      approvedAt: new Date(),
      critique: {
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
        mustFix: ['Fix grammar in paragraph 2'],
        suggestions: ['Consider adding more dialogue'],
        createdAt: new Date()
      },
      revisions: []
    },
    {
      id: 'chapter-2',
      number: 2,
      title: 'Chapter 2: The Journey',
      content: 'Test content for chapter 2 with more words to have a decent word count.',
      wordCount: 15,
      status: 'approved',
      createdAt: new Date(),
      approvedAt: new Date(),
      revisions: []
    }
  ];

  beforeEach(async () => {
    const bookStateSpy = jasmine.createSpyObj('BookStateService', ['getChapters$', 'getState']);
    bookStateSpy.getChapters$.and.returnValue(of(mockChapters));
    bookStateSpy.getState.and.returnValue({
      chapters: mockChapters,
      characterStore: {},
      worldStateDoc: null,
      status: 'completed',
      activeAgent: null,
      blueprint: null,
      currentDraft: null,
      critique: null,
      revisionCount: 0,
      config: null,
      error: null,
      continuityFlags: []
    });

    const translationSpy = jasmine.createSpyObj('TranslationService', ['get']);
    translationSpy.get.and.callFake((key: string) => key);

    TestBed.configureTestingModule({
      providers: [
        ChapterViewComponent,
        { provide: BookStateService, useValue: bookStateSpy },
        { provide: TranslationService, useValue: translationSpy }
      ]
    });

    component = TestBed.inject(ChapterViewComponent);
    bookStateServiceSpy = TestBed.inject(BookStateService) as jasmine.SpyObj<BookStateService>;
    translationServiceSpy = TestBed.inject(TranslationService) as jasmine.SpyObj<TranslationService>;
  });

  describe('Component Initialization', () => {
    it('should be created', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize chapters observable', () => {
      expect(component.chapters$).toBeDefined();
    });

    it('should initialize selectedChapter as null', () => {
      expect(component.selectedChapter).toBeNull();
    });

    it('should initialize selectedChapterIndex as 0', () => {
      expect(component.selectedChapterIndex).toBe(0);
    });
  });

  describe('selectChapter', () => {
    it('should set selected chapter', () => {
      component.selectChapter(mockChapters[0], 0);
      expect(component.selectedChapter).toEqual(mockChapters[0]);
    });

    it('should set selected chapter index', () => {
      component.selectChapter(mockChapters[1], 1);
      expect(component.selectedChapterIndex).toBe(1);
    });
  });

  describe('nextChapter', () => {
    it('should move to next chapter', (done) => {
      component.selectedChapter = mockChapters[0];
      component.selectedChapterIndex = 0;

      component.nextChapter();
      
      // Subscribe to the observable to complete the test
      setTimeout(() => {
        expect(component.selectedChapterIndex).toBe(1);
        done();
      }, 10);
    });

    it('should not go past last chapter', (done) => {
      component.selectedChapter = mockChapters[1];
      component.selectedChapterIndex = 1;

      component.nextChapter();
      
      setTimeout(() => {
        expect(component.selectedChapterIndex).toBe(1);
        done();
      }, 10);
    });
  });

  describe('prevChapter', () => {
    it('should move to previous chapter', () => {
      component.selectedChapter = mockChapters[1];
      component.selectedChapterIndex = 1;

      component.prevChapter();

      expect(component.selectedChapterIndex).toBe(0);
    });

    it('should not go before first chapter', () => {
      component.selectedChapterIndex = 0;

      component.prevChapter();

      expect(component.selectedChapterIndex).toBe(0);
    });
  });

  describe('getChapterScore', () => {
    it('should return chapter critique score', () => {
      const score = component.getChapterScore(mockChapters[0]);
      expect(score).toBe(7.7);
    });

    it('should return 0 when no critique', () => {
      const score = component.getChapterScore(mockChapters[1]);
      expect(score).toBe(0);
    });
  });

  describe('getScoreColor', () => {
    it('should return green for score >= 8', () => {
      const color = component.getScoreColor(8);
      expect(color).toContain('text-green-600');
    });

    it('should return yellow for score >= 6 and < 8', () => {
      const color = component.getScoreColor(7);
      expect(color).toContain('text-yellow-600');
    });

    it('should return red for score < 6', () => {
      const color = component.getScoreColor(5);
      expect(color).toContain('text-red-600');
    });

    it('should return green for dark mode score >= 8', () => {
      const color = component.getScoreColor(9);
      expect(color).toContain('text-green-400');
    });
  });

  describe('formatScore', () => {
    it('should format score with one decimal place', () => {
      const formatted = component.formatScore(7.7);
      expect(formatted).toBe('7.7');
    });

    it('should format whole number score with decimal', () => {
      const formatted = component.formatScore(8);
      expect(formatted).toBe('8.0');
    });
  });

  describe('Critique Helpers', () => {
    beforeEach(() => {
      component.selectedChapter = mockChapters[0];
    });

    describe('getProseScore', () => {
      it('should return prose score from critique', () => {
        expect(component.getProseScore()).toBe(8);
      });

      it('should return 0 when no critique', () => {
        component.selectedChapter = mockChapters[1];
        expect(component.getProseScore()).toBe(0);
      });
    });

    describe('getPacingScore', () => {
      it('should return pacing score from critique', () => {
        expect(component.getPacingScore()).toBe(7);
      });

      it('should return 0 when no critique', () => {
        component.selectedChapter = mockChapters[1];
        expect(component.getPacingScore()).toBe(0);
      });
    });

    describe('getDialogueScore', () => {
      it('should return dialogue score from critique', () => {
        expect(component.getDialogueScore()).toBe(7);
      });

      it('should return 0 when no critique', () => {
        component.selectedChapter = mockChapters[1];
        expect(component.getDialogueScore()).toBe(0);
      });
    });

    describe('getFeedback', () => {
      it('should return feedback from critique', () => {
        expect(component.getFeedback()).toBe('Good chapter overall.');
      });

      it('should return empty string when no critique', () => {
        component.selectedChapter = mockChapters[1];
        expect(component.getFeedback()).toBe('');
      });
    });

    describe('getMustFix', () => {
      it('should return mustFix items from critique', () => {
        const mustFix = component.getMustFix();
        expect(mustFix.length).toBe(1);
        expect(mustFix[0]).toBe('Fix grammar in paragraph 2');
      });

      it('should return empty array when no critique', () => {
        component.selectedChapter = mockChapters[1];
        expect(component.getMustFix().length).toBe(0);
      });
    });

    describe('getSuggestions', () => {
      it('should return suggestions from critique', () => {
        const suggestions = component.getSuggestions();
        expect(suggestions.length).toBe(1);
        expect(suggestions[0]).toBe('Consider adding more dialogue');
      });

      it('should return empty array when no critique', () => {
        component.selectedChapter = mockChapters[1];
        expect(component.getSuggestions().length).toBe(0);
      });
    });

    describe('hasCritique', () => {
      it('should return true when chapter has critique', () => {
        expect(component.hasCritique()).toBe(true);
      });

      it('should return false when chapter has no critique', () => {
        component.selectedChapter = mockChapters[1];
        expect(component.hasCritique()).toBe(false);
      });
    });
  });

  describe('Translation Helper', () => {
    it('should call translationService.get', () => {
      component.t('test.key');
      expect(translationServiceSpy.get).toHaveBeenCalledWith('test.key');
    });
  });
});
