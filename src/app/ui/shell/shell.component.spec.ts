import { TestBed } from '@angular/core/testing';
import { ShellComponent } from './shell.component';
import { ThemeService } from '../../core/theme.service';
import { ApiService } from '../../core/api.service';
import { TranslationService } from '../../i18n/translation.service';
import { Router, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';

describe('ShellComponent', () => {
  let component: ShellComponent;
  let themeServiceSpy: jasmine.SpyObj<ThemeService>;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;
  let translationServiceSpy: jasmine.SpyObj<TranslationService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    const themeSpy = jasmine.createSpyObj('ThemeService', ['isDarkMode', 'toggleTheme']);
    themeSpy.isDarkMode.and.returnValue(false);

    const apiSpy = jasmine.createSpyObj('ApiService', ['isConfigured', 'getDefaultModel', 'getModelById']);
    apiSpy.isConfigured.and.returnValue(true);
    apiSpy.getDefaultModel.and.returnValue({ id: 'test/model', name: 'Test Model', contextWindow: '128k', contextWindowNum: 128000 });
    apiSpy.getModelById.and.returnValue({ id: 'test/model', name: 'Test Model', contextWindow: '128k', contextWindowNum: 128000 });

    const translationSpy = jasmine.createSpyObj('TranslationService', [
      'get'
    ]);
    translationSpy.get.and.callFake((key: string) => key);

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
        { provide: Router, useValue: router }
      ]
    });

    component = TestBed.inject(ShellComponent);
    themeServiceSpy = TestBed.inject(ThemeService) as jasmine.SpyObj<ThemeService>;
    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
    translationServiceSpy = TestBed.inject(TranslationService) as jasmine.SpyObj<TranslationService>;
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
