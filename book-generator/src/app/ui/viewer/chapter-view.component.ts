import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BookStateService } from '../../book/state/book-state.service';
import { Chapter } from '../../models/chapter.model';
import { AsyncPipe } from '@angular/common';
import { Observable } from 'rxjs';
import { TranslationService } from '../../i18n/translation.service';

@Component({
  selector: 'app-chapter-view',
  templateUrl: './chapter-view.component.html',
  styleUrls: ['./chapter-view.component.scss'],
  imports: [CommonModule, AsyncPipe]
})
export class ChapterViewComponent implements OnInit {
  protected translationService = inject(TranslationService);
  
  chapters$: Observable<Chapter[]>;
  selectedChapter: Chapter | null = null;
  selectedChapterIndex = 0;

  constructor(private bookStateService: BookStateService) {
    this.chapters$ = this.bookStateService.getChapters$();
  }

  ngOnInit(): void {
    // Load saved state or default to first chapter
    this.chapters$.subscribe((chapters: Chapter[]) => {
      if (chapters.length > 0 && !this.selectedChapter) {
        this.selectChapter(chapters[0], 0);
      }
    });
  }

  selectChapter(chapter: Chapter, index: number): void {
    this.selectedChapter = chapter;
    this.selectedChapterIndex = index;
  }

  nextChapter(): void {
    this.chapters$.subscribe((chapters: Chapter[]) => {
      if (this.selectedChapterIndex < chapters.length - 1) {
        this.selectChapter(chapters[this.selectedChapterIndex + 1], this.selectedChapterIndex + 1);
      }
    });
  }

  prevChapter(): void {
    if (this.selectedChapterIndex > 0) {
      this.chapters$.subscribe((chapters: Chapter[]) => {
        this.selectChapter(chapters[this.selectedChapterIndex - 1], this.selectedChapterIndex - 1);
      });
    }
  }

  getChapterScore(chapter: Chapter): number {
    return chapter.critique?.overallScore || 0;
  }

  getScoreColor(score: number): string {
    if (score >= 8) return 'text-green-600 dark:text-green-400';
    if (score >= 6) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  }

  formatScore(score: number): string {
    return score.toFixed(1);
  }

  // Helper methods for safely accessing critique properties
  getProseScore(): number {
    return this.selectedChapter?.critique?.scores?.prose ?? 0;
  }

  getPacingScore(): number {
    return this.selectedChapter?.critique?.scores?.pacing ?? 0;
  }

  getDialogueScore(): number {
    return this.selectedChapter?.critique?.scores?.dialogue ?? 0;
  }

  getFeedback(): string {
    return this.selectedChapter?.critique?.feedback ?? '';
  }

  getMustFix(): string[] {
    return this.selectedChapter?.critique?.mustFix ?? [];
  }

  getSuggestions(): string[] {
    return this.selectedChapter?.critique?.suggestions ?? [];
  }

  hasCritique(): boolean {
    return !!this.selectedChapter?.critique;
  }

  // Translation helper
  t(key: string): string {
    return this.translationService.get(key);
  }
}
