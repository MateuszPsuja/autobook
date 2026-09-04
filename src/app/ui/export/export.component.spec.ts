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
    // The real TranslationService exposes a `Signal<ExportLanguage>`
    // here. Tests read it through component.exportLanguage directly
    // (which the component seeds from the signal in ngOnInit), or
    // they override the per-test mock field below.
    exportLanguage: (() => 'en') as any,
    setExportLanguage: () => {},
    translateBookTo$: (chapters: any[]) => of(chapters),
    translateBookMetadataTo$: (config: any) => of(config)
  } as unknown as Partial<TranslationService>;

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

  it('returns export button text containing the format', () => {
    component.selectedFormat = 'pdf';
    const text = component.getExportButtonText();
    expect(text).toContain('Export');
    expect(text).toContain('PDF');
  });

  describe('Export target language', () => {
    it('defaults to English so a fresh client skips the LLM translation pass', () => {
      expect(component.exportLanguage).toBe('en');
      expect(component.willTranslate()).toBeFalse();
    });

    it('setExportLanguage updates the property and forwards to the translation service', () => {
      const setSpy = spyOn(mockTranslation as any, 'setExportLanguage');
      component.setExportLanguage('fr');
      expect(component.exportLanguage).toBe('fr');
      expect(setSpy).toHaveBeenCalledWith('fr');
      expect(component.willTranslate()).toBeTrue();
    });
  });

  describe('Multi-language export', () => {
    // The export translates the book into the target language
    // before generating the file. We assert that:
    //   - the export calls translateBookTo$ when target !== 'en'
    //   - it skips the translation step when target === 'en'
    // by capturing the markdown body the component ships to the
    // download (it goes through generateMarkdown ->
    // buildBookContent).

    it('skips the LLM translation pass entirely when target is English', async () => {
      (mockTranslation as any).exportLanguage = () => 'en';
      component.exportLanguage = 'en';
      const translateBookSpy = spyOn(mockTranslation as any, 'translateBookTo$')
        .and.callFake((chapters: any[]) => of(chapters));

      chaptersSubject.next([
        {
          number: 1,
          title: 'Chapter 1: The Beginning',
          content: 'Original English body.'
        }
      ]);
      fixture.detectChanges();

      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(document.body, 'appendChild').and.stub();
      spyOn(document.body, 'removeChild').and.stub();
      spyOn(HTMLAnchorElement.prototype, 'click').and.stub();

      component.setFormat('markdown');
      await component.exportBook();

      expect(translateBookSpy).not.toHaveBeenCalled();
    });

    it('calls translateBookTo$ when target is non-English and pipes the translated chapters into the file', async () => {
      (mockTranslation as any).exportLanguage = () => 'pl';
      component.exportLanguage = 'pl';
      const translated = [{
        number: 1,
        title: 'Rozdział 1: Początek',
        content: 'Przetłumaczona treść.'
      }];
      const translateBookSpy = spyOn(mockTranslation as any, 'translateBookTo$')
        .and.callFake(() => of(translated));

      chaptersSubject.next([
        { number: 1, title: 'Chapter 1: The Beginning', content: 'Original English body.' }
      ]);
      fixture.detectChanges();

      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(document.body, 'appendChild').and.stub();
      spyOn(document.body, 'removeChild').and.stub();
      spyOn(HTMLAnchorElement.prototype, 'click').and.stub();

      let capturedBody = '';
      spyOn(component, 'generateMarkdown' as any).and.callFake((ch: any[]) => {
        capturedBody = (component as any).buildBookContent(ch);
        return new Blob([capturedBody], { type: 'text/markdown' });
      });

      component.setFormat('markdown');
      await component.exportBook();

      // The translation helper was invoked with the user's target
      // language and the source chapters.
      expect(translateBookSpy).toHaveBeenCalledTimes(1);
      const [passedChapters, passedTarget, passedWord] = translateBookSpy.calls.mostRecent().args as [any[], string, string];
      expect(passedChapters[0].number).toBe(1);
      expect(passedTarget).toBe('pl');
      // The localised "Chapter" word for the target language is
      // passed so the title translator can rebuild the
      // "Rozdział N: …" header.
      expect(passedWord).toBe('Rozdział');
      // The exported body contains the Polish title, not the
      // English original.
      expect(capturedBody).toContain('Rozdział 1: Początek');
      expect(capturedBody).toContain('Przetłumaczona treść.');
      expect(capturedBody).not.toContain('Chapter 1: The Beginning');
    });
  });
});
