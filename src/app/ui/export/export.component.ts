import { Component, OnInit, ChangeDetectorRef, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BookStateService } from '../../book/state/book-state.service';
import { PersistenceService } from '../../core/persistence.service';
import { Chapter } from '../../models/chapter.model';
import { Observable, Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TranslationService } from '../../i18n/translation.service';
import { DialogService } from '../../core/dialog.service';
import { ProviderService } from '../../core/providers/provider.service';
import { IllustrationService } from '../../core/providers/illustration.service';
import { BookCoverArt, ChapterIllustration } from '../../core/providers/illustration.types';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { buildPdfDocument, PdfExportOptions } from './pdf-renderer';
import { stripRunningWordCount } from '../../shared/utils/chapter-cleanup';
import { ExportLanguage, EXPORT_LANGUAGES, getExportLabels, ExportLabels } from '../../i18n/export-labels';
import { buildEpubBlob } from './epub-builder';
import { buildDocxBlob } from './docx-builder';

// Initialize pdfMake with virtual file system
(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || (pdfFonts as any).vfs;

@Component({
  selector: 'app-export',
  templateUrl: './export.component.html',
  styleUrls: ['./export.component.scss'],
  imports: [CommonModule, FormsModule]
})
export class ExportComponent implements OnInit {
  protected translationService = inject(TranslationService);
  protected providerService = inject(ProviderService);
  private dialogService = inject(DialogService);
  private illustrationService = inject(IllustrationService);

  chapters$: Observable<Chapter[]>;
  selectedFormat: 'pdf' | 'epub' | 'docx' | 'markdown' = 'pdf';

  /**
   * Target language for the export. The book is always stored in
   * English; this dropdown picks whether the export should ship a
   * translated copy. 'en' (the default) skips the LLM translation
   * pass entirely.
   */
  exportLanguage: ExportLanguage = 'en';
  readonly availableExportLanguages = EXPORT_LANGUAGES;

  /**
   * Optional user-supplied byline / author name. When empty, the
   * exporter falls back to the localised default
   * ("Written by artificial intelligence" in the target language).
   * Used on the cover, title page, back cover, and the PDF `info`
   * metadata so the file's "Properties" dialog matches what's
   * printed on the page.
   */
  customAuthor = '';

  exportOptions: PdfExportOptions = {
    includeTitles: true,
    includeTOC: true,
    includeCharacters: false,
    includeIllustrations: false,
    illustrationStyle: 'auto'
  };
  isExporting = false;
  isExportStopped = false;
  exportProgress = 0;
  exportStatus = '';
  chapterCount = 0;

  /**
   * Handle for the fake progress interval started in `exportBook`.
   * Stored on the instance (not on `window`) and cleared in a
   * `finally` so a thrown error in any of the `generate*` calls
   * can't leak the interval. Previously this lived at
   * `window.__exportProgressInterval`, which had the same leak and
   * also polluted the global namespace.
   */
  private progressInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private bookStateService: BookStateService,
    private persistenceService: PersistenceService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {
    this.chapters$ = this.bookStateService.getChapters$();
    this.chapters$.subscribe(chapters => {
      this.chapterCount = chapters?.length || 0;
    });
  }

  ngOnInit(): void {
    // Hydrate the export dropdown from the persisted value the
    // translation service stores. Default ('en') is a no-op, so
    // a fresh client still gets the fast no-translation path.
    this.exportLanguage = this.translationService.exportLanguage();
  }

  setFormat(format: string): void {
    this.selectedFormat = format as 'pdf' | 'epub' | 'docx' | 'markdown';
  }

  t(key: string): string {
    return this.translationService.get(key);
  }

  setExportLanguage(language: ExportLanguage): void {
    this.exportLanguage = language;
    this.translationService.setExportLanguage(language);
  }

  /**
   * True when a non-English target is selected — the export will
   * run the LLM translation pass for the whole book. Used by the
   * template to show a "will translate to <language>" hint next
   * to the export button.
   */
  willTranslate(): boolean {
    return this.exportLanguage !== 'en';
  }

  /**
   * Returns the user-supplied byline when set, otherwise the
   * localised default from `ExportLabels.bookAuthor`. Trimmed so
   * whitespace-only input still falls through to the default.
   */
  getEffectiveAuthor(): string {
    const trimmed = (this.customAuthor || '').trim();
    if (trimmed) return trimmed;
    return getExportLabels(this.exportLanguage).bookAuthor;
  }

  stopExport(): void {
    this.isExportStopped = true;
    this.ngZone.run(() => {
      // UI status text stays in English regardless of target
      // language — the localised "Stopping..." / "Arrêt..." /
      // "Zatrzymywanie..." strings belong in the exported file,
      // not in the progress line.
      this.exportStatus = 'Stopping...';
    });
  }

  async exportBook(): Promise<void> {
    this.isExportStopped = false;
    if (this.isExporting) return;

    this.isExporting = true;
    this.exportProgress = 1;

    try {
      const state = this.bookStateService.getState();
      let chapters = [...state.chapters];
      // `config` is the user-typed book metadata. When the user
      // picked a non-English target, we translate the user-visible
      // fields (title, genre, themes, character profiles) below and
      // overwrite `config` with the translated copy so the cover,
      // back cover, title page, and markdown heading all read in
      // the target language. English / no target leaves it alone.
      let config = state.config;

      if (!chapters || chapters.length === 0) {
        await this.dialogService.alert({
          title: this.t('export.noChaptersTitle') || 'No chapters',
          message: 'No chapters to export. Generate some chapters first!',
          variant: 'warning'
        });
        return;
      }

      // Defensive: surface missing or empty chapters up front so the
      // user doesn't get a PDF with a hole and no idea why. We block
      // the export and list the gaps.
      const expectedCount = state.config?.targetLength
        ? this.estimateExpectedChapters(state.config.targetLength)
        : null;
      const missing = chapters
        .map((c, i) => ({ chapter: c, position: i + 1 }))
        .filter(({ chapter, position }) => chapter.number !== position);
      const empty = chapters
        .filter(c => !c.content || !c.content.trim())
        .map(c => c.number);
      const skipped = Array.isArray(state.skippedChapters)
        ? state.skippedChapters.filter(n => n > 0)
        : [];
      if (missing.length || empty.length || skipped.length) {
        const issues: string[] = [];
        if (missing.length) {
          issues.push(`Chapter numbers are out of order: expected ${missing.map(m => m.position).join(', ')} but found different numbers.`);
        }
        if (empty.length) {
          issues.push(`Chapter(s) ${empty.join(', ')} have no content.`);
        }
        if (skipped.length) {
          issues.push(`Chapter(s) ${skipped.join(', ')} were skipped during generation (LLM error). Re-run generation to fill them in.`);
        }
        if (expectedCount && chapters.length < expectedCount) {
          issues.push(`Book has ${chapters.length} chapters but the target length expects ~${expectedCount}.`);
        }
        await this.dialogService.alert({
          title: this.t('export.exportBlockedTitle') || 'Export blocked',
          message: 'Export blocked: ' + issues.join(' ') +
            '\n\nRe-generate the missing chapter(s) and try again.',
          variant: 'warning'
        });
        return;
      }

      // Translation: when the user picked a non-English export target,
      // translate the whole book (metadata + chapters) into that
      // language. English is the source — the orchestrator always
      // writes English — so 'en' is a no-op.
      const target = this.exportLanguage;
      // Hoisted out of the `if (target !== 'en')` block so the
      // illustration caption rewriter below can also use the
      // localised "Chapter" word. Cheap (just a dict lookup) and
      // also lets the English-only path drop into a sensible
      // default.
      const labels = getExportLabels(target);
      if (target !== 'en' && chapters.length > 0) {
        this.ngZone.run(() => {
          this.exportProgress = 30;
          // Keep the in-progress status in English so it stays
          // short and scannable — the localised "Übersetzung…" /
          // "Tłumaczenie…" / "Перевод…" labels live in the
          // exported file itself, not in the UI status line.
          this.exportStatus = 'Translating...';
        });

        try {
          // Translate the user-typed book metadata (title, genre,
          // themes, plot, character names / backgrounds / etc.) so the
          // cover, back-cover blurb, title page, and markdown top
          // heading all read in the target language.
          if (state.config) {
            config = await firstValueFrom(
              this.translationService.translateBookMetadataTo$(state.config, target)
            );
            if (this.isExportStopped) return;
          }

          // Translate every chapter's user-visible text fields.
          chapters = await firstValueFrom(
            this.translationService.translateBookTo$(chapters, target, labels.chapterLabel)
          );
          if (this.isExportStopped) return;
        } catch (err) {
          // A whole-book translation failure is rare (per-field
          // helpers swallow errors) but if the outer observable
          // errors anyway, ship the English chapters with a warning
          // rather than failing the export.
          console.error(`Export: translation to ${target} failed; shipping English copy.`, err);
        }

        this.ngZone.run(() => {
          this.exportProgress = 70;
        });
      }

      // Illustration pass (minimax-only). Runs in the try block so
      // any rejection falls into the existing `catch (error)`
      // handler. Failure here is non-fatal: a `null` result or a
      // missing illustration just means the chapter / cover ships
      // without art, but the export still completes.
      //
      // The PDF and EPUB paths both consume the same illustration
      // payload; DOCX and Markdown don't (DOCX is out of scope for
      // the EPUB rebuild, Markdown is plain text). The DOCX branch
      // currently has the same "markdown with wrong MIME" bug as
      // the old EPUB branch but that's a follow-up plan.
      let chapterIllustrations: Map<string, ChapterIllustration> | undefined;
      let coverArt: BookCoverArt | undefined;
      let backCoverArt: BookCoverArt | undefined;
      if ((this.selectedFormat === 'pdf' || this.selectedFormat === 'epub' || this.selectedFormat === 'docx') &&
          this.exportOptions.includeIllustrations &&
          this.providerService.getActiveProviderId() === 'minimax') {
        this.ngZone.run(() => {
          this.exportStatus = 'Generating illustrations...';
        });
        const result = await firstValueFrom(this.illustrationService.generateAll$({
          chapters,
          config: state.config,
          // Pass the architect's blueprint so the cover and chapter
          // scene LLM calls have actual story content (titles, plot
          // beats, key events, character arcs) to ground the visual
          // descriptions in. The illustration service falls back to
          // title/themes + a 600-char opening excerpt when the
          // blueprint is null, so hand-imported books still work.
          blueprint: state.blueprint,
          characterStore: state.characterStore,
          style: this.exportOptions.illustrationStyle,
          onProgress: (done, total) => this.ngZone.run(() => {
            this.exportStatus = total > 0
              ? `Generating illustrations: ${done}/${total}`
              : 'Generating illustrations...';
            this.exportProgress = Math.min(85, 30 + Math.floor((done / Math.max(1, total)) * 55));
          }),
          signal: () => this.isExportStopped
        }));
        if (this.isExportStopped) return;
        chapterIllustrations = result.chapterIllustrations;
        coverArt = result.coverArt;
        backCoverArt = result.backCoverArt;
      }

      // The illustration service builds each chapter caption as
      // "Chapter N · <title>" with the English "Chapter" word and
      // the title it pulled from the (English) blueprint. When the
      // user exported to a non-English target, the chapter titles
      // have just been translated — rewrite the captions here so
      // they read in the target language too. Keeps the service
      // language-agnostic; the export component owns localisation.
      if (chapterIllustrations && chapterIllustrations.size > 0) {
        const chapterById = new Map(chapters.map(c => [c.id, c]));
        const rewritten = new Map<string, ChapterIllustration>();
        for (const [id, ill] of chapterIllustrations.entries()) {
          const ch = chapterById.get(id);
          if (!ch) { rewritten.set(id, ill); continue; }
          rewritten.set(id, {
            ...ill,
            caption: `${labels.chapterLabel} ${ch.number} \u00B7 ${ch.title || ''}`.trim()
          });
        }
        chapterIllustrations = rewritten;
      }

      this.ngZone.run(() => {
        this.progressInterval = setInterval(() => {
          // Translation (when applicable) pushed progress to 70
          // before this interval starts, so its ceiling is 85.
          // Without translation, the interval runs the bar from
          // 0 to 90 in 10-point ticks.
          if (target !== 'en' && this.exportProgress < 85) {
            this.exportProgress += 5;
          } else if (target === 'en' && this.exportProgress < 90) {
            this.exportProgress += 10;
          }
        }, 150);
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      let content: Blob;
      let filename: string;

      switch (this.selectedFormat) {
        case 'pdf':
          content = await this.generatePDF(chapters, {
            chapterIllustrations,
            coverArt,
            backCoverArt,
          }, config);
          filename = 'book-export.pdf';
          break;
        case 'epub':
          content = await this.generateEPUB(chapters, config, {
            chapterIllustrations,
            coverArt,
            backCoverArt,
          });
          filename = 'book-export.epub';
          break;
        case 'docx':
          content = await this.generateDOCX(chapters, config, {
            chapterIllustrations,
            coverArt,
            backCoverArt,
          });
          filename = 'book-export.docx';
          break;
        case 'markdown':
        default:
          content = this.generateMarkdown(chapters, config);
          filename = 'book-export.md';
          break;
      }

      this.downloadFile(content, filename);
      this.exportProgress = 100;

      setTimeout(() => {
        this.isExporting = false;
        this.exportProgress = 0;
      }, 1500);

    } catch (error) {
      console.error('Export failed:', error);
      await this.dialogService.alert({
        title: this.t('export.exportFailedTitle') || 'Export failed',
        message: 'Export failed. Please try again.',
        variant: 'error'
      });
      this.isExporting = false;
      this.exportProgress = 0;
    } finally {
      // Always clear the progress interval, even if a `generate*`
      // call threw. Without this the interval would keep ticking
      // and incrementing the progress bar forever.
      if (this.progressInterval !== null) {
        clearInterval(this.progressInterval);
        this.progressInterval = null;
      }
    }
  }

  private generatePDF(chapters: Chapter[], illustrationCtx?: {
    chapterIllustrations?: Map<string, ChapterIllustration>;
    coverArt?: BookCoverArt;
    backCoverArt?: BookCoverArt;
  }, translatedConfig?: any): Promise<Blob> {
    // Set pdfMake virtual file system with fonts
    (pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || (pdfFonts as any).vfs;

    // If a translated config was provided, swap it into a copy of
    // the state so the renderer reads the localised title / genre /
    // themes / protagonist name from the cover, back cover, and
    // title page. Otherwise the renderer falls through to the
    // English state.config (the default for 'en' exports).
    const baseState = this.bookStateService.getState();
    const viewState = translatedConfig
      ? { ...baseState, config: translatedConfig }
      : baseState;

    const docDefinition = buildPdfDocument(chapters, this.exportOptions, {
      state: viewState,
      language: this.exportLanguage,
      bookAuthor: this.getEffectiveAuthor(),
      chapterIllustrations: illustrationCtx?.chapterIllustrations,
      coverArt: illustrationCtx?.coverArt,
      backCoverArt: illustrationCtx?.backCoverArt,
    });

    return new Promise((resolve, reject) => {
      try {
        pdfMake.createPdf(docDefinition).getBlob((blob: Blob) => {
          resolve(blob);
        });
      } catch (error) {
        console.error('Error generating PDF:', error);
        reject(error);
      }
    });
  }

  private async generateEPUB(
    chapters: Chapter[],
    translatedConfig?: any,
    illustrationCtx?: {
      chapterIllustrations?: Map<string, ChapterIllustration>;
      coverArt?: BookCoverArt;
      backCoverArt?: BookCoverArt;
    },
  ): Promise<Blob> {
    // If a translated config was provided, swap it into a copy of
    // the state so the EPUB builder reads the localised title /
    // genre / themes / protagonist name from the cover, back
    // cover, and title page. Otherwise it falls through to the
    // English state.config (the default for 'en' exports).
    const baseState = this.bookStateService.getState();
    const config = translatedConfig ?? baseState.config;
    const labels = getExportLabels(this.exportLanguage);
    return buildEpubBlob({
      chapters,
      config,
      labels,
      bookAuthor: this.getEffectiveAuthor(),
      illustrationCtx,
    });
  }

  private async generateDOCX(
    chapters: Chapter[],
    translatedConfig?: any,
    illustrationCtx?: {
      chapterIllustrations?: Map<string, ChapterIllustration>;
      coverArt?: BookCoverArt;
      backCoverArt?: BookCoverArt;
    },
  ): Promise<Blob> {
    // If a translated config was provided, swap it into a copy of
    // the state so the DOCX builder reads the localised title /
    // genre / themes / protagonist name from the cover, back
    // cover, and title page. Otherwise it falls through to the
    // English state.config (the default for 'en' exports).
    const baseState = this.bookStateService.getState();
    const config = translatedConfig ?? baseState.config;
    const labels = getExportLabels(this.exportLanguage);
    return await buildDocxBlob({
      chapters,
      config,
      labels,
      bookAuthor: this.getEffectiveAuthor(),
      illustrationCtx,
    });
  }

  private generateMarkdown(chapters: Chapter[], translatedConfig?: any): Blob {
    const content = this.buildBookContent(chapters, translatedConfig);
    return new Blob([content], { type: 'text/markdown' });
  }

  private buildBookContent(chapters: Chapter[], translatedConfig?: any): string {
    const labels = getExportLabels(this.exportLanguage);
    // Prefer the translated title; fall through to the live state's
    // title for the default (English) export.
    const baseState = this.bookStateService.getState();
    const config = translatedConfig ?? baseState.config;
    const bookTitle = config?.title || labels.untitledFallback;

    let content = `# ${bookTitle}\n\n*${this.getEffectiveAuthor()}*\n\n`;

    if (this.exportOptions.includeTOC) {
      content += `## ${labels.tocLabel}\n\n`;
      chapters.forEach(chapter => {
        content += `- [${labels.chapterLabel} ${chapter.number}: ${chapter.title}](#chapter-${chapter.number})\n`;
      });
      content += '\n';
    }

    chapters.forEach(chapter => {
      if (this.exportOptions.includeTitles) {
        content += `# ${labels.chapterLabel} ${chapter.number}: ${chapter.title}\n\n`;
      }
      content += `${stripRunningWordCount(chapter.content)}\n\n`;

      content += '---\n\n';
    });

    return content;
  }

  private downloadFile(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  getExportButtonText(): string {
    if (this.isExporting) {
      return `${this.t('export.exporting')} ${this.exportProgress}%`;
    }
    return `${this.t('export.export')} ${this.selectedFormat.toUpperCase()}`;
  }

  getChapterCount(): number {
    return this.chapterCount;
  }

  /**
   * Rough target chapter count for a given book length, used to flag
   * obviously-incomplete exports. Kept in sync with the architect
   * service's estimate.
   */
  private estimateExpectedChapters(targetLength: string): number {
    switch (targetLength) {
      case 'Short Story': return 3;
      case 'Novella': return 7;
      case 'Novel': return 15;
      case 'Epic': return 25;
      default: return 5;
    }
  }

  getFormatDescription(format: string): string {
    switch (format) {
      case 'pdf': return this.t('export.pdfDesc');
      case 'epub': return this.t('export.epubDesc');
      case 'docx': return this.t('export.docxDesc');
      case 'markdown': return this.t('export.markdownDesc');
      default: return '';
    }
  }

  getFormatExtension(format: string): string {
    switch (format) {
      case 'pdf': return '.pdf';
      case 'epub': return '.epub';
      case 'docx': return '.docx';
      case 'markdown': return '.md';
      default: return '';
    }
  }

  async clearData(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: this.t('export.confirmClearTitle') || 'Clear all data?',
      message: this.t('export.confirmClearData'),
      confirmText: this.t('export.clear') || 'Clear',
      cancelText: this.t('export.cancel') || 'Cancel',
      variant: 'warning'
    });
    if (!confirmed) return;

    this.persistenceService.clearAll()
      .pipe(takeUntil(new Subject()))
      .subscribe({
        next: async () => {
          this.bookStateService.reset();
          this.chapterCount = 0;
          await this.dialogService.alert({
            title: this.t('export.dataClearedTitle') || 'Data cleared',
            message: this.t('export.dataCleared'),
            variant: 'success'
          });
        },
        error: async (err: Error) => {
          console.error('Failed to clear data:', err);
          await this.dialogService.alert({
            title: this.t('export.clearDataFailedTitle') || 'Clear failed',
            message: this.t('export.clearDataFailed'),
            variant: 'error'
          });
        }
      });
  }
}
