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
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { buildPdfDocument, PdfExportOptions } from './pdf-renderer';
import { stripRunningWordCount } from '../../shared/utils/chapter-cleanup';

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
  private dialogService = inject(DialogService);
  
  chapters$: Observable<Chapter[]>;
  selectedFormat: 'pdf' | 'epub' | 'docx' | 'markdown' = 'pdf';
  exportOptions: PdfExportOptions = {
    includeTitles: true,
    includeTOC: true,
    includeCritiques: false,
    includeCharacters: false
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

  ngOnInit(): void {}

  setFormat(format: string): void {
    this.selectedFormat = format as 'pdf' | 'epub' | 'docx' | 'markdown';
  }

  t(key: string): string {
    return this.translationService.get(key);
  }

  stopExport(): void {
    this.isExportStopped = true;
    this.ngZone.run(() => {
      this.exportStatus = this.translationService.isPolish() ? 'Zatrzymywanie...' : 'Stopping...';
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

      // The orchestrator already translates chapter title + content
      // to Polish after generation (when the user is in Polish mode),
      // so the chapters in the state are already in the target
      // language. Re-translating them here would burn an extra full
      // LLM pass for the entire book and risk the model "improving"
      // already-Polish prose, so we just ship the chapters as-is.
      //
      // Critiques are a narrow exception: if the user generated the
      // book in English mode and then flipped the UI to Polish
      // without resetting (pre-existing language-toggle behaviour
      // preserved a no-data book, so any stale critique would slip
      // through), the critique text is still English. Translating
      // critiques here keeps the exported file consistent with the
      // chosen UI language without re-touching the chapter bodies.
      const shouldTranslate = this.translationService.isPolish();
      if (shouldTranslate) {
        this.ngZone.run(() => {
          this.exportProgress = 30;
          this.exportStatus = `Tlumaczenie raportow krytyki...`;
        });

        // Translate the critique (feedback / mustFix / suggestions /
        // unavailableReason) for each chapter in parallel, then write
        // the translated critique back onto the in-memory chapter so
        // the markdown / PDF / EPUB / DOCX builders pick it up.
        const translatedCritiques = await Promise.all(
          chapters.map(chapter =>
            chapter.critique
              ? firstValueFrom(this.translationService.translateCritiqueToPolish$(chapter.critique))
              : Promise.resolve(undefined)
          )
        );

        this.ngZone.run(() => {
          this.exportProgress = 60;
        });

        for (let i = 0; i < chapters.length; i++) {
          if (translatedCritiques[i]) {
            chapters[i] = {
              ...chapters[i],
              critique: translatedCritiques[i]
            };
          }
        }
      }

      this.ngZone.run(() => {
        this.progressInterval = setInterval(() => {
          if (shouldTranslate && this.exportProgress < 85) {
            this.exportProgress += 5;
          } else if (!shouldTranslate && this.exportProgress < 90) {
            this.exportProgress += 10;
          }
        }, 150);
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      let content: Blob;
      let filename: string;

      switch (this.selectedFormat) {
        case 'pdf':
          content = await this.generatePDF(chapters);
          filename = 'book-export.pdf';
          break;
        case 'epub':
          content = this.generateEPUB(chapters);
          filename = 'book-export.epub';
          break;
        case 'docx':
          content = this.generateDOCX(chapters);
          filename = 'book-export.docx';
          break;
        case 'markdown':
        default:
          content = this.generateMarkdown(chapters);
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

  private generatePDF(chapters: Chapter[]): Promise<Blob> {
    // Set pdfMake virtual file system with fonts
    (pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || (pdfFonts as any).vfs;

    const docDefinition = buildPdfDocument(chapters, this.exportOptions, {
      state: this.bookStateService.getState(),
      isPolish: this.translationService.isPolish(),
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

  private generateEPUB(chapters: Chapter[]): Blob {
    const content = this.buildBookContent(chapters);
    return new Blob([content], { type: 'application/epub+zip' });
  }

  private generateDOCX(chapters: Chapter[]): Blob {
    const content = this.buildBookContent(chapters);
    return new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  private generateMarkdown(chapters: Chapter[]): Blob {
    const content = this.buildBookContent(chapters);
    return new Blob([content], { type: 'text/markdown' });
  }

  private buildBookContent(chapters: Chapter[]): string {
    const state = this.bookStateService.getState();
    const isPolish = this.translationService.isPolish();
    const bookTitle = state.config?.title || (isPolish ? 'Bez tytułu' : 'Untitled');
    const tocLabel = isPolish ? 'Spis Treści' : 'Table of Contents';
    const chapterLabel = isPolish ? 'Rozdział' : 'Chapter';
    const critiqueLabel = isPolish ? 'Raport Krytyki' : 'Critique Report';
    const overallScoreLabel = isPolish ? 'Ocena Ogólna' : 'Overall Score';
    const feedbackLabel = isPolish ? 'Informacja Zwrotna' : 'Feedback';

    let content = `# ${bookTitle}\n\n`;
    
    if (this.exportOptions.includeTOC) {
      content += `## ${tocLabel}\n\n`;
      chapters.forEach(chapter => {
        content += `- [${chapterLabel} ${chapter.number}: ${chapter.title}](#chapter-${chapter.number})\n`;
      });
      content += '\n';
    }

    chapters.forEach(chapter => {
      if (this.exportOptions.includeTitles) {
        content += `# ${chapterLabel} ${chapter.number}: ${chapter.title}\n\n`;
      }
      content += `${stripRunningWordCount(chapter.content)}\n\n`;
      
      if (this.exportOptions.includeCritiques && chapter.critique) {
        content += `## ${critiqueLabel}\n\n`;
        content += `**${overallScoreLabel}:** ${chapter.critique.overallScore}/10\n\n`;
        content += `**${feedbackLabel}:** ${chapter.critique.feedback}\n\n`;
      }
      
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
