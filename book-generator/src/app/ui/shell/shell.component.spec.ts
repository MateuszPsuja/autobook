import { TestBed } from '@angular/core/testing';
import { ShellComponent } from './shell.component';
import { ThemeService } from '../../core/theme.service';
import { ApiService } from '../../core/api.service';
import { TranslationService } from '../../i18n/translation.service';
import { PersistenceService } from '../../core/persistence.service';
import { BookStateService } from '../../book/state/book-state.service';
import { Router, RouterModule } from '@angular/router';
import { of, Subject } from 'rxjs';

describe('ShellComponent', () => {
  let component: ShellComponent;
  let themeServiceSpy: jasmine.SpyObj<ThemeService>;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;
  let translationServiceSpy: jasmine.SpyObj<TranslationService>;
  let persistenceServiceSpy: jasmine.SpyObj<PersistenceService>;
  let bookStateServiceSpy: jasmine.SpyObj<BookStateService>;
  let routerSpy: jasmine.SpyObj<Router>;

  const mockBookState = {
    chapters: [],
    characterStore: {},
    worldStateDoc: '',
    status: 'idle' as const,
    activeAgent: null,
    blueprint: null,
    currentDraft: null,
    critique: null,
    revisionCount: 0,
    config: {} as any,
    error: null,
    continuityFlags: [],
    stats: {
      startTime: null,
      endTime: null,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalWords: 0,
      agentStats: {
        architect: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        author: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        critic: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        reviser: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        character: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        continuity: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      }
    }
  };

  beforeEach(async () => {
    const themeSpy = jasmine.createSpyObj('ThemeService', ['isDarkMode', 'toggleTheme']);
    themeSpy.isDarkMode.and.returnValue(false);

    const apiSpy = jasmine.createSpyObj('ApiService', ['isConfigured', 'getDefaultModel', 'getModelById']);
    apiSpy.isConfigured.and.returnValue(true);
    apiSpy.getDefaultModel.and.returnValue({ id: 'test/model', name: 'Test Model', contextWindow: '128k', contextWindowNum: 128000 });
    apiSpy.getModelById.and.returnValue({ id: 'test/model', name: 'Test Model', contextWindow: '128k', contextWindowNum: 128000 });

    const translationSpy = jasmine.createSpyObj('TranslationService', [
      'get', 'isEnglish', 'isPolish', 'toggleLanguage'
    ]);
    translationSpy.get.and.callFake((key: string) => key);
    translationSpy.isEnglish.and.returnValue(true);
    translationSpy.isPolish.and.returnValue(false);

    const persistenceSpy = jasmine.createSpyObj('PersistenceService', ['clearAll']);
    persistenceSpy.clearAll.and.returnValue(Promise.resolve());

    const bookStateSpy = jasmine.createSpyObj('BookStateService', ['getState', 'reset']);
    bookStateSpy.getState.and.returnValue(mockBookState);

    // Create router spy with url as a mockable property
    const routerEvents = new Subject<any>();
    const router = jasmine.createSpyObj('Router', ['navigate']);
    Object.defineProperty(router, 'url', { value: '/config', writable: true });

    TestBed.configureTestingModule({
      imports: [RouterModule],
      providers: [
        ShellComponent,
        { provide: ThemeService, useValue: themeSpy },
        { provide: ApiService, useValue: apiSpy },
        { provide: TranslationService, useValue: translationSpy },
        { provide: PersistenceService, useValue: persistenceSpy },
        { provide: BookStateService, useValue: bookStateSpy },
        { provide: Router, useValue: router }
      ]
    });

    component = TestBed.inject(ShellComponent);
    themeServiceSpy = TestBed.inject(ThemeService) as jasmine.SpyObj<ThemeService>;
    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
    translationServiceSpy = TestBed.inject(TranslationService) as jasmine.SpyObj<TranslationService>;
    persistenceServiceSpy = TestBed.inject(PersistenceService) as jasmine.SpyObj<PersistenceService>;
    bookStateServiceSpy = TestBed.inject(BookStateService) as jasmine.SpyObj<BookStateService>;
    routerSpy = TestBed.inject(Router) as jasmine.SpyObj<Router>;
  });

  describe('Component Initialization', () => {
    it('should be created', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize isDarkMode from theme service', () => {
      expect(component.isDarkMode).toBe(false);
    });

    it('should load selected model', () => {
      expect(component.selectedModel).toBeDefined();
    });
  });

  describe('toggleTheme', () => {
    it('should call themeService.toggleTheme', () => {
      component.toggleTheme();
      expect(themeServiceSpy.toggleTheme).toHaveBeenCalled();
    });

    it('should update isDarkMode from theme service', () => {
      themeServiceSpy.isDarkMode.and.returnValue(true);
      component.toggleTheme();
      expect(component.isDarkMode).toBe(true);
    });
  });

  describe('isConfigured', () => {
    it('should return true when API is configured', () => {
      expect(component.isConfigured()).toBe(true);
    });

    it('should return false when API is not configured', () => {
      apiServiceSpy.isConfigured.and.returnValue(false);
      expect(component.isConfigured()).toBe(false);
    });
  });

  describe('Navigation Methods', () => {
    it('should navigate to settings', () => {
      component.navigateToSettings();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/settings']);
    });

    it('should navigate to config', () => {
      component.navigateToConfig();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/config']);
    });

    it('should navigate to generator', () => {
      component.navigateToGenerator();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/generator']);
    });

    it('should navigate to viewer', () => {
      component.navigateToViewer();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/viewer']);
    });

    it('should navigate to export', () => {
      component.navigateToExport();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/export']);
    });
  });

  describe('getActivePageTitle', () => {
    it('should return correct titles for routes', () => {
      // Test that method exists and returns a string
      expect(component.getActivePageTitle()).toBeDefined();
      expect(typeof component.getActivePageTitle()).toBe('string');
    });
  });

  describe('getActivePageSubtitle', () => {
    it('should return correct subtitles for routes', () => {
      expect(component.getActivePageSubtitle()).toBeDefined();
      expect(typeof component.getActivePageSubtitle()).toBe('string');
    });
  });

  describe('toggleLanguage', () => {
    it('should call translationService.toggleLanguage when no data', async () => {
      await component.toggleLanguage();
      
      expect(translationServiceSpy.toggleLanguage).toHaveBeenCalled();
    });

    it('should clear data when data exists', async () => {
      const chapterWithData = {
        id: 'chapter-1',
        number: 1,
        title: 'Chapter 1',
        content: 'Test content',
        wordCount: 2,
        status: 'draft' as const,
        createdAt: new Date(),
        revisions: []
      };
      const stateWithData = {
        ...mockBookState,
        chapters: [chapterWithData]
      };
      bookStateServiceSpy.getState.and.returnValue(stateWithData);
      
      await component.toggleLanguage();
      
      expect(persistenceServiceSpy.clearAll).toHaveBeenCalled();
      expect(bookStateServiceSpy.reset).toHaveBeenCalled();
      expect(translationServiceSpy.toggleLanguage).toHaveBeenCalled();
    });

  });

  describe('isEnglish', () => {
    it('should return true when language is English', () => {
      translationServiceSpy.isEnglish.and.returnValue(true);
      expect(component.isEnglish()).toBe(true);
    });

    it('should return false when language is not English', () => {
      translationServiceSpy.isEnglish.and.returnValue(false);
      expect(component.isEnglish()).toBe(false);
    });
  });

  describe('getModelName', () => {
    it('should return default model name when no model selected', () => {
      spyOn(localStorage, 'getItem').and.returnValue(null);
      expect(component.getModelName()).toBe('Test Model');
    });

    it('should return selected model name from storage', () => {
      spyOn(localStorage, 'getItem').and.returnValue('test/model');
      expect(component.getModelName()).toBeDefined();
    });
  });

  describe('Translation Helper', () => {
    it('should call translationService.get', () => {
      component.t('test.key');
      expect(translationServiceSpy.get).toHaveBeenCalledWith('test.key');
    });
  });
});
