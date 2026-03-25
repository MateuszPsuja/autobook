import { TestBed } from '@angular/core/testing';
import { TranslationService, Language } from './translation.service';
import { ApiService } from '../core/api.service';

describe('TranslationService', () => {
  let service: TranslationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TranslationService,
        ApiService
      ]
    });
    service = TestBed.inject(TranslationService);
    // Clear localStorage before each test
    localStorage.removeItem('app-language');
  });

  describe('Initial State', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should have default language', () => {
      expect(service.language()).toBeDefined();
    });

    it('should expose isEnglish computed signal', () => {
      expect(service.isEnglish).toBeDefined();
      expect(typeof service.isEnglish()).toBe('boolean');
    });

    it('should expose isPolish computed signal', () => {
      expect(service.isPolish).toBeDefined();
      expect(typeof service.isPolish()).toBe('boolean');
    });
  });

  describe('Language Switching', () => {
    it('should set language to English', () => {
      service.setLanguage('en');
      expect(service.language()).toBe('en');
      expect(service.isEnglish()).toBeTrue();
      expect(service.isPolish()).toBeFalse();
    });

    it('should set language to Polish', () => {
      service.setLanguage('pl');
      expect(service.language()).toBe('pl');
      expect(service.isPolish()).toBeTrue();
      expect(service.isEnglish()).toBeFalse();
    });

    it('should toggle language from English to Polish', () => {
      service.setLanguage('en');
      service.toggleLanguage();
      expect(service.language()).toBe('pl');
    });

    it('should toggle language from Polish to English', () => {
      service.setLanguage('pl');
      service.toggleLanguage();
      expect(service.language()).toBe('en');
    });
  });

  describe('Translation Retrieval', () => {
    it('should get translation for known key', () => {
      const result = service.get('app.title');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should return key when translation not found', () => {
      const result = service.get('nonexistent.key');
      expect(result).toBe('nonexistent.key');
    });

    it('should get translation array for known key', () => {
      const result = service.getArray('genres');
      expect(Array.isArray(result)).toBeTrue();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return empty array for nonexistent array key', () => {
      const result = service.getArray('nonexistent');
      expect(Array.isArray(result)).toBeTrue();
      expect(result.length).toBe(0);
    });
  });

  describe('Dropdown Translations (Polish to English)', () => {
    it('should translate genre from Polish to English', () => {
      const result = service.translateDropdownToEnglish('genres', 'Fantastyka');
      expect(result).toBe('Fantasy');
    });

    it('should return original value if no mapping exists', () => {
      const result = service.translateDropdownToEnglish('genres', 'Unknown Genre');
      expect(result).toBe('Unknown Genre');
    });

    it('should return empty string for empty input', () => {
      const result = service.translateDropdownToEnglish('genres', '');
      expect(result).toBe('');
    });

    it('should translate writing style from Polish to English', () => {
      const result = service.translateDropdownToEnglish('writingStyles', 'Opisowy');
      expect(result).toBe('Descriptive');
    });

    it('should translate tone from Polish to English', () => {
      const result = service.translateDropdownToEnglish('tones', 'Mroczny');
      expect(result).toBe('Dark');
    });
  });

  describe('Dropdown Translations (English to Polish)', () => {
    it('should translate genre from English to Polish', () => {
      const result = service.translateDropdownToPolish('genres', 'Fantasy');
      expect(result).toBe('Fantastyka');
    });

    it('should return original value if no mapping exists', () => {
      const result = service.translateDropdownToPolish('genres', 'Unknown Genre');
      expect(result).toBe('Unknown Genre');
    });

    it('should return empty string for empty input', () => {
      const result = service.translateDropdownToPolish('genres', '');
      expect(result).toBe('');
    });

    it('should translate writing style from English to Polish', () => {
      const result = service.translateDropdownToPolish('writingStyles', 'Descriptive');
      expect(result).toBe('Opisowy');
    });
  });
});
