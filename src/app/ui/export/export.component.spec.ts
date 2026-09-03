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
    translateBookMetadataTo$: (config: any) => of(config),
    translateCritiqueTo$: (critique: any) => of(critique)
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
    // The export now translates the book into the target language
    // before generating the file. We assert that:
    //   - the export calls translateBookTo$ when target !== 'en'
    //   - it skips the translation step when target === 'en'
    //   - the per-chapter critique translator is still used (the
    //     book-level helper delegates to it)
    // by capturing the markdown body the component ships to the
    // download (it goes through generateMarkdown ->
    // buildBookContent which inlines the critique feedback into
    // the text).

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

  describe('Critique rendering (regression: still works after the Polish pass removal)', () => {
    it('renders the critique in the exported file when includeCritiques is true', async () => {
      // The orchestrator now never writes Polish to the critique
      // (it stores English), so the export component should ship
      // the source critique text directly into the markdown.
      (mockTranslation as any).exportLanguage = () => 'en';
      component.exportLanguage = 'en';
      const translateBookSpy = spyOn(mockTranslation as any, 'translateBookTo$')
        .and.callFake((chapters: any[]) => of(chapters));

      const englishChapter = {
        number: 1,
        title: 'Chapter 1',
        content: 'Body.',
        critique: {
          scores: { prose: 8, pacing: 7, showVsTell: 8, dialogue: 7, continuity: 8, hookStrength: 7, thematicResonance: 8 },
          overallScore: 7.7,
          feedback: 'Solid chapter.',
          mustFix: ['tighten paragraph 2'],
          suggestions: ['vary sentence length'],
          createdAt: new Date()
        }
      };
      chaptersSubject.next([englishChapter]);
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

      component.exportOptions = {
        includeTitles: true,
        includeTOC: false,
        includeCritiques: true,
        includeCharacters: false,
        includeIllustrations: false,
        illustrationStyle: 'auto'
      };
      component.setFormat('markdown');

      await component.exportBook();

      // English export — no book-level translation step.
      expect(translateBookSpy).not.toHaveBeenCalled();
      // The critique feedback made it into the file. The
      // markdown builder only inlines the `feedback` field
      // (mustFix / suggestions are not part of the exported
      // markdown), so we assert on feedback only.
      expect(capturedBody).toContain('Solid chapter.');
      expect(capturedBody).toContain('## Critique Report');
    });
  });
});
