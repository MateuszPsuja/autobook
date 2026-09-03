import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BookStateService } from '../../book/state/book-state.service';
import { Chapter } from '../../models/chapter.model';
import { AsyncPipe } from '@angular/common';
import { Observable } from 'rxjs';
import { TranslationService } from '../../i18n/translation.service';
import { stripRunningWordCount } from '../../shared/utils/chapter-cleanup';
import { CritiqueReport } from '../../models/critique.model';

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

  /**
   * Critique that the panel renders. The UI is English-only and the
   * orchestrator stores English critiques, so this signal mirrors
   * the source critique as-is. Kept as a signal (rather than a
   * direct reference to `selectedChapter.critique`) so the getters
   * can be extended later — e.g. if we ever want a per-chapter
   * on-demand translation in the viewer, the wiring stays the same.
   */
  displayCritique = signal<CritiqueReport | null>(null);

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
    // Source critique is already in the right language; mirror it
    // straight into the display signal.
    this.displayCritique.set(chapter.critique ?? null);
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

  // Helper methods for safely accessing critique properties.
  // Prefer the (possibly) translated `displayCritique` so the
  // panel flips to Polish automatically when the user toggles
  // the language, but fall back to the raw `selectedChapter.critique`
  // for tests or code that set `selectedChapter` directly
  // without going through `selectChapter` (in which case
  // `displayCritique` is still null).
  private activeCritique(): CritiqueReport | null {
    return this.displayCritique() ?? this.selectedChapter?.critique ?? null;
  }

  getProseScore(): number {
    return this.activeCritique()?.scores?.prose ?? 0;
  }

  getPacingScore(): number {
    return this.activeCritique()?.scores?.pacing ?? 0;
  }

  getDialogueScore(): number {
    return this.activeCritique()?.scores?.dialogue ?? 0;
  }

  getFeedback(): string {
    return this.activeCritique()?.feedback ?? '';
  }

  getMustFix(): string[] {
    return this.activeCritique()?.mustFix ?? [];
  }

  getSuggestions(): string[] {
    return this.activeCritique()?.suggestions ?? [];
  }

  hasCritique(): boolean {
    return !!this.activeCritique();
  }

  /**
   * True when the critic service produced a sentinel object because the
   * reviewer model failed to return a parseable critique. The UI should
   * show the `unavailableReason` message instead of the normal
   * scores/feedback panel.
   */
  isCritiqueUnavailable(): boolean {
    return !!this.activeCritique()?.unavailableReason;
  }

  getCritiqueUnavailableReason(): string {
    return this.activeCritique()?.unavailableReason || '';
  }

  /**
   * Defensive cleanup for already-stored chapters. New chapters come
   * out of the author service clean, but chapters persisted before
   * that fix may still carry the running-counter corruption pattern.
   */
  getDisplayContent(): string {
    return stripRunningWordCount(this.selectedChapter?.content || '');
  }

  // Translation helper
  t(key: string): string {
    return this.translationService.get(key);
  }
}
