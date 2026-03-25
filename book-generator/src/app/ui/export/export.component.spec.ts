import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { ExportComponent } from './export.component';
import { BookStateService } from '../../book/state/book-state.service';
import { PersistenceService } from '../../core/persistence.service';
import { TranslationService } from '../../i18n/translation.service';

describe('ExportComponent', () => {
  let component: ExportComponent;
  let fixture: ComponentFixture<ExportComponent>;

  const chaptersSubject = new BehaviorSubject<any[]>([]);

  const mockBookState = {
    getChapters$: () => chaptersSubject.asObservable(),
    getState: () => ({ config: { title: 'Test Book' }, chapters: chaptersSubject.value })
  } as Partial<BookStateService>;

  const mockPersistence = {} as Partial<PersistenceService>;

  const mockTranslation = {
    get: (key: string) => {
      const map: Record<string, string> = {
        'export.export': 'Export',
        'export.exporting': 'Exporting'
      };
      return map[key] ?? key;
    },
    isPolish: () => false,
    translateBookToPolish: async (chapters: any[]) => chapters
  } as Partial<TranslationService>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [ExportComponent],
      providers: [
        { provide: BookStateService, useValue: mockBookState },
        { provide: PersistenceService, useValue: mockPersistence },
        { provide: TranslationService, useValue: mockTranslation }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('reports chapter count from service', () => {
    chaptersSubject.next([
      { number: 1, title: 'One', content: 'A' },
      { number: 2, title: 'Two', content: 'B' }
    ]);
    fixture.detectChanges();
    expect(component.getChapterCount()).toBe(2);
  });

  it('changes format with setFormat', () => {
    component.setFormat('epub');
    expect(component.selectedFormat).toBe('epub');
  });

  it('returns export button text containing translation and format', () => {
    component.selectedFormat = 'pdf';
    const text = component.getExportButtonText();
    expect(text).toContain('Export');
    expect(text).toContain('PDF');
  });
});
