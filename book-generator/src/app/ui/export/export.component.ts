import { Component, OnInit, ChangeDetectorRef, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BookStateService } from '../../book/state/book-state.service';
import { PersistenceService } from '../../core/persistence.service';
import { Chapter } from '../../models/chapter.model';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TranslationService } from '../../i18n/translation.service';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

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
  
  chapters$: Observable<Chapter[]>;
  selectedFormat: 'pdf' | 'epub' | 'docx' | 'markdown' = 'pdf';
  exportOptions = {
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
        alert('No chapters to export. Generate some chapters first!');
        this.isExporting = false;
        this.exportProgress = 0;
        return;
      }

      const shouldTranslate = this.translationService.isPolish();
      if (shouldTranslate) {
        this.ngZone.run(() => {
          this.exportProgress = 5;
          this.exportStatus = `Tlumaczenie ${chapters.length} rozdzialow...`;
        });
        
        const translatedChapters = await this.translationService.translateBookToPolish(chapters);
        
        this.ngZone.run(() => {
          this.exportProgress = 65;
        });
        
        for (let i = 0; i < translatedChapters.length; i++) {
          chapters[i] = {
            ...chapters[i],
            title: translatedChapters[i].title,
            content: translatedChapters[i].content
          };
        }
      }

      this.ngZone.run(() => {
        const progressInterval = setInterval(() => {
          if (shouldTranslate && this.exportProgress < 85) {
            this.exportProgress += 5;
          } else if (!shouldTranslate && this.exportProgress < 90) {
            this.exportProgress += 10;
          }
        }, 150);
        (window as any).__exportProgressInterval = progressInterval;
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

      const intervalId = (window as any).__exportProgressInterval;
      if (intervalId) clearInterval(intervalId);

      this.downloadFile(content, filename);
      this.exportProgress = 100;

      setTimeout(() => {
        this.isExporting = false;
        this.exportProgress = 0;
      }, 1500);

    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
      this.isExporting = false;
      this.exportProgress = 0;
    }
  }

  private generatePDF(chapters: Chapter[]): Promise<Blob> {
    // Set pdfMake virtual file system with fonts
    (pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || (pdfFonts as any).vfs;

    const state = this.bookStateService.getState();
    const isPolish = this.translationService.isPolish();
    const bookTitle = state.config?.title || (isPolish ? 'Bez tytułu' : 'Untitled');
    const tocLabel = isPolish ? 'Spis Treści' : 'Table of Contents';
    const chapterLabel = isPolish ? 'Rozdział' : 'Chapter';
    const critiqueLabel = isPolish ? 'Raport Krytyki' : 'Critique Report';
    const overallScoreLabel = isPolish ? 'Ocena Ogólna' : 'Overall Score';
    const feedbackLabel = isPolish ? 'Informacja Zwrotna' : 'Feedback';

    // Clean text
    const cleanText = (text: string): string => {
      if (!text) return '';
      let result = text;
      result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
      result = result.replace(/\*([^*]+)\*/g, '$1');
      result = result.replace(/_([^_]+)_/g, '$1');
      result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      result = result.replace(/<[^>]+>/g, '');
      return result.trim();
    };

    // Build document content for pdfmake
    const content: any[] = [];

    // Title
    content.push({
      text: bookTitle,
      style: 'title'
    });

    // TOC
    if (this.exportOptions.includeTOC) {
      content.push({
        text: tocLabel,
        style: 'heading'
      });

      chapters.forEach(chapter => {
        content.push({
          text: `${chapterLabel} ${chapter.number}: ${chapter.title}`,
          style: 'tocEntry'
        });
      });

      content.push({ text: '', pageBreak: 'after' });
    }

    // Chapters
    chapters.forEach((chapter, index) => {
      if (this.exportOptions.includeTitles) {
        content.push({
          text: `${chapterLabel} ${chapter.number}: ${chapter.title}`,
          style: 'chapterTitle'
        });
      }

      // Process content - split by paragraphs
      const paragraphs = cleanText(chapter.content).split(/\n\n+/);
      
      paragraphs.forEach(para => {
        if (para.trim()) {
          content.push({
            text: para.trim(),
            style: 'body'
          });
        }
      });

      // Critique
      if (this.exportOptions.includeCritiques && chapter.critique) {
        content.push({
          text: critiqueLabel,
          style: 'critiqueTitle'
        });
        content.push({
          text: `${overallScoreLabel}: ${chapter.critique.overallScore}/10`,
          style: 'body'
        });
        content.push({
          text: `${feedbackLabel}: ${chapter.critique.feedback}`,
          style: 'body'
        });
      }

      // Page break between chapters (except last)
      if (index < chapters.length - 1) {
        content.push({ text: '', pageBreak: 'after' });
      }
    });

    // Define styles
    const docDefinition = {
      content: content,
      styles: {
        title: {
          fontSize: 24,
          bold: true,
          margin: [0, 0, 0, 20]
        },
        heading: {
          fontSize: 16,
          bold: true,
          margin: [0, 0, 0, 10]
        },
        tocEntry: {
          fontSize: 12,
          margin: [20, 2, 0, 2]
        },
        chapterTitle: {
          fontSize: 18,
          bold: true,
          margin: [0, 10, 0, 10]
        },
        critiqueTitle: {
          fontSize: 14,
          bold: true,
          margin: [0, 15, 0, 5]
        },
        body: {
          fontSize: 12,
          margin: [0, 0, 0, 5],
          lineHeight: 1.4
        }
      }
    };

    // Generate PDF as blob
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
      content += `${chapter.content}\n\n`;
      
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

  clearData(): void {
    if (confirm(this.t('export.confirmClearData'))) {
      this.persistenceService.clearAll()
        .pipe(takeUntil(new Subject()))
        .subscribe({
          next: () => {
            this.bookStateService.reset();
            this.chapterCount = 0;
            alert(this.t('export.dataCleared'));
          },
          error: (err: Error) => {
            console.error('Failed to clear data:', err);
            alert(this.t('export.clearDataFailed'));
          }
        });
    }
  }
}
