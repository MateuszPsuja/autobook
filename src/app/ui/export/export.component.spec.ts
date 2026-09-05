import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, of } from 'rxjs';
import { ExportComponent } from './export.component';
import { BookStateService } from '../../book/state/book-state.service';
import { PersistenceService } from '../../core/persistence.service';
import { TranslationService } from '../../i18n/translation.service';
import { IllustrationService } from '../../core/providers/illustration.service';
import { ProviderService } from '../../core/providers/provider.service';
import { BookCoverArt, ChapterIllustration } from '../../core/providers/illustration.types';

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
    exportLanguage: (() => 'en') as any,
    setExportLanguage: () => {},
    translateBookTo$: (chapters: any[]) => of(chapters),
    translateBookMetadataTo$: (config: any) => of(config)
  } as unknown as Partial<TranslationService>;

  const mockIllustration = {
    generateAll$: (_req: any) => of({
      chapterIllustrations: new Map<string, ChapterIllustration>(),
      coverArt: undefined as BookCoverArt | undefined,
      backCoverArt: undefined as BookCoverArt | undefined,
      totalCalls: 0,
      completedCalls: 0,
    }),
  } as Partial<IllustrationService>;

  const mockProvider = {
    getActiveProviderId: () => 'minimax',
    getApiKey: () => 'sk-test',
    getBaseUrl: () => 'https://api.example.com/v1',
  } as Partial<ProviderService>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule, ExportComponent],
      providers: [
        { provide: BookStateService, useValue: mockBookState },
        { provide: PersistenceService, useValue: mockPersistence },
        { provide: TranslationService, useValue: mockTranslation },
        { provide: IllustrationService, useValue: mockIllustration },
        { provide: ProviderService, useValue: mockProvider },
      ],
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
    it('skips the LLM translation pass entirely when target is English', async () => {
      (mockTranslation as any).exportLanguage = () => 'en';
      component.exportLanguage = 'en';
      const translateBookSpy = spyOn(mockTranslation as any, 'translateBookTo$')
        .and.callFake((chapters: any[]) => of(chapters));

      chaptersSubject.next([
        { number: 1, title: 'Chapter 1: The Beginning', content: 'Original English body.' }
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
        number: 1, title: 'Rozdział 1: Początek', content: 'Przetłumaczona treść.'
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

      expect(translateBookSpy).toHaveBeenCalledTimes(1);
      const [passedChapters, passedTarget, passedWord] = translateBookSpy.calls.mostRecent().args as [any[], string, string];
      expect(passedChapters[0].number).toBe(1);
      expect(passedTarget).toBe('pl');
      expect(passedWord).toBe('Rozdział');
      expect(capturedBody).toContain('Rozdział 1: Początek');
      expect(capturedBody).toContain('Przetłumaczona treść.');
      expect(capturedBody).not.toContain('Chapter 1: The Beginning');
    });
  });

  describe('EPUB export', () => {
    it('calls illustrationService.generateAll$ when EPUB + includeIllustrations + minimax', async () => {
      const illSpy = spyOn(mockIllustration as any, 'generateAll$').and.callThrough();

      chaptersSubject.next([{ id: 'c1', number: 1, title: 'A', content: 'A' }]);
      component.selectedFormat = 'epub';
      component.exportOptions.includeIllustrations = true;

      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(document.body, 'appendChild').and.stub();
      spyOn(document.body, 'removeChild').and.stub();
      spyOn(HTMLAnchorElement.prototype, 'click').and.stub();

      await component.exportBook();
      expect(illSpy).toHaveBeenCalled();
    });

    it('produces a Blob with type application/epub+zip from the new builder', async () => {
      chaptersSubject.next([{ id: 'c1', number: 1, title: 'A', content: 'A' }]);
      component.selectedFormat = 'epub';
      component.exportOptions.includeIllustrations = false;
      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(document.body, 'appendChild').and.stub();
      spyOn(document.body, 'removeChild').and.stub();
      spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
      const blob = await (component as any).generateEPUB(
        [{ id: 'c1', number: 1, title: 'A', content: 'A' }],
        undefined,
        undefined,
      );
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/epub+zip');
      // The first 4 bytes are "PK\x03\x04" — the ZIP local file
      // header signature. Confirms this is a real ZIP, not just a
      // Blob with a misleading MIME type.
      const buf = new Uint8Array(await blob.arrayBuffer());
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
      expect(buf[2]).toBe(0x03);
      expect(buf[3]).toBe(0x04);
    });

    it('does NOT call illustrationService when includeIllustrations is off (even if minimax)', async () => {
      const illSpy = spyOn(mockIllustration as any, 'generateAll$').and.callThrough();
      chaptersSubject.next([{ id: 'c1', number: 1, title: 'A', content: 'A' }]);
      component.selectedFormat = 'epub';
      component.exportOptions.includeIllustrations = false;
      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(document.body, 'appendChild').and.stub();
      spyOn(document.body, 'removeChild').and.stub();
      spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
      await component.exportBook();
      expect(illSpy).not.toHaveBeenCalled();
    });
  });

  describe('DOCX export', () => {
    it('calls illustrationService.generateAll$ when DOCX + includeIllustrations + minimax', async () => {
      const illSpy = spyOn(mockIllustration as any, 'generateAll$').and.callThrough();

      chaptersSubject.next([{ id: 'c1', number: 1, title: 'A', content: 'A' }]);
      component.selectedFormat = 'docx';
      component.exportOptions.includeIllustrations = true;

      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(document.body, 'appendChild').and.stub();
      spyOn(document.body, 'removeChild').and.stub();
      spyOn(HTMLAnchorElement.prototype, 'click').and.stub();

      await component.exportBook();
      expect(illSpy).toHaveBeenCalled();
    });

    it('produces a real DOCX Blob (PK header + correct MIME)', async () => {
      chaptersSubject.next([{ id: 'c1', number: 1, title: 'A', content: 'A' }]);
      component.selectedFormat = 'docx';
      component.exportOptions.includeIllustrations = false;
      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(document.body, 'appendChild').and.stub();
      spyOn(document.body, 'removeChild').and.stub();
      spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
      const blob = await (component as any).generateDOCX(
        [{ id: 'c1', number: 1, title: 'A', content: 'A' }],
        undefined,
        undefined,
      );
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const buf = new Uint8Array(await blob.arrayBuffer());
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
      expect(buf[2]).toBe(0x03);
      expect(buf[3]).toBe(0x04);
    });

    it('does NOT call illustrationService when includeIllustrations is off (even if minimax)', async () => {
      const illSpy = spyOn(mockIllustration as any, 'generateAll$').and.callThrough();
      chaptersSubject.next([{ id: 'c1', number: 1, title: 'A', content: 'A' }]);
      component.selectedFormat = 'docx';
      component.exportOptions.includeIllustrations = false;
      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(document.body, 'appendChild').and.stub();
      spyOn(document.body, 'removeChild').and.stub();
      spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
      await component.exportBook();
      expect(illSpy).not.toHaveBeenCalled();
    });
  });
});
