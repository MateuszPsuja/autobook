import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, of } from 'rxjs';
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
    translateBookToPolish: async (chapters: any[]) => chapters,
    translateCritiqueToPolish$: (critique: any) => of(critique)
  } as Partial<TranslationService>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule, ExportComponent],
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

  describe('Polish export with critiques', () => {
    // The export must call the critique translator for every chapter
    // that has a critique when language is Polish, and pass the
    // translated feedback into the markdown / PDF / EPUB / DOCX
    // builders. We assert that by capturing the markdown body the
    // component ships to the download (it goes through
    // generateMarkdown -> buildBookContent which inlines the
    // critique feedback into the text).
    it('translates critique feedback when isPolish is true and chapter has a critique', async () => {
      // Override the isPolish flag and the translator spy for this test.
      (mockTranslation as any).isPolish = () => true;
      const plCritique = {
        scores: { prose: 8, pacing: 7, showVsTell: 8, dialogue: 7, continuity: 8, hookStrength: 7, thematicResonance: 8 },
        overallScore: 7.7,
        feedback: 'PL: Solid chapter.',
        mustFix: ['PL: tighten paragraph 2'],
        suggestions: ['PL: vary sentence length'],
        createdAt: new Date()
      };
      const translateCritiqueSpy = spyOn(mockTranslation as any, 'translateCritiqueToPolish$')
        .and.callFake(() => of(plCritique));

      chaptersSubject.next([
        {
          number: 1,
          title: 'Chapter 1',
          content: 'Original English body.',
          critique: {
            scores: { prose: 8, pacing: 7, showVsTell: 8, dialogue: 7, continuity: 8, hookStrength: 7, thematicResonance: 8 },
            overallScore: 7.7,
            feedback: 'Solid chapter.',
            mustFix: ['tighten paragraph 2'],
            suggestions: ['vary sentence length'],
            createdAt: new Date()
          }
        }
      ]);
      fixture.detectChanges();

      // exportBook opens a download — stub URL.createObjectURL so the
      // jsdom environment doesn't blow up, and stub anchor.click.
      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
      const appendChildSpy = spyOn(document.body, 'appendChild').and.stub();
      spyOn(document.body, 'removeChild').and.stub();
      spyOn(HTMLAnchorElement.prototype, 'click').and.stub();

      // Capture the markdown body so we can assert the translated
      // critique feedback was actually written into the export.
      let capturedBody = '';
      spyOn(component, 'generateMarkdown' as any).and.callFake((ch: any[]) => {
        capturedBody = (component as any).buildBookContent(ch);
        return new Blob([capturedBody], { type: 'text/markdown' });
      });

      // Make sure critiques are included in the export options so
      // buildBookContent emits the critique block.
      component.exportOptions = {
        includeTitles: true,
        includeTOC: false,
        includeCritiques: true,
        includeCharacters: false
      };
      component.setFormat('markdown');

      await component.exportBook();

      // Translator invoked for the single chapter that had a critique.
      expect(translateCritiqueSpy).toHaveBeenCalledTimes(1);
      // The exported markdown body should now contain the Polish
      // feedback, prefixed with the localized "Informacja Zwrotna:"
      // label. The raw English feedback should not appear in the
      // rendered critique block.
      expect(capturedBody).toContain('PL: Solid chapter.');
      expect(capturedBody).toMatch(/\*\*Informacja Zwrotna:\*\*\s*PL: Solid chapter\./);

      expect(appendChildSpy).toHaveBeenCalled();

      // Restore isPolish for any later tests in the suite.
      (mockTranslation as any).isPolish = () => false;
    });

    it('skips critique translation when a chapter has no critique', async () => {
      (mockTranslation as any).isPolish = () => true;
      const translateCritiqueSpy = spyOn(mockTranslation as any, 'translateCritiqueToPolish$')
        .and.callFake(() => of(null));

      chaptersSubject.next([
        { number: 1, title: 'Chapter 1', content: 'Body without critique.' }
      ]);
      fixture.detectChanges();

      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(document.body, 'appendChild').and.stub();
      spyOn(document.body, 'removeChild').and.stub();
      spyOn(HTMLAnchorElement.prototype, 'click').and.stub();

      component.exportOptions = {
        includeTitles: true,
        includeTOC: false,
        includeCritiques: true,
        includeCharacters: false
      };
      component.setFormat('markdown');

      await component.exportBook();

      // No critique → no call to the translator.
      expect(translateCritiqueSpy).not.toHaveBeenCalled();

      (mockTranslation as any).isPolish = () => false;
    });
  });
});
