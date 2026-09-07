import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { GeneratorComponent } from './generator.component';
import { BookStateService } from '../../book/state/book-state.service';
import { OrchestratorService } from '../../book/orchestrator/orchestrator.service';
import { ApiService } from '../../core/api.service';
import { ProviderService } from '../../core/providers/provider.service';
import { TranslationService } from '../../i18n/translation.service';
import { BookState, AgentType } from '../../models/book-state.model';

describe('GeneratorComponent', () => {
  it('should be truthy', () => {
    expect(GeneratorComponent).toBeTruthy();
  });

  describe('chapter-boundary pipeline reset', () => {
    /**
     * Build the bare-minimum set of stubs the component needs to
     * construct without crashing and to let `startGeneration()` wire
     * up its `bookState$` subscription. `startGeneration` calls
     * `orchestratorService.orchestrate(config)` immediately, so we
     * stub that to return a one-shot `of(null)` Observable that the
     * outer subscribe just treats as "generation done".
     */
    function setup() {
      const initialState = {
        currentChapterNumber: null,
        activeAgent: null,
        status: 'idle',
        chapters: [],
        blueprint: null,
        config: {} as any,
        currentDraft: null,
        characterStore: {},
        worldStateDoc: '',
        critique: null,
        revisionCount: 0,
        continuityFlags: [],
        error: null,
        skippedChapters: [],
        stats: {
          startTime: null,
          endTime: null,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalWords: 0,
          agentStats: {
            architect: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            author: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            critic: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            reviser: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            character: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            continuity: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
          }
        },
        liveStream: '',
        liveStreamAgent: null,
        liveStreamStartedAt: null,
        liveTokensApprox: 0
      } as BookState;
      const stateSubject = new BehaviorSubject<BookState>(initialState);

      const bookStateService = {
        getState$(): BehaviorSubject<BookState> { return stateSubject; },
        getActiveAgent$: () => stateSubject.asObservable(),
        getStatus$: () => stateSubject.asObservable(),
        getChapters$: () => stateSubject.asObservable(),
        getCurrentDraft$: () => stateSubject.asObservable(),
        getStats$: () => stateSubject.asObservable(),
        getLiveStreamLines$: () => stateSubject.pipe(map(s => {
          const text = s.liveStream ?? '';
          const lastNl = text.lastIndexOf('\n');
          const completed = lastNl >= 0 ? text.slice(0, lastNl) : '';
          return completed.split('\n').map(l => l.trim()).filter(l => l.length > 0).slice(-6);
        })),
        getLiveTokenRate$: () => of(0),
        patch: (p: Partial<BookState>) => {
          stateSubject.next({ ...stateSubject.value, ...p });
        }
      } as unknown as BookStateService;

      const orchestratorService = {
        orchestrate: () => of(null),
        stop: () => {}
      } as unknown as OrchestratorService;

      const apiService = {
        getDefaultModel: () => ({ id: 'test-model' })
      } as unknown as ApiService;

      const providerService = {
        getSelectedModel: () => null
      } as unknown as ProviderService;

      const router = {
        navigate: () => Promise.resolve(true)
      };

      const translationService = {
        get: (key: string) => key
      } as unknown as TranslationService;

      const component = TestBed.runInInjectionContext(() => new GeneratorComponent(
        bookStateService,
        orchestratorService,
        apiService,
        providerService,
        router as any
      ));
      // `translationService` is set via inject() inside the class
      // body, not the constructor. With `runInInjectionContext` we
      // get a real Angular DI context for it, but our stub still
      // needs to override the field afterwards — the test bed only
      // has the real TranslationService, not our key-passthrough one.
      (component as any).translationService = translationService;

      return { component, stateSubject, bookStateService };
    }

    function pushState(stateSubject: BehaviorSubject<BookState>, patch: Partial<BookState>) {
      stateSubject.next({ ...stateSubject.value, ...patch });
    }

    /**
     * Simulate the orchestrator's two-step chapter-start: first it
     * stamps `setCurrentChapter(n)` (chapter-boundary tick that
     * triggers the component's reset), then `writeChapterWithRetry`
     * synchronously fires `setActiveAgent('author')` on the next
     * emission (the tick that actually promotes `author` to running).
     * The orchestrator pairs them; tests should too — pushing them
     * as one combined state would skip the reset path entirely.
     */
    function startChapter(
      stateSubject: BehaviorSubject<BookState>,
      chapterNumber: number,
      previousActiveAgent: AgentType | null
    ) {
      pushState(stateSubject, {
        currentChapterNumber: chapterNumber,
        activeAgent: previousActiveAgent
      });
      pushState(stateSubject, {
        currentChapterNumber: chapterNumber,
        activeAgent: 'author',
        status: 'writing'
      });
    }

    it('keeps cards idle when chapter 1 starts with author as active agent', () => {
      const { component, stateSubject } = setup();

      component.startGeneration({} as any);

      // The orchestrator stamps `setActiveAgent('author')` for
      // chapter 1 *before* the chapter loop runs (it does so right
      // after the blueprint completes). So when the chapter-1
      // boundary tick fires, the previous activeAgent is already
      // `author`, not `architect`.
      startChapter(stateSubject, 1, 'author');

      expect(component.agentStates.author.status).toBe('running');
      expect(component.agentStates.author.active).toBe(true);
      expect(component.agentStates.architect.status).toBe('idle');
      expect(component.agentStates.critic.status).toBe('idle');
      expect(component.agentStates.reviser.status).toBe('idle');
      expect(component.agentStates.character.status).toBe('idle');
      expect(component.agentStates.continuity.status).toBe('idle');
    });

    it('preserves architect as done across the chapter-1 boundary after the blueprint', () => {
      const { component, stateSubject } = setup();

      component.startGeneration({} as any);

      // Blueprint phase: architect runs, then the orchestrator
      // demotes it and promotes author before chapter 1 starts.
      pushState(stateSubject, { activeAgent: 'architect', status: 'generating' });
      pushState(stateSubject, { activeAgent: 'author', status: 'generating' });
      expect(component.agentStates.architect.status).toBe('done');

      // Chapter 1 boundary tick. The reset MUST NOT wipe architect's
      // done state — architect only ever runs once, so its card
      // should stay green throughout the whole generation.
      startChapter(stateSubject, 1, 'author');

      expect(component.agentStates.architect.status).toBe('done');
      expect(component.agentStates.author.status).toBe('running');
      expect(component.agentStates.critic.status).toBe('idle');
      expect(component.agentStates.continuity.status).toBe('idle');
    });

    it('resets all per-chapter cards to idle when chapter number advances to 2', () => {
      const { component, stateSubject } = setup();

      component.startGeneration({} as any);

      // Blueprint phase: architect runs, gets demoted to done.
      pushState(stateSubject, { activeAgent: 'architect', status: 'generating' });
      pushState(stateSubject, { activeAgent: 'author', status: 'generating' });

      // Chapter 1: author runs, then a flurry of agent flips walks
      // the cards through to "done". We end with continuity active,
      // matching the orchestrator's real end-of-chapter state.
      startChapter(stateSubject, 1, 'author');
      pushState(stateSubject, { currentChapterNumber: 1, activeAgent: 'critic', status: 'critiquing' });
      pushState(stateSubject, { currentChapterNumber: 1, activeAgent: 'reviser', status: 'revising' });
      pushState(stateSubject, { currentChapterNumber: 1, activeAgent: 'character', status: 'generating' });
      pushState(stateSubject, { currentChapterNumber: 1, activeAgent: 'continuity', status: 'generating' });

      // End of chapter 1: architect stays done (only runs once),
      // everyone else who ran is done, continuity is still running.
      expect(component.agentStates.architect.status).toBe('done');
      expect(component.agentStates.author.status).toBe('done');
      expect(component.agentStates.critic.status).toBe('done');
      expect(component.agentStates.reviser.status).toBe('done');
      expect(component.agentStates.character.status).toBe('done');
      expect(component.agentStates.continuity.status).toBe('running');

      // Chapter 2 boundary tick. The component must:
      //   (a) preserve architect as done (only runs once),
      //   (b) NOT briefly promote the stale `continuity` (the
      //       previous chapter's last activeAgent) to running — the
      //       boundary tick skips updateAgentStates and waits for
      //       the next emission, which sets activeAgent='author',
      //   (c) wipe author/critic/reviser/character/continuity to idle.
      startChapter(stateSubject, 2, 'continuity');

      expect(component.agentStates.architect.status).toBe('done');
      expect(component.agentStates.author.status).toBe('running');
      expect(component.agentStates.author.active).toBe(true);
      expect(component.agentStates.critic.status).toBe('idle');
      expect(component.agentStates.reviser.status).toBe('idle');
      expect(component.agentStates.character.status).toBe('idle');
      expect(component.agentStates.continuity.status).toBe('idle');
      expect(component.agentStates.continuity.active).toBe(false);
    });

    it('does not reset cards within the same chapter (only on boundary change)', () => {
      const { component, stateSubject } = setup();

      component.startGeneration({} as any);

      startChapter(stateSubject, 1, 'author');
      expect(component.agentStates.author.status).toBe('running');

      // Same chapter, agent transitions from author → critic. The
      // author card should transition to `done` (the existing
      // updateAgentStates demotion logic), NOT reset to idle.
      pushState(stateSubject, { currentChapterNumber: 1, activeAgent: 'critic', status: 'critiquing' });
      expect(component.agentStates.author.status).toBe('done');
      expect(component.agentStates.critic.status).toBe('running');
    });

    describe('live-stream card visibility', () => {
      /**
       * The card visibility rule in the template is
       *   `@if (isGenerating || liveStreamAgent)`.
       * The template binding (`liveStreamAgent` field) is updated
       * inside the `bookState$` subscription in `startGeneration()`,
       * and the per-emission mirroring is structurally identical to
       * the existing `agentStates` updates that the chapter-boundary
       * tests above already exercise — both subscriptions live in
       * the same place and read the same observable. So instead of
       * a second near-duplicate test, we focus here on the bits the
       * chapter-boundary tests can't reach:
       *
       *  - `liveLines$` is exposed and emits the last 6 non-empty
       *    lines of the live stream (with the partial tail dropped
       *    so the box doesn't show a "fake line" caret).
       *
       * The state behaviour (`beginStream$` / `endStream$` /
       * `clearLiveStreamBuffer` / 2s tail-window timer) is covered
       * directly in `book-state.service.spec.ts` against the real
       * service.
       */
      it('exposes liveLines$ derived from the liveStream buffer (last 6 non-empty lines)', (done) => {
        const { component, stateSubject } = setup();

        // Six completed lines plus a partial tail that must NOT appear
        // (the live card drops the mid-line tail so the box doesn't
        // show a "fake line" caret). After the newline, the partial
        // text remains in `liveStream` but only completed lines render.
        const completedLines = 'alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot\n';
        pushState(stateSubject, {
          liveStream: completedLines + 'golf partial'
        });

        const collected: string[][] = [];
        const sub = component.liveLines$.subscribe((lines: string[]) => collected.push(lines));
        setTimeout(() => {
          sub.unsubscribe();
          const last = collected[collected.length - 1];
          expect(last).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']);
          done();
        }, 0);
      });
    });
  });
});
