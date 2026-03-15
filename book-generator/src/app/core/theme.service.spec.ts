import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ThemeService]
    });
    service = TestBed.inject(ThemeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should have isDarkMode method', () => {
    expect(typeof service.isDarkMode).toBe('function');
  });

  it('should have toggleTheme method', () => {
    expect(typeof service.toggleTheme).toBe('function');
  });
});
