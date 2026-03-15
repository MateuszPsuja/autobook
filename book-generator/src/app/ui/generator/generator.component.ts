import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription, Observable, interval } from 'rxjs';
import { BookStateService } from '../../book/state/book-state.service';
import { OrchestratorService } from '../../book/orchestrator/orchestrator.service';
import { ApiService } from '../../core/api.service';
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

  private subscription: Subscription = new Subscription();
  private generationSubscription: Subscription = new Subscription();
  private savedConfig: BookConfig | null = null;
  private elapsedTimeInterval: any;

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
    private router: Router
  ) {
    this.bookState$ = this.bookStateService.getState$();
    this.activeAgent$ = this.bookStateService.getActiveAgent$();
    this.status$ = this.bookStateService.getStatus$();
    this.chapters$ = this.bookStateService.getChapters$();
    this.currentDraft$ = this.bookStateService.getCurrentDraft$();
  }

  ngOnInit(): void {
    // Load saved config but don't auto-start
    const savedConfig = localStorage.getItem('book-config');
    if (!savedConfig) {
      this.router.navigate(['/config']);
      return;
    }

    this.savedConfig = JSON.parse(savedConfig);
    
    // Always use the selected model from localStorage, or default
    // This ensures the user sees what they actually selected in settings
    const selectedModel = localStorage.getItem('selected-model');
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

    // Subscribe to stats updates
    this.subscription.add(
      this.bookStateService.getStats$().subscribe(stats => {
        this.generationStats = stats;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.generationSubscription.unsubscribe();
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
        this.updateAgentStates(state.activeAgent, state.status);
        this.updateProgress(state);
      })
    );
  }

  stopGeneration(): void {
    this.orchestratorService.stop();
    this.isGenerating = false;
    this.showStopButton = false;
    this.stopElapsedTimer();
  }

  navigateBack(): void {
    // Navigate to config page
    this.router.navigate(['/config']);
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

  private updateAgentStates(activeAgent: AgentType | null, status: GenerationStatus): void {
    // Reset all agent states
    Object.keys(this.agentStates).forEach(key => {
      this.agentStates[key as AgentType] = { status: 'idle', active: false };
    });

    // Set active agent state
    if (activeAgent) {
      this.agentStates[activeAgent] = { 
        status: status === 'writing' ? 'running' : 'done', 
        active: true 
      };
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
      return 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300';
    }
    return 'border-gray-300 bg-white text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300';
  }

  getAgentChipClass(agent: AgentType): string {
    const state = this.agentStates[agent];
    if (state.active) {
      return 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300';
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
