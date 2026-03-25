import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { BookState, AgentType, GenerationStatus, GenerationStats, createInitialStats } from '../../models/book-state.model';
import { BookConfig } from '../../models/book-config.model';

@Injectable({
  providedIn: 'root'
})
export class BookStateService {
  private initialState: BookState = {
    config: {} as BookConfig,
    blueprint: null,
    chapters: [],
    currentDraft: null,
    characterStore: {},
    worldStateDoc: '',
    critique: null,
    revisionCount: 0,
    continuityFlags: [],
    activeAgent: null,
    status: 'idle',
    error: null,
    stats: createInitialStats()
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
}
