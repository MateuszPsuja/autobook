import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription, Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { BookStateService } from '../../book/state/book-state.service';
import { OrchestratorService } from '../../book/orchestrator/orchestrator.service';
import { ApiService } from '../../core/api.service';
import { ProviderService } from '../../core/providers/provider.service';
import { BookConfig } from '../../models/book-config.model';
import { AgentType, GenerationStatus, BookState, GenerationStats } from '../../models/book-state.model';
import { ChapterDraft } from '../../models/chapter.model';
import { TranslationService } from '../../i18n/translation.service';

@Component({
  selector: 'app-generator',
  templateUrl: './generator.component.html',
  styleUrls: ['./generator.component.scss'],
  imports: [CommonModule]
})
export class GeneratorComponent implements OnInit, OnDestroy {
  protected translationService = inject(TranslationService);
  
  bookState$: Observable<BookState>;
  activeAgent$: Observable<AgentType | null>;
  status$: Observable<GenerationStatus>;
  chapters$: Observable<any[]>;
  currentDraft$: Observable<ChapterDraft | null>;
  skippedChapters$: Observable<number[]>;
  errorCount$: Observable<number>;
  retryCount$: Observable<number>;

  // Live-stream preview. `liveLines$` drives the monospace box in
  // the template; `liveTokenRate` is a plain number field updated
  // by the 1Hz throttled observable so the chip interpolates without
  // needing an async pipe inside its expression. `liveStreamAgent`
  // and `liveTokensApprox` are mirrors of the book-state fields the
  // template binds to.
  liveLines$: Observable<string[]> = of([]);
  liveTokenRate: number = 0;
  liveStreamAgent: AgentType | null = null;
  liveTokensApprox: number = 0;
  liveErrorCount: number = 0;
  liveRetryCount: number = 0;

  private subscription: Subscription = new Subscription();
  private generationSubscription: Subscription = new Subscription();
  private retrySubscription: Subscription = new Subscription();
  private savedConfig: BookConfig | null = null;
  private elapsedTimeInterval: any;
  private currentSkippedChapters: number[] = [];

  // Last chapter number observed in the bookState$ subscription. The
  // component compares the incoming `currentChapterNumber` against
  // this on every tick; when it changes (null → 1, 1 → 2, …) the
  // pipeline cards reset to idle so a finished chapter's green
  // borders don't mask the next chapter's progress.
  private lastSeenChapterNumber: number | null = null;

  // UI State
  isGenerating = false;
  showStopButton = false;
  currentChapterProgress = 0;
  hasConfig = false;
  currentStatus: GenerationStatus = 'idle';
  chaptersCount = 0;

  // Stats state
  generationStats: GenerationStats | null = null;
  elapsedSeconds = 0;
  isCompleted = false;

  // Ordered list of agents in the pipeline. Single source of truth for
  // the horizontal agent cards in the template, so reordering happens in
  // one place and the connector arrow logic just walks the array.
  pipelineAgents: AgentType[] = [
    'architect', 'author', 'critic', 'reviser', 'character', 'continuity'
  ];

  // Agent states for UI
  agentStates = {
    architect: { status: 'idle', active: false },
    author: { status: 'idle', active: false },
    critic: { status: 'idle', active: false },
    reviser: { status: 'idle', active: false },
    character: { status: 'idle', active: false },
    continuity: { status: 'idle', active: false }
  };

  constructor(
    private bookStateService: BookStateService,
    private orchestratorService: OrchestratorService,
    private apiService: ApiService,
    private providerService: ProviderService,
    private router: Router
  ) {
    this.bookState$ = this.bookStateService.getState$();
    // Initialise in the constructor so the template binding has a
    // non-null observable even before ngOnInit runs (the existing
    // test setup constructs the component directly without invoking
    // Angular's lifecycle hooks). The observable is a lazy reference
    // to the service method — no work happens until a subscriber
    // attaches.
    this.liveLines$ = this.bookStateService.getLiveStreamLines$();
    this.activeAgent$ = this.bookStateService.getActiveAgent$();
    this.status$ = this.bookStateService.getStatus$();
    this.chapters$ = this.bookStateService.getChapters$();
    this.currentDraft$ = this.bookStateService.getCurrentDraft$();
    this.skippedChapters$ = this.bookStateService.getState$().pipe(
      map((s: BookState) => s.skippedChapters ?? [])
    );
    this.errorCount$ = this.bookStateService.getErrorCount$();
    this.retryCount$ = this.bookStateService.getRetryCount$();
  }

  ngOnInit(): void {
    // Load saved config but don't auto-start
    const savedConfig = localStorage.getItem('book-config');
    if (!savedConfig) {
      this.router.navigate(['/config']);
      return;
    }

    this.savedConfig = JSON.parse(savedConfig);
    
    // Always use the selected model from the active provider config, or default
    // This ensures the user sees what they actually selected in settings
    const selectedModel = this.providerService.getSelectedModel();
    if (this.savedConfig) {
      this.savedConfig.model = selectedModel || this.apiService.getDefaultModel().id;
      // Update localStorage with the correct model
      localStorage.setItem('book-config', JSON.stringify(this.savedConfig));
    }
    
    this.hasConfig = true;

    // Subscribe to status updates for the next button logic
    this.subscription.add(
      this.status$.subscribe(status => {
        this.currentStatus = status;
        this.isCompleted = status === 'completed';
        
        // Stop elapsed time counter when done or error
        if (status === 'completed' || status === 'error') {
          this.stopElapsedTimer();
        }
      })
    );

    // Subscribe to chapters updates for the next button logic
    this.subscription.add(
      this.chapters$.subscribe(chapters => {
        this.chaptersCount = chapters?.length || 0;
      })
    );

    // Mirror skippedChapters onto a local field so the retry
    // button's click handler knows what to pass. The banner reads
    // it through the async pipe directly from `skippedChapters$`,
    // but the click handler is a synchronous method call.
    this.subscription.add(
      this.skippedChapters$.subscribe(skipped => {
        this.currentSkippedChapters = skipped ?? [];
      })
    );

    // Mirror the live error/retry counters so the chips in the
    // live output card update without an extra async pipe inside
    // their `@if` expressions. Both fields are 0 while nothing is
    // happening and tick up as the orchestrator reports failures
    // and retries during the run.
    this.subscription.add(
      this.errorCount$.subscribe(n => { this.liveErrorCount = n; })
    );
    this.subscription.add(
      this.retryCount$.subscribe(n => { this.liveRetryCount = n; })
    );

    // Subscribe to stats updates
    this.subscription.add(
      this.bookStateService.getStats$().subscribe(stats => {
        this.generationStats = stats;
      })
    );

    // Live stream — drive the new preview card. Rate is
    // 1Hz-throttled internally so we don't recompute on every SSE
    // delta. `liveLines$` is initialised in the constructor so the
    // template binding has a real observable from the start.
    this.subscription.add(
      this.bookStateService.getLiveTokenRate$().subscribe(rate => {
        this.liveTokenRate = rate;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.generationSubscription.unsubscribe();
    this.retrySubscription.unsubscribe();
    this.stopElapsedTimer();
  }

  onGenerateClick(): void {
    if (this.savedConfig) {
      this.startGeneration(this.savedConfig);
    }
  }

  startGeneration(config: BookConfig): void {
    this.isGenerating = true;
    this.showStopButton = true;
    this.isCompleted = false;
    this.elapsedSeconds = 0;
    // Re-arm the chapter-boundary detector for a fresh run. Without
    // this, a re-run that starts on chapter 1 wouldn't see `null → 1`
    // as a change (lastSeenChapterNumber would still be 1 from the
    // previous run's last tick) and the pipeline cards wouldn't
    // reset before chapter 1 starts.
    this.lastSeenChapterNumber = null;

    // Start elapsed time counter
    this.startElapsedTimer();

    this.generationSubscription = this.orchestratorService.orchestrate(config).subscribe({
      next: (result) => {
        console.log('Generation completed:', result);
        this.isGenerating = false;
        this.showStopButton = false;
        this.isCompleted = true;
        this.stopElapsedTimer();
      },
      error: (error) => {
        console.error('Generation failed:', error);
        this.isGenerating = false;
        this.showStopButton = false;
        this.isCompleted = true;
        this.stopElapsedTimer();
      }
    });

    // Subscribe to state changes for UI updates
    this.subscription.add(
      this.bookState$.subscribe(state => {
        // Live stream preview fields mirror the book state directly
        // — the template binds to them, and the visibility @if reads
        // `liveStreamAgent` for the tail-window after endStream$.
        this.liveStreamAgent = state.liveStreamAgent;
        this.liveTokensApprox = state.liveTokensApprox;

        // Detect a chapter boundary before any per-agent update so
        // the new active agent (typically 'author') lands on a clean
        // `running` slot instead of a stale `done` from the previous
        // chapter. The reset itself is a no-op for the very first
        // chapter (cards already start idle), but we run it anyway
        // to keep the logic uniform — only the number matters.
        if (state.currentChapterNumber !== this.lastSeenChapterNumber) {
          this.resetAgentStatesForNewChapter();
          this.lastSeenChapterNumber = state.currentChapterNumber;
          // The `activeAgent` in this tick is still the *previous*
          // chapter's last-running agent (e.g. 'continuity' from
          // chapter 1) — the orchestrator hasn't fired its
          // `setActiveAgent('author')` for the new chapter yet; that
          // arrives on the very next emission, synchronously after
          // `setCurrentChapter`. If we ran `updateAgentStates` here,
          // the stale agent would be briefly promoted to `running`
          // (and then immediately demoted to `done` on the next
          // tick), making the row flicker for a frame. Skip the
          // per-agent update on this tick — the next one will set
          // the right agent. Progress still advances.
          this.updateProgress(state);
          return;
        }
        this.updateAgentStates(state.activeAgent, state.status);
        this.updateProgress(state);
      })
    );
  }

  stopGeneration(): void {
    // Tell the orchestrator to tear down (sets stopped flag,
    // clears retry timers, unsubscribes the inner pipeline). The
    // unsubscribes are belt-and-braces — stop() also unsubscribes
    // its tracked subscription, so even if the orchestrator's
    // internal handle is somehow stale the outer subscription here
    // is still released.
    this.orchestratorService.stop();
    if (this.generationSubscription) {
      this.generationSubscription.unsubscribe();
    }
    // The retry path doesn't reuse `currentSubscription` inside the
    // orchestrator (per the targeted-fix design choice), so this
    // component-side handle is the only way to actually cancel an
    // in-flight retry that Stop was clicked during.
    if (this.retrySubscription) {
      this.retrySubscription.unsubscribe();
    }
    this.isGenerating = false;
    this.showStopButton = false;
    this.stopElapsedTimer();
  }

  retrySkippedChapters(): void {
    if (this.isGenerating) {
      // Two orchestrator instances fighting over state is the
      // failure mode the plan flagged — refuse to start a retry
      // while a run is already in progress.
      return;
    }
    if (!this.savedConfig) {
      return;
    }
    const numbers = this.currentSkippedChapters.filter(n => typeof n === 'number' && n > 0);
    if (numbers.length === 0) {
      return;
    }

    this.isGenerating = true;
    this.showStopButton = true;
    this.elapsedSeconds = 0;
    this.startElapsedTimer();
    // Re-arm the chapter-boundary detector so the first retry
    // chapter (e.g. 3) is treated as a fresh transition. Without
    // this, the previous manual run's last `currentChapterNumber`
    // would still be cached and the retry would skip the
    // pipeline-card reset.
    this.lastSeenChapterNumber = null;

    this.retrySubscription = this.orchestratorService.retryChapters(numbers, this.savedConfig).subscribe({
      next: () => {
        // Retry Observable completes after every requested chapter
        // has run. The final state of `currentSkippedChapters`
        // (those that still failed) is updated by the orchestrator
        // and reflected on the next tick of `skippedChapters$`.
      },
      error: (error) => {
        console.error('Retry run failed:', error);
      },
      complete: () => {
        this.isGenerating = false;
        this.showStopButton = false;
        this.stopElapsedTimer();
        // `currentSkippedChapters` is already current via the
        // `skippedChapters$` subscription — the banner re-renders
        // automatically. `isCompleted` is set on the `status$`
        // subscription (status flips to `completed`/`error` inside
        // the orchestrator's retryChapters finalize helper).
      }
    });
  }

  navigateBack(): void {
    // Go back to the last step of the config (Review). The user
    // reached the generator by completing the full wizard, so
    // dropping them on step 1 would force them to re-walk all four
    // steps just to tweak something. The config page reads the
    // `step` query param and jumps directly there.
    this.router.navigate(['/config'], { queryParams: { step: 4 } });
  }

  navigateNext(): void {
    // Navigate to viewer page to read generated chapters
    this.router.navigate(['/viewer']);
  }

  isGenerationCompleted(): boolean {
    // Check if generation is complete - status is 'completed' and we have chapters
    const status = this.currentStatus;
    const hasChapters = this.chaptersCount > 0;
    return status === 'completed' && hasChapters;
  }

  /**
   * Wipe every per-chapter pipeline card back to its idle visual
   * state. Called from the bookState$ subscription when
   * `currentChapterNumber` changes — the chapter-boundary signal
   * from the orchestrator. After this returns the very same tick
   * would normally promote the new active agent to `running` via
   * `updateAgentStates`, but the caller now skips that on the
   * boundary tick (the `activeAgent` in that emission is still the
   * previous chapter's last agent, not the new one — the orchestrator
   * fires its `setActiveAgent('author')` for the new chapter on the
   * next emission).
   *
   * `architect` is intentionally preserved: it only ever runs once,
   * during the blueprint pass before chapter 1. Resetting it on
   * every boundary would un-green the card between chapters and
   * suggest the agent still has work to do. New object literals
   * (not in-place mutation) match the existing pattern in
   * `updateAgentStates` and let Angular's change detection see the
   * change even without zone microtask interleaving.
   */
  private resetAgentStatesForNewChapter(): void {
    Object.keys(this.agentStates).forEach(key => {
      const k = key as AgentType;
      if (k === 'architect') return;
      this.agentStates[k] = { status: 'idle', active: false };
    });
  }

  private updateAgentStates(activeAgent: AgentType | null, status: GenerationStatus): void {
    // When the whole book is done, every agent that ran should be
    // shown as done with a green check — otherwise the pipeline
    // looks like the agents never worked. The orchestrator never
    // explicitly clears `activeAgent` on completion, so the
    // "reset all then set the active one" logic below would
    // leave 5 of 6 agents stuck on idle after a successful run.
    if (status === 'completed') {
      Object.keys(this.agentStates).forEach(key => {
        this.agentStates[key as AgentType] = { status: 'done', active: false };
      });
      return;
    }

    // While the run is in progress, the *currently* active agent is
    // the only one that's running. Earlier agents should already
    // show as 'done' from previous ticks, and later ones are still
    // 'idle'. We only need to (a) promote the new active agent to
    // 'running' and (b) demote any *other* agent that was running
    // last tick to 'done', because the orchestrator doesn't emit
    // an explicit "agent X just finished" event — it just sets the
    // next activeAgent. The previous branch handles the
    // status==='completed' flush; here we just do a soft update so
    // we don't lose the 'done' state of agents that already ran.
    if (activeAgent) {
      // Demote anyone who was previously active — they finished.
      Object.keys(this.agentStates).forEach(key => {
        const k = key as AgentType;
        if (k !== activeAgent && this.agentStates[k].active) {
          this.agentStates[k] = { status: 'done', active: false };
        }
      });
      this.agentStates[activeAgent] = { status: 'running', active: true };
    }
  }

  private updateProgress(state: any): void {
    // Update progress based on overall chapter completion
    const totalChapters = state.blueprint?.chapters?.length || 1;
    const completedChapters = state.chapters.length;
    const progress = Math.floor((completedChapters / totalChapters) * 100);
    
    // Update the UI progress bar with overall chapter completion
    this.currentChapterProgress = progress;
    
    console.log(`Progress: ${completedChapters}/${totalChapters} chapters (${progress}%)`);
  }

  private startElapsedTimer(): void {
    this.stopElapsedTimer();
    this.elapsedTimeInterval = setInterval(() => {
      this.elapsedSeconds++;
    }, 1000);
  }

  private stopElapsedTimer(): void {
    if (this.elapsedTimeInterval) {
      clearInterval(this.elapsedTimeInterval);
      this.elapsedTimeInterval = null;
    }
  }

  // Utility methods for template
  getAgentStatus(agent: AgentType): string {
    return this.agentStates[agent].status;
  }

  isAgentActive(agent: AgentType): boolean {
    return this.agentStates[agent].active;
  }

  getAgentClass(agent: AgentType): string {
    const state = this.agentStates[agent];
    if (state.active) {
      return 'border-accent-500 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm shadow-accent-500/20';
    }
    return 'border-gray-300 bg-white text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300';
  }

  getAgentChipClass(agent: AgentType): string {
    const state = this.agentStates[agent];
    if (state.active) {
      return 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white';
    }
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  }

  isLastAgent(agent: AgentType): boolean {
    const agentOrder: AgentType[] = ['architect', 'author', 'critic', 'reviser', 'character', 'continuity'];
    return agentOrder.indexOf(agent) === agentOrder.length - 1;
  }

  formatStatus(status: GenerationStatus | null): string {
    if (!status) return this.t('status.idle');
    switch (status) {
      case 'writing': return this.t('status.writing');
      case 'critiquing': return this.t('status.critiquing') || 'Critiquing';
      case 'revising': return this.t('status.revising') || 'Revising';
      case 'generating': return this.t('status.generating');
      case 'translating': return this.t('status.translating') || 'Translating';
      default: return status.charAt(0).toUpperCase() + status.slice(1);
    }
  }
  
  isWriting(status: GenerationStatus | null): boolean {
    return status === 'writing';
  }

  // Stats formatting methods
  formatElapsedTime(): string {
    const hours = Math.floor(this.elapsedSeconds / 3600);
    const minutes = Math.floor((this.elapsedSeconds % 3600) / 60);
    const seconds = this.elapsedSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  formatNumber(num: number): string {
    return num.toLocaleString();
  }

  getAgentDisplayName(agent: AgentType): string {
    const names: Record<AgentType, string> = {
      architect: this.t('generator.architect'),
      author: this.t('generator.author'),
      critic: this.t('generator.critic'),
      reviser: this.t('generator.reviser'),
      character: this.t('generator.character'),
      continuity: this.t('generator.continuity')
    };
    return names[agent] || agent;
  }

  getAgentsWithStats(): AgentType[] {
    if (!this.generationStats) return [];
    return ['architect', 'author', 'critic', 'reviser', 'character', 'continuity'].filter(agent => {
      const stats = this.generationStats!.agentStats[agent as AgentType];
      return stats && (stats.calls > 0 || stats.totalTokens > 0);
    }) as AgentType[];
  }

  // Translation helper
  t(key: string): string {
    return this.translationService.get(key);
  }
}
