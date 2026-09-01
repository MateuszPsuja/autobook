import { Component, OnInit, OnDestroy, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BookStateService } from '../../book/state/book-state.service';
import { Chapter } from '../../models/chapter.model';
import { AsyncPipe } from '@angular/common';
import { Observable, Subscription } from 'rxjs';
import { TranslationService } from '../../i18n/translation.service';
import { stripRunningWordCount } from '../../shared/utils/chapter-cleanup';
import { CritiqueReport } from '../../models/critique.model';

@Component({
  selector: 'app-chapter-view',
  templateUrl: './chapter-view.component.html',
  styleUrls: ['./chapter-view.component.scss'],
  imports: [CommonModule, AsyncPipe]
})
export class ChapterViewComponent implements OnInit, OnDestroy {
  protected translationService = inject(TranslationService);

  chapters$: Observable<Chapter[]>;
  selectedChapter: Chapter | null = null;
  selectedChapterIndex = 0;

  /**
   * Critique that the panel actually renders. The post-generation
   * translation pass already writes Polish text into the state for
   * new runs, but books that existed before that pass — or runs
   * where the translation silently fell back to English — still
   * have English critiques in the state. This signal keeps a
   * (possibly) translated copy so the panel flips to Polish as
   * soon as the translation lands, without the user having to
   * re-generate. Mirrors the source critique in English.
   */
  displayCritique = signal<CritiqueReport | null>(null);

  /**
   * Active critique-translation subscription. Stored so the
   * previous in-flight request can be cancelled when the user
   * switches chapter or toggles language — otherwise a slow
   * earlier response could overwrite a fresh one.
   */
  private critiqueSub: Subscription | null = null;

  constructor(private bookStateService: BookStateService) {
    this.chapters$ = this.bookStateService.getChapters$();

    // The post-step already translated the state for new runs, so
    // most of the time the effect is a no-op copy. The signal
    // still exists so that (a) users on existing English data
    // see Polish feedback without re-generating, and (b) toggling
    // the language back to English returns the panel to the source
    // text instantly.
    effect(() => {
      // Track the language signal so the effect re-runs on toggle.
      this.translationService.language();
      this.refreshDisplayCritique(this.selectedChapter?.critique ?? null);
    });
  }

  ngOnInit(): void {
    // Load saved state or default to first chapter
    this.chapters$.subscribe((chapters: Chapter[]) => {
      if (chapters.length > 0 && !this.selectedChapter) {
        this.selectChapter(chapters[0], 0);
      }
    });
  }

  ngOnDestroy(): void {
    this.critiqueSub?.unsubscribe();
  }

  /**
   * Re-derive `displayCritique` for the given source critique under
   * the current language. Cancels any in-flight translation first
   * so a stale response can't overwrite a newer one. In English
   * the source is mirrored directly; in Polish the service is
   * called (or no-op if the field is empty) and the signal is
   * updated when the translation lands.
   */
  private refreshDisplayCritique(critique: CritiqueReport | null): void {
    this.critiqueSub?.unsubscribe();
    this.critiqueSub = null;

    if (!critique) {
      this.displayCritique.set(null);
      return;
    }

    if (this.translationService.isEnglish()) {
      this.displayCritique.set(critique);
      return;
    }

    // Seed with the English so the panel renders immediately;
    // swap to the Polish version the moment the API call lands.
    this.displayCritique.set(critique);
    this.critiqueSub = this.translationService
      .translateCritiqueToPolish$(critique)
      .subscribe({
        next: translated => this.displayCritique.set(translated),
        error: err => {
          console.warn('Critique translation failed; keeping English copy.', err);
          this.displayCritique.set(critique);
        }
      });
  }

  selectChapter(chapter: Chapter, index: number): void {
    this.selectedChapter = chapter;
    this.selectedChapterIndex = index;
    this.refreshDisplayCritique(chapter.critique ?? null);
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
