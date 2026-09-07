import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, interval } from 'rxjs';
import { map } from 'rxjs/operators';
import { BookState, AgentType, GenerationStatus, GenerationStats, createInitialStats } from '../../models/book-state.model';
import { BookConfig } from '../../models/book-config.model';
import { Chapter } from '../../models/chapter.model';

@Injectable({
  providedIn: 'root'
})
export class BookStateService {
  private initialState: BookState = {
    config: {} as BookConfig,
    blueprint: null,
    chapters: [],
    prologue: null,
    epilogue: null,
    currentDraft: null,
    characterStore: {},
    worldStateDoc: '',
    critique: null,
    revisionCount: 0,
    continuityFlags: [],
    activeAgent: null,
    status: 'idle',
    error: null,
    skippedChapters: [],
    currentChapterNumber: null,
    stats: createInitialStats(),
    liveStream: '',
    liveStreamAgent: null,
    liveStreamStartedAt: null
  };

  // Keep BehaviorSubject for backwards compatibility and for use with toSignal()
  private state$ = new BehaviorSubject<BookState>(this.initialState);

  constructor() {}

  // Get current state
  getState(): BookState {
    return this.state$.value;
  }

  // Get state as observable
  getState$(): Observable<BookState> {
    return this.state$.asObservable();
  }

  // Get derived observables using RxJS operators
  getActiveAgent$(): Observable<AgentType | null> {
    return this.state$.pipe(map(s => s.activeAgent));
  }

  getStatus$(): Observable<GenerationStatus> {
    return this.state$.pipe(map(s => s.status));
  }

  getChapters$(): Observable<any[]> {
    return this.state$.pipe(map(s => s.chapters));
  }

  getPrologue$(): Observable<Chapter | null | undefined> {
    return this.state$.pipe(map(s => s.prologue));
  }

  getEpilogue$(): Observable<Chapter | null | undefined> {
    return this.state$.pipe(map(s => s.epilogue));
  }

  getCurrentDraft$(): Observable<any | null> {
    return this.state$.pipe(map(s => s.currentDraft));
  }

  // Update state immutably
  patch(partial: Partial<BookState>): void {
    const currentState = this.state$.value;
    const newState = { ...currentState, ...partial };
    this.state$.next(newState);
  }

  // Reset state
  reset(): void {
    this.state$.next(this.initialState);
  }

  // Set specific state properties
  setConfig(config: BookConfig): void {
    this.patch({ config });
  }

  setBlueprint(blueprint: any): void {
    this.patch({ blueprint });
  }

  setChapters(chapters: any[]): void {
    this.patch({ chapters });
  }

  replaceChapter(index: number, chapter: Chapter): void {
    const current = this.state$.value.chapters;
    if (index < 0 || index >= current.length) {
      return;
    }
    const updated = [...current];
    updated[index] = chapter;
    this.patch({ chapters: updated });
  }

  findChapterIndexByNumber(number: number): number {
    return this.state$.value.chapters.findIndex(c => c.number === number);
  }

  setPrologue(chapter: Chapter | null): void {
    this.patch({ prologue: chapter });
  }

  setEpilogue(chapter: Chapter | null): void {
    this.patch({ epilogue: chapter });
  }

  setCurrentDraft(draft: any | null): void {
    this.patch({ currentDraft: draft });
  }

  setCharacterStore(store: Record<string, any>): void {
    this.patch({ characterStore: store });
  }

  setWorldStateDoc(doc: string): void {
    this.patch({ worldStateDoc: doc });
  }

  setCritique(critique: any | null): void {
    this.patch({ critique });
  }

  setRevisionCount(count: number): void {
    this.patch({ revisionCount: count });
  }

  setContinuityFlags(flags: any[]): void {
    this.patch({ continuityFlags: flags });
  }

  setActiveAgent(agent: AgentType | null): void {
    this.patch({ activeAgent: agent });
  }

  setStatus(status: GenerationStatus): void {
    this.patch({ status });
  }

  setError(error: string | null): void {
    this.patch({ error });
  }

  setSkippedChapters(skipped: number[]): void {
    this.patch({ skippedChapters: skipped });
  }

  setCurrentChapter(chapterNumber: number | null): void {
    this.patch({ currentChapterNumber: chapterNumber });
  }

  // ===== Stream buffer (live prose preview) =====
  //
  // The orchestrator wraps every prose-emitting agent call (author,
  // reviser) with `beginStream$` → `appendStream$` on each delta →
  // `endStream$` when the call resolves/errors. The stream card in
  // the generator UI reads `liveStream` / `liveStreamAgent` and the
  // two derived observables below to render live progress.

  /**
   * Timer handle for the 2s tail-window after `endStream$` —
   * cleared when `beginStream$` runs again so a retry that starts
   * within the window doesn't accidentally hide the new attempt.
   */
  private streamHideTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Reset the stream buffer for a new attempt and stamp the start
   * time. Idempotent — calling it again with the same agent just
   * resets the buffer (used inside retry loops so a failed attempt's
   * text doesn't bleed into the next attempt's display).
   */
  beginStream$(agent: AgentType): void {
    if (this.streamHideTimer !== null) {
      clearTimeout(this.streamHideTimer);
      this.streamHideTimer = null;
    }
    this.patch({
      liveStream: '',
      liveStreamAgent: agent,
      liveStreamStartedAt: Date.now()
    });
  }

  /**
   * Append a chunk of prose text to the live stream buffer. Called
   * from the SSE-delta callback in the orchestrator — fires many
   * times per second during generation.
   */
  appendStream$(delta: string): void {
    if (!delta) return;
    const next = this.state$.value.liveStream + delta;
    this.patch({
      liveStream: next
    });
  }

  /**
   * Mark the current stream as finished. Leaves the buffer text in
   * `liveStream` so the UI shows a brief tail after the agent ends,
   * and schedules a 2s hide-timer that flips `liveStreamAgent` to
   * `null`. The tail window is cancelled by the next `beginStream$`
   * (which fires on the orchestrator's retry path), so retries
   * never end up briefly hiding a fresh attempt.
   */
  endStream$(): void {
    if (this.streamHideTimer !== null) {
      clearTimeout(this.streamHideTimer);
    }
    this.streamHideTimer = setTimeout(() => {
      this.streamHideTimer = null;
      this.patch({
        liveStreamAgent: null,
        liveStreamStartedAt: null
      });
    }, 2000);
  }

  /**
   * Wipe the buffer text and cancel the tail-window timer in one
   * shot. Used by the orchestrator's `stop()` so a partial stream
   * doesn't linger after the user cancelled — the 2s tail is for
   * natural completion, not for stop.
   */
  clearLiveStreamBuffer(): void {
    if (this.streamHideTimer !== null) {
      clearTimeout(this.streamHideTimer);
      this.streamHideTimer = null;
    }
    this.patch({
      liveStream: '',
      liveStreamAgent: null,
      liveStreamStartedAt: null
    });
  }

  /**
   * Emit the last 6 non-empty lines of the live stream. Splits the
   * accumulated buffer on `\n`, drops blanks, and trims. Memoized
   * via `distinctUntilChanged`-like semantics inside the operator
   * chain — callers can render this in a tight loop without us
   * re-emitting on every unrelated state change.
   */
  getLiveStreamLines$(): Observable<string[]> {
    return this.state$.pipe(
      map(s => {
        const text = s.liveStream ?? '';
        if (!text) return [];
        // Only show *completed* lines (everything up to the last
        // newline). The mid-stream tail of the current line is the
        // partial that would otherwise flicker a caret "line".
        const lastNewline = text.lastIndexOf('\n');
        const completed = lastNewline >= 0 ? text.slice(0, lastNewline) : '';
        const lines = completed
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0);
        return lines.slice(-6);
      })
    );
  }

  /**
   * Emit the current tokens/sec rate, throttled to 1 Hz via an
   * internal `interval`. Sourced from the real cumulative
   * `stats.totalTokens` (recorded by `recordAgentUsage` on every
   * completed agent call) divided by seconds since `stats.startTime`,
   * not from the per-stream chars/4 heuristic. Avoids recomputing
   * on every SSE delta — even a 50-token/sec stream fires hundreds
   * of deltas per second, and the chip is mono digits, not a live
   * counter. Returns 0 until the orchestrator has stamped
   * `stats.startTime` via `startGenerationTimer()`.
   */
  getLiveTokenRate$(): Observable<number> {
    return interval(1000).pipe(
      map(() => {
        const s = this.state$.value;
        if (!s.stats.startTime) return 0;
        const elapsedSec = (Date.now() - s.stats.startTime.getTime()) / 1000;
        if (elapsedSec <= 0) return 0;
        return s.stats.totalTokens / elapsedSec;
      })
    );
  }

  // Stats methods
  getStats$(): Observable<GenerationStats> {
    return this.state$.pipe(map(s => s.stats));
  }

  getStats(): GenerationStats {
    return this.state$.value.stats;
  }

  setStats(stats: GenerationStats): void {
    this.patch({ stats });
  }

  startGenerationTimer(): void {
    const currentStats = this.getStats();
    this.patch({
      stats: {
        ...currentStats,
        startTime: new Date()
      }
    });
  }

  endGenerationTimer(): void {
    const currentStats = this.getStats();
    this.patch({
      stats: {
        ...currentStats,
        endTime: new Date()
      }
    });
  }

  recordAgentUsage(agent: AgentType, usage: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
    const currentStats = this.getStats();
    const currentAgentStats = currentStats.agentStats[agent];
    
    const updatedAgentStats = {
      ...currentStats.agentStats,
      [agent]: {
        calls: currentAgentStats.calls + 1,
        promptTokens: currentAgentStats.promptTokens + usage.promptTokens,
        completionTokens: currentAgentStats.completionTokens + usage.completionTokens,
        totalTokens: currentAgentStats.totalTokens + usage.totalTokens
      }
    };

    const totalPromptTokens = Object.values(updatedAgentStats).reduce((sum, a) => sum + a.promptTokens, 0);
    const totalCompletionTokens = Object.values(updatedAgentStats).reduce((sum, a) => sum + a.completionTokens, 0);

    this.patch({
      stats: {
        ...currentStats,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        agentStats: updatedAgentStats
      }
    });
  }

  updateTotalWords(wordCount: number): void {
    const currentStats = this.getStats();
    this.patch({
      stats: {
        ...currentStats,
        totalWords: wordCount
      }
    });
  }

  resetStats(): void {
    this.patch({ stats: createInitialStats() });
  }

  /**
   * Live-stream counter: increments every time an agent call errors
   * out, regardless of whether the orchestrator recovers with a
   * retry or eventually skips the section. Mirrors
   * `stats.errorCount` so the live-output card and the post-run
   * stats card agree on the total.
   */
  incrementErrorCount(): void {
    const currentStats = this.getStats();
    this.patch({
      stats: {
        ...currentStats,
        errorCount: currentStats.errorCount + 1
      }
    });
  }

  /**
   * Live-stream counter: increments every time the orchestrator
   * schedules a retry (author or reviser). Does NOT increment on
   * the first attempt of any logical call — only attempts 2 and
   * beyond are counted. Mirrors `stats.retryCount`.
   */
  incrementRetryCount(): void {
    const currentStats = this.getStats();
    this.patch({
      stats: {
        ...currentStats,
        retryCount: currentStats.retryCount + 1
      }
    });
  }

  getErrorCount$(): Observable<number> {
    return this.state$.pipe(map(s => s.stats.errorCount ?? 0));
  }

  getRetryCount$(): Observable<number> {
    return this.state$.pipe(map(s => s.stats.retryCount ?? 0));
  }
}
