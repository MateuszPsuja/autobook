import { Injectable } from '@angular/core';
import { Observable, Subscription, throwError } from 'rxjs';
import { switchMap, catchError, map } from 'rxjs/operators';
import { BookStateService } from '../state/book-state.service';
import { ArchitectService } from '../agents/architect.service';
import { AuthorService } from '../agents/author.service';
import { CriticService } from '../agents/critic.service';
import { CharacterService } from '../agents/character.service';
import { ContinuityService } from '../agents/continuity.service';
import { BookConfig } from '../../models/book-config.model';
import { Blueprint, AgentType, GenerationStatus } from '../../models/book-state.model';
import { ChapterBrief, CriticContext, AuthorStyleContext } from '../../models/book-state.model';
import { ChapterDraft, Chapter } from '../../models/chapter.model';
import { PersistenceService } from '../../core/persistence.service';
import { ProviderService } from '../../core/providers/provider.service';
import { endsWithSentenceTerminator } from '../../shared/utils/chapter-cleanup';

@Injectable({
  providedIn: 'root'
})
export class OrchestratorService {
  /**
   * The currently-running inner subscription, if any. Stored so
   * `stop()` can unsubscribe it. Without this, clicking Stop only
   * flipped status flags while the orchestrator kept firing API
   * requests on the next tick.
   */
  private currentSubscription: Subscription | null = null;

  /**
   * Every `setTimeout` handle the orchestrator creates (retry
   * timers, the timer in `writeChapterWithRetry`, and the one in
   * `handleRevision`). All cleared on stop/unsubscribe so a
   * pending retry can't fire after the user cancelled.
   */
  private pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  /**
   * `true` once `stop()` has been called for the current run.
   * Checked at every timer-fire boundary so a timer that was
   * already in the event loop when stop was called still no-ops
   * instead of issuing a wasted API request.
   */
  private stopped: boolean = false;

  constructor(
    private bookStateService: BookStateService,
    private architectService: ArchitectService,
    private authorService: AuthorService,
    private criticService: CriticService,
    private characterService: CharacterService,
    private continuityService: ContinuityService,
    private persistenceService: PersistenceService,
    private providerService: ProviderService
  ) {}

  /**
   * Start the book generation process
   */
  orchestrate(config: BookConfig): Observable<any> {
    // Reset the stop/lifecycle flags for a fresh run. A previous
    // run may have left `stopped = true` and timers in the set.
    this.stopped = false;
    this.clearAllTimers();
    if (this.currentSubscription) {
      // A previous run is still in flight (caller didn't unsubscribe
      // before starting a new one). Tear it down so two pipelines
      // don't fight over the same state.
      this.currentSubscription.unsubscribe();
      this.currentSubscription = null;
    }

    return new Observable(subscriber => {
      // Reset all state before starting new generation
      this.bookStateService.resetStats();
      this.bookStateService.startGenerationTimer();

      this.bookStateService.setConfig(config);
      this.bookStateService.setChapters([]); // Reset chapters
      this.bookStateService.setPrologue(null);
      this.bookStateService.setEpilogue(null);
      this.bookStateService.setCurrentDraft(null);
      this.bookStateService.setCritique(null);
      this.bookStateService.setRevisionCount(0);
      this.bookStateService.setStatus('configuring');
      this.bookStateService.setActiveAgent(null);
      this.bookStateService.setCurrentChapter(null);

      // Start with architect
      this.bookStateService.setActiveAgent('architect');
      this.bookStateService.setStatus('generating');

      this.currentSubscription = this.architectService.generateBlueprintWithUsage(config).pipe(
        switchMap((result) => {
          // Record architect usage
          this.bookStateService.recordAgentUsage('architect', result.usage);
          this.bookStateService.setBlueprint(result.data);
          this.bookStateService.setActiveAgent('author');

          // Prologue → numbered chapters → epilogue. Each section
          // runs the same author → critic → (revise) → character →
          // continuity pipeline. A failure in any section mirrors
          // the per-chapter skip behaviour: log, surface in
          // `state.error`, and continue so the rest of the book
          // still ships.
          return this.processPrologue(result.data, config).pipe(
            switchMap(() => this.processChapters(result.data, config)),
            switchMap(() => this.processEpilogue(result.data, config)),
          );
        }),
        catchError(error => {
          this.bookStateService.incrementErrorCount();
          this.bookStateService.setStatus('error');
          this.bookStateService.setError(error.message);
          return throwError(error);
        })
      ).subscribe({
        next: async () => {
          this.bookStateService.endGenerationTimer();

          // Calculate total words from chapters + prologue + epilogue.
          const state = this.bookStateService.getState();
          const totalWords =
            state.chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0) +
            (state.prologue?.wordCount || 0) +
            (state.epilogue?.wordCount || 0);
          this.bookStateService.updateTotalWords(totalWords);

          // Translation is now an export-time concern, not an
          // orchestrator concern. The user picks a target language
          // in the export tab; the LLM translation pass runs there
          // and ships a localized file. In-state chapters stay in
          // the English the orchestrator produced.

          // If the user stopped mid-pipeline, don't flip the status
          // back to "completed" — they cancelled on purpose and the
          // teardown already marked the run as stopped.
          if (!this.stopped) {
            this.bookStateService.setStatus('completed');
          }
          subscriber.next('Book generation completed');
          subscriber.complete();
        },
        error: (error) => {
          this.bookStateService.endGenerationTimer();
          subscriber.error(error);
        }
      });

      // Teardown: when the caller unsubscribes (or stop() unsubscribes
      // for them), flip the stopped flag and clear every pending
      // retry timer so no API call goes out after teardown.
      return () => {
        this.stopped = true;
        this.clearAllTimers();
        if (this.currentSubscription) {
          this.currentSubscription.unsubscribe();
          this.currentSubscription = null;
        }
      };
    });
  }

  /**
   * Process all chapters in sequence. A single chapter failure no
   * longer aborts the whole book — it logs the error, records the
   * chapter number in `skippedChapters`, and moves on to the next
   * chapter. The final status is `completed` if at least one chapter
   * succeeded; the user can see which chapters were skipped in the
   * state and retry just those.
   */
  private processChapters(blueprint: Blueprint, config: BookConfig): Observable<any> {
    return new Observable(subscriber => {
      const chapters = blueprint.chapters;
      let currentChapterIndex = 0;
      const skippedChapters: number[] = [];
      // Reset any prior skipped list at the start of a new run.
      this.bookStateService.setSkippedChapters([]);

      const processNextChapter = () => {
        if (currentChapterIndex >= chapters.length) {
          if (skippedChapters.length > 0) {
            console.warn(
              `Orchestrator: ${skippedChapters.length} chapter(s) skipped due to errors: ${skippedChapters.join(', ')}`,
            );
            this.bookStateService.setSkippedChapters(skippedChapters);
          } else {
            this.bookStateService.setSkippedChapters([]);
          }
          subscriber.next('All chapters processed');
          subscriber.complete();
          return;
        }

        const chapterBrief = chapters[currentChapterIndex];
        const expectedNumber = currentChapterIndex + 1;
        this.processChapter(chapterBrief, config, expectedNumber, 'chapter').subscribe({
          next: () => {
            currentChapterIndex++;
            processNextChapter();
          },
          error: (error) => {
            console.error(
              `Orchestrator: chapter ${expectedNumber} ("${chapterBrief.title}") failed — skipping and continuing.`,
              error,
            );
            skippedChapters.push(expectedNumber);
            currentChapterIndex++;
            // Continue with the next chapter instead of aborting.
            processNextChapter();
          }
        });
      };

      processNextChapter();
    });
  }

  /**
   * Re-run the per-chapter pipeline for an explicit subset of chapter
   * numbers. Used by the generator UI's "Retry skipped chapters"
   * button: passing `state.skippedChapters` produces a partial run
   * that touches only the holes from a previous attempt.
   *
   * Unlike `orchestrate()`, this method never resets existing
   * approved chapters, prologue, epilogue, blueprint, config, or
   * token-usage stats — the chapter-boundary detector is handled by
   * `lastSeenChapterNumber` in the generator component (reset to
   * `null` at the start of any manual kickoff), not here. Approved
   * chapters from earlier runs keep their content; the retry only
   * overwrites the chapter slots whose number is in `numbers`.
   *
   * `numbers` is filtered to positive integers: prologue and epilogue
   * are not stored in `skippedChapters` (the export gate already
   * filters `n > 0`) so attempting to retry them makes no sense.
   *
   * Mirrors the per-chapter skip rule: a chapter that fails again is
   * appended to the new `skippedChapters`, a chapter that succeeds
   * is left out. After the loop the orchestrator writes the new
   * skipped list and flips status to `error` if anything is still
   * skipped, otherwise `completed` — matching `processChapters`'s
   * "user finds out at export" behaviour.
   *
   * Does NOT touch `OrchestratorService.currentSubscription`. The
   * outer caller is responsible for unsubscribing (same pattern as
   * `orchestrate`); `stop()` still clears pending timers and flips
   * `stopped`, and the per-chapter pipeline checks `stopped` at
   * every retry boundary, so a Stop mid-retry can't issue fresh
   * API calls.
   */
  retryChapters(numbers: number[], config: BookConfig): Observable<any> {
    return new Observable(subscriber => {
      this.stopped = false;
      this.clearAllTimers();

      const targets = (numbers ?? [])
        .filter(n => typeof n === 'number' && n > 0)
        .slice()
        .sort((a, b) => a - b);

      if (targets.length === 0) {
        subscriber.next('No skipped chapters to retry');
        subscriber.complete();
        return;
      }

      const blueprint = this.bookStateService.getState().blueprint;
      if (!blueprint) {
        subscriber.error(new Error('No blueprint available; cannot retry chapters.'));
        return;
      }

      this.bookStateService.startGenerationTimer();
      this.bookStateService.setStatus('generating');
      this.bookStateService.setActiveAgent(null);

      const stillSkipped: number[] = [];
      let cursor = 0;

      const processNext = () => {
        if (this.stopped) {
          finalize(true);
          subscriber.next('Retry run stopped');
          subscriber.complete();
          return;
        }
        if (cursor >= targets.length) {
          finalize(false);
          subscriber.next('Retry run completed');
          subscriber.complete();
          return;
        }

        const chapterNumber = targets[cursor];
        const brief = blueprint.chapters.find(b => b.number === chapterNumber);

        if (!brief) {
          stillSkipped.push(chapterNumber);
          cursor++;
          processNext();
          return;
        }

        this.runSectionPipeline(brief, config, 'chapter', chapterNumber, 'replace').subscribe({
          next: () => {
            cursor++;
            processNext();
          },
          error: (error) => {
            console.error(
              `Orchestrator: retry for chapter ${chapterNumber} failed — keeping on skipped list.`,
              error?.message || error,
            );
            stillSkipped.push(chapterNumber);
            cursor++;
            processNext();
          }
        });
      };

      const finalize = (wasStopped: boolean) => {
        this.bookStateService.setSkippedChapters(stillSkipped);
        this.bookStateService.setCurrentChapter(null);
        this.bookStateService.setActiveAgent(null);
        this.bookStateService.endGenerationTimer();
        this.bookStateService.endStream$();
        if (wasStopped) {
          this.bookStateService.setStatus('idle');
        } else {
          this.bookStateService.setStatus(stillSkipped.length === 0 ? 'completed' : 'error');
        }
      };

      processNext();

      return () => {
        this.stopped = true;
        this.clearAllTimers();
        this.bookStateService.endStream$();
      };
    });
  }

  /**
   * Run the prologue through the full pipeline when the architect
   * provided a `prologue` brief. When the brief is absent (user did
   * not opt in, or the architect forgot and the fallback didn't
   * emit one), this is a no-op. Mirrors the per-chapter skip rule
   * on failure: log + record on `state.error`, but don't abort the
   * numbered chapters.
   */
  private processPrologue(blueprint: Blueprint, config: BookConfig): Observable<any> {
    return this.processSectionIfPresent(blueprint.prologue, config, 'prologue');
  }

  /**
   * Symmetric to `processPrologue`. Runs the epilogue pipeline when
   * the architect supplied an `epilogue` brief.
   */
  private processEpilogue(blueprint: Blueprint, config: BookConfig): Observable<any> {
    return this.processSectionIfPresent(blueprint.epilogue, config, 'epilogue');
  }

  /**
   * Shared entry point for any section that may or may not be
   * present in the blueprint. Returns an Observable that completes
   * synchronously with `next()` when the brief is absent, and
   * delegates to `runSectionPipeline` (the shared author → critic
   * → reviser → character → continuity helper) when it is. The
   * helper internally routes the approved draft to the right slot
   * on BookState, so this wrapper just converts pipeline errors
   * into the per-chapter "skip and continue" rule — the rest of
   * the book still ships even if the prologue or epilogue fails.
   */
  private processSectionIfPresent(brief: ChapterBrief | null | undefined, config: BookConfig, slot: 'prologue' | 'epilogue'): Observable<any> {
    if (!brief) {
      return new Observable(sub => { sub.next(null); sub.complete(); });
    }
    return new Observable(subscriber => {
      this.runSectionPipeline(brief, config, slot).subscribe({
        next: (chapter) => {
          subscriber.next(chapter);
          subscriber.complete();
        },
        error: (error) => {
          console.error(
            `Orchestrator: ${slot} ("${brief.title}") failed — skipping and continuing.`,
            error,
          );
          this.bookStateService.setError(
            `${slot} failed: ${(error as Error)?.message || error}. The rest of the book continues.`,
          );
          subscriber.next(null);
          subscriber.complete();
        }
      });
    });
  }

  /**
   * Process a single chapter through the agent pipeline. Delegates
   * to the shared `runSectionPipeline` helper so numbered chapters,
   * the prologue, and the epilogue share one implementation.
   * `slot` is one of `'chapter' | 'prologue' | 'epilogue'` — the
   * helper still writes to the right slot via the orchestrator's
   * `approveChapter` / `approveSection` step.
   */
  private processChapter(brief: ChapterBrief, config: BookConfig, chapterNumber: number, slot: 'chapter' | 'prologue' | 'epilogue' = 'chapter'): Observable<any> {
    return this.runSectionPipeline(brief, config, slot, chapterNumber).pipe(
      map(chapter => ({ kind: 'chapter', chapter })),
    );
  }

  /**
   * Shared per-section pipeline used by numbered chapters, the
   * prologue, and the epilogue. Runs author → critic → (optional
   * revision rounds) → character consistency → continuity, then
   * hands the approved draft to `approveSection` which routes it to
   * the right slot on `BookState`.
   *
   * `slot` distinguishes where the final draft lives:
   *   - 'chapter'   → appended to `state.chapters`
   *   - 'prologue'  → stored on `state.prologue`
   *   - 'epilogue'  → stored on `state.epilogue`
   *
   * `placement` controls how a chapter is appended/replaced when
   * `slot === 'chapter'`:
   *   - 'append'  (default) — new chapter goes at the end.
   *   - 'replace'           — new chapter overwrites the slot for
   *                            `sectionNumber`. Used by `retryChapters`
   *                            so an approved chapter keeps its index
   *                            in the book (chapter 3 stays chapter 3,
   *                            doesn't become chapter 4) and the book
   *                            stays in order without page gaps.
   *
   * Returns the approved `Chapter`. Errors propagate to the caller,
   * who decides whether to skip (the section pipeline mirrors the
   * existing per-chapter skip rule).
   */
  private runSectionPipeline(
    brief: ChapterBrief,
    config: BookConfig,
    slot: 'chapter' | 'prologue' | 'epilogue',
    chapterNumber?: number,
    placement: 'append' | 'replace' = 'append',
  ): Observable<Chapter> {
    // For 'chapter' the caller passes the 1-based number; for
    // prologue/epilogue we use 0 (matches `ChapterBrief.number` from
    // `enforcePrologueEpilogueTitles`). The `expectedNumber` arg to
    // the legacy `processChapter` API still uses the 1-based index,
    // so when the slot is 'chapter' we trust the explicit
    // `chapterNumber` argument.
    const sectionNumber = slot === 'chapter'
      ? (chapterNumber ?? 0)
      : 0;
    return new Observable(subscriber => {
      // Stamp the section number before any agent fires so the UI's
      // pipeline-card reset observes the boundary *before* it sees
      // `activeAgent = 'author'`. Without this the author card
      // could briefly flip done → running within a single render
      // frame.
      this.bookStateService.setCurrentChapter(sectionNumber || null);
      this.writeChapterWithRetry(brief, config, 3).subscribe({
        next: (result) => {
          const { draft, usage } = result;
          this.bookStateService.recordAgentUsage('author', usage);
          this.bookStateService.setCurrentDraft(draft);

          // 2. Critic evaluates the section
          this.bookStateService.setActiveAgent('critic');

          const criticContext: CriticContext = {
            model: config.model,
            chapterBrief: brief,
            chapterContent: draft.content,
            characterState: this.bookStateService.getState().characterStore[brief.povCharacter] || null,
            worldState: this.bookStateService.getState().worldStateDoc,
            previousChapters: this.bookStateService.getState().chapters
          };

          this.criticService.evaluateChapterWithUsage(draft.content, brief, criticContext).subscribe({
            next: (criticResult) => {
              this.bookStateService.recordAgentUsage('critic', criticResult.usage);
              this.bookStateService.setCritique(criticResult.data);

              // 3. Quality gate - check if revision is needed
              if (criticResult.data.overallScore < 7 && this.bookStateService.getState().revisionCount < 3) {
                this.handleRevision(brief, draft, criticResult.data, config).subscribe({
                  next: (revisedDraft) => {
                    // Run character and continuity checks after revision
                    this.runPostRevisionChecks(brief, revisedDraft, config, sectionNumber).subscribe({
                      next: () => {
                        const chapter = this.approveSection(brief, revisedDraft, criticResult.data, sectionNumber, slot, placement);
                        subscriber.next(chapter);
                        subscriber.complete();
                      },
                      error: (err) => subscriber.error(err)
                    });
                  },
                  error: (err) => {
                    subscriber.error(err);
                  }
                });
              } else {
                // Run character and continuity checks even if no revision
                this.runPostRevisionChecks(brief, draft, config, sectionNumber).subscribe({
                  next: () => {
                    const chapter = this.approveSection(brief, draft, criticResult.data, sectionNumber, slot, placement);
                    subscriber.next(chapter);
                    subscriber.complete();
                  },
                  error: (err) => subscriber.error(err)
                });
              }
            },
            error: (err) => {
              subscriber.error(err);
            }
          });
        },
        error: (error) => {
          subscriber.error(error);
        }
      });
    });
  }

  /**
   * Approve a section and route it to the right slot on BookState.
   * Returns the approved `Chapter` so the orchestrator can hand it
   * back to callers that need it (e.g. the persistence save in
   * `approveChapter`). For 'chapter' this appends to `state.chapters`;
   * for prologue/epilogue it stores on `state.prologue` /
   * `state.epilogue`.
   */
  private approveSection(brief: ChapterBrief, draft: ChapterDraft, critique: any, sectionNumber: number, slot: 'chapter' | 'prologue' | 'epilogue', placement: 'append' | 'replace' = 'append'): Chapter {
    const id = slot === 'chapter'
      ? `chapter-${sectionNumber}`
      : slot;
    const title = slot === 'chapter' ? brief.title : (slot === 'prologue' ? 'Prologue' : 'Epilogue');
    const chapter: Chapter = {
      id,
      number: sectionNumber,
      title,
      content: draft.content,
      wordCount: draft.wordCount,
      status: 'approved',
      createdAt: new Date(),
      approvedAt: new Date(),
      critique,
      revisions: []
    };

    const currentState = this.bookStateService.getState();

    if (slot === 'chapter') {
      if (placement === 'replace') {
        const idx = currentState.chapters.findIndex(c => c.number === sectionNumber);
        if (idx >= 0) {
          const updatedChapters = [...currentState.chapters];
          updatedChapters[idx] = chapter;
          this.bookStateService.setChapters(updatedChapters);
        } else {
          // Chapter wasn't approved yet (retrying a previously
          // skipped slot). Insert at the number-ordered position so
          // the chapter lands at its intended index even if a
          // later-numbered chapter is already in the array — the
          // pipeline skips and appends during the original run,
          // so `state.chapters` can be out of number order on
          // entry. Without this, retrying ch 2 after the original
          // run produced `[ch1, ch3, ch5, ch2]` instead of
          // `[ch1, ch2, ch3, ch5]`.
          const insertAt = currentState.chapters.findIndex(c => c.number > sectionNumber);
          const insertIdx = insertAt >= 0 ? insertAt : currentState.chapters.length;
          const updatedChapters = [
            ...currentState.chapters.slice(0, insertIdx),
            chapter,
            ...currentState.chapters.slice(insertIdx),
          ];
          this.bookStateService.setChapters(updatedChapters);
        }
      } else {
        const updatedChapters = [...currentState.chapters, chapter];
        this.bookStateService.setChapters(updatedChapters);
      }
    } else if (slot === 'prologue') {
      this.bookStateService.setPrologue(chapter);
    } else {
      this.bookStateService.setEpilogue(chapter);
    }

    this.bookStateService.setCurrentDraft(null);
    this.bookStateService.setCritique(null);
    this.bookStateService.setRevisionCount(0);

    // Auto-save checkpoint using RxJS Observable
    this.persistenceService.saveCheckpoint('current-book', this.bookStateService.getState())
      .subscribe({
        next: () => console.log('Checkpoint saved successfully'),
        error: (err) => console.error('Failed to save checkpoint:', err)
      });

    return chapter;
  }

  /**
   * Run character consistency and continuity checks after chapter approval
   */
  private runPostRevisionChecks(brief: ChapterBrief, draft: ChapterDraft, config: BookConfig, chapterNumber: number): Observable<any> {
    return new Observable(subscriber => {
      const currentState = this.bookStateService.getState();

      // 4. Character consistency check
      this.bookStateService.setActiveAgent('character');
      
      this.characterService.checkCharacterConsistencyWithUsage(
        draft.content,
        brief,
        currentState.characterStore,
        config.model
      ).subscribe({
        next: (characterResult) => {
          this.bookStateService.recordAgentUsage('character', characterResult.usage);
          console.log(`Character check: ${characterResult.data.violations.length} violations found`);
          
          // 5. Update character states based on this chapter
          this.characterService.updateCharacterStatesWithUsage(
            draft.content,
            brief,
            currentState.characterStore,
            chapterNumber,
            config.model
          ).subscribe({
            next: (updateResult) => {
              this.bookStateService.recordAgentUsage('character', updateResult.usage);
              this.bookStateService.setCharacterStore(updateResult.data);
              
              // 6. Continuity check
              this.bookStateService.setActiveAgent('continuity');
              
              this.continuityService.checkContinuityWithUsage(
                draft.content,
                brief,
                currentState.chapters,
                config.model
              ).subscribe({
                next: (continuityResult) => {
                  this.bookStateService.recordAgentUsage('continuity', continuityResult.usage);
                  console.log(`Continuity check: ${continuityResult.data.issues.length} issues found`);
                  
                  // Merge new issues with existing flags
                  const existingFlags = currentState.continuityFlags || [];
                  const allFlags = [...existingFlags, ...continuityResult.data.issues];
                  this.bookStateService.setContinuityFlags(allFlags);
                  
                  subscriber.next('Post-revision checks completed');
                  subscriber.complete();
                },
                error: (err) => {
                  console.error('Continuity check error:', err);
                  this.bookStateService.incrementErrorCount();
                  subscriber.next('Continuity check failed, continuing...');
                  subscriber.complete();
                }
              });
            },
            error: (err) => {
              console.error('Character update error:', err);
              this.bookStateService.incrementErrorCount();
              subscriber.next('Character update failed, continuing...');
              subscriber.complete();
            }
          });
        },
        error: (err) => {
          console.error('Character check error:', err);
          this.bookStateService.incrementErrorCount();
          subscriber.next('Character check failed, continuing...');
          subscriber.complete();
        }
      });
    });
  }

  /**
   * Build the small style-context object the Author prompt template
   * needs. Pulled out so the writer and reviser call sites stay in
   * sync and the prompt template never has to depend on a full
   * BookConfig (which it doesn't actually need).
   */
  private buildAuthorStyleContext(config: BookConfig): AuthorStyleContext {
    return {
      style: String(config.style),
      tone: String(config.tone),
      pov: String(config.pov),
      tense: String(config.tense)
    };
  }

  /**
   * Write chapter with retry logic. Retries on any failure —
   * network error, empty response, too-short response, thrown
   * validation error from the author service, OR a tail-truncated
   * draft (no sentence terminator at the end). The first complete
   * draft wins.
   *
   * Tail-truncation handling: when every attempt returns a non-empty
   * draft that lacks a sentence terminator, the function falls
   * through with the most recent draft instead of erroring. The
   * draft gets a `[… incomplete — generation cut off …]` marker
   * appended so reviewers can see what got generated, and a clear
   * `state.error` entry quotes the truncated tail. This mirrors the
   * reviser's "always approves the best attempt" contract: a
   * chapter is never lost just because the model cut off; the
   * reviewer sees a flagged draft instead of a gap.
   *
   * The per-section skip rule still fires for fully empty / fully
   * errored runs (no draft at all after `maxRetries`) so the rest of
   * the book keeps shipping.
   */
  private writeChapterWithRetry(brief: ChapterBrief, config: BookConfig, maxRetries: number): Observable<{ draft: ChapterDraft; usage: any }> {
    return new Observable(subscriber => {
      this.bookStateService.setActiveAgent('author');

      let attempt = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let finished = false;
      // Track the most recent non-empty (but truncated) draft so
      // the fallback can ship it with a marker if every attempt
      // produces the same failure. Cleared once a complete draft
      // arrives — we never fall back on a successful run.
      let lastTruncatedDraft: ChapterDraft | null = null;

      const self = this;
      const ctx: { attempt: () => void } = { attempt: () => {} };
      const scheduleRetry = () => {
        if (finished) return;
        if (self.stopped) {
          // Tear down cleanly: signal completion with nothing, the
          // caller treats this as "stopped, not failed". Subscribers
          // get a normal complete so their own state machine doesn't
          // flip to error.
          finished = true;
          subscriber.complete();
          return;
        }
        if (attempt >= maxRetries) {
          if (lastTruncatedDraft) {
            self.shipTruncatedDraft(brief, lastTruncatedDraft, subscriber);
          } else {
            // No draft at all (every attempt was empty or errored).
            // Fall back to the original error semantics so the
            // per-section skip rule still fires and the rest of
            // the book ships.
            subscriber.error(new Error(`Failed to generate chapter ${brief.number} after ${maxRetries} attempts`));
          }
          finished = true;
          return;
        }
        self.bookStateService.incrementRetryCount();
        self.scheduleTimer(() => ctx.attempt(), 2000);
      };

      ctx.attempt = () => {
        if (finished) return;
        if (self.stopped) {
          finished = true;
          subscriber.complete();
          return;
        }
        attempt++;
        console.log(`Writing chapter attempt ${attempt}/${maxRetries}`);

        // Reset the stream buffer at the top of every attempt, not
        // outside the loop — a failed attempt's prose would otherwise
        // remain visible during the next attempt's 2s delay and
        // bleed into the new attempt's display the moment it starts.
        self.bookStateService.beginStream$('author');

        self.authorService.writeChapterStreamingWithUsage(brief, {
          model: config.model,
          chapterBrief: brief,
          previousChapters: self.bookStateService.getState().chapters,
          characterState: self.bookStateService.getState().characterStore[brief.povCharacter] || null,
          worldState: self.bookStateService.getState().worldStateDoc,
          styleContext: self.buildAuthorStyleContext(config)
        }).subscribe({
          next: (result) => {
            if (finished) return;
            totalPromptTokens += result.usage.promptTokens;
            totalCompletionTokens += result.usage.completionTokens;
            const draft = result.draft;
            if (!draft || !draft.content || draft.content.trim().length === 0) {
              console.error(`Empty draft received on attempt ${attempt}`);
              self.bookStateService.incrementErrorCount();
              self.bookStateService.endStream$();
              scheduleRetry();
              return;
            }
            if (!endsWithSentenceTerminator(draft.content)) {
              // Tail-completeness check failed — the author stream
              // was cut off mid-sentence. Treat it like an empty
              // draft for retry purposes: bump the error counter,
              // close the stream, and schedule another attempt. We
              // keep the draft around so the fallback can ship a
              // marked-up version if every attempt truncates near
              // the same length.
              const tailSnippet = draft.content.slice(-80).replace(/\s+/g, ' ').trim();
              console.warn(
                `Orchestrator: attempt ${attempt} returned a truncated draft (no sentence terminator). Tail: "${tailSnippet}"`
              );
              lastTruncatedDraft = draft;
              self.bookStateService.incrementErrorCount();
              self.bookStateService.endStream$();
              scheduleRetry();
              return;
            }
            console.log(`Orchestrator: Received draft with ${draft.wordCount} words`);
            self.bookStateService.endStream$();
            finished = true;
            subscriber.next({
              draft,
              usage: {
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                totalTokens: totalPromptTokens + totalCompletionTokens
              }
            });
            subscriber.complete();
          },
          error: (error) => {
            if (finished) return;
            console.error(`Author attempt ${attempt} errored:`, error?.message || error);
            self.bookStateService.incrementErrorCount();
            self.bookStateService.endStream$();
            scheduleRetry();
          }
        });
      };

      ctx.attempt();

      // If the outer subscriber unsubscribes (e.g. stop() before
      // we finished), make sure no scheduled retry ever fires.
      return () => {
        finished = true;
      };
    });
  }

  /**
   * Fallback path for `writeChapterWithRetry` when every attempt
   * produced a tail-truncated draft. Appends a
   * `[… incomplete — generation cut off …]` marker so reviewers can
   * see what got generated and surfaces a `state.error` line that
   * quotes the truncated tail. The chapter still gets approved so
   * the rest of the pipeline (critic / character / continuity /
   * export) keeps running, but the user sees the marker on the
   * approved section.
   */
  private shipTruncatedDraft(
    brief: ChapterBrief,
    draft: ChapterDraft,
    subscriber: any,
  ): void {
    const marker = '\n\n[… incomplete — generation cut off …]';
    const tailSnippet = draft.content.slice(-120).replace(/\s+/g, ' ').trim();
    const errorMessage = `Author returned a truncated draft on every attempt for chapter ${brief.number} — content ends at: "${tailSnippet}"`;
    console.warn(`Orchestrator: ${errorMessage}`);
    this.bookStateService.setError(errorMessage);
    const finalDraft: ChapterDraft = {
      ...draft,
      content: draft.content + marker,
      updatedAt: new Date(),
    };
    subscriber.next({ draft: finalDraft });
    subscriber.complete();
  }

  /**
   * Handle chapter revision loop. Retries the reviser on any failure
   * (refusal, truncation, network error) up to `maxReviseRetries`
   * times per revision round. If all retries fail, the original draft
   * is kept and the chapter still goes through the rest of the
   * pipeline — a chapter is never skipped just because the reviser
   * bailed. The Observable always completes with the final draft
   * (never errors), so the chapter is always approved.
   */
  private handleRevision(brief: ChapterBrief, draft: ChapterDraft, critique: any, config: BookConfig): Observable<ChapterDraft> {
    const maxReviseRetries = 3;
    const maxRevisionRounds = 3;
    return new Observable(subscriber => {
      let currentDraft = draft;
      let completed = false;

      const finish = (finalDraft: ChapterDraft, reason: string) => {
        if (completed) return;
        completed = true;
        console.log(`Orchestrator: chapter ${brief.number} revision done — ${reason}`);
        subscriber.next(finalDraft);
        subscriber.complete();
      };

      // One reviser attempt, with its own retry loop. Resolves on
      // success; resolves with the previous draft on exhaustion.
      const runReviserRound = (round: number): void => {
        if (completed) return;
        if (this.stopped) {
          finish(currentDraft, 'stopped');
          return;
        }
        let attempt = 0;

        const doAttempt = () => {
          if (completed) return;
          if (this.stopped) {
            finish(currentDraft, 'stopped');
            return;
          }
          if (attempt >= maxReviseRetries) {
            // Exhausted retries this round — keep the current draft
            // and call it done. The chapter still goes through
            // post-revision checks and gets approved.
            console.warn(
              `Orchestrator: reviser exhausted ${maxReviseRetries} attempts for chapter ${brief.number}; keeping current draft.`
            );
            finish(currentDraft, 'reviser gave up, original draft kept');
            return;
          }
          attempt++;

          // Reset the stream buffer at the top of every reviser
          // attempt (same rationale as writeChapterWithRetry above —
          // a failed attempt's tail must not bleed into the next).
          this.bookStateService.beginStream$('reviser');

          this.authorService.reviseChapterStreamingWithUsage(currentDraft, critique, brief, config.model, this.buildAuthorStyleContext(config)).subscribe({
            next: (result) => {
              if (completed) return;
              this.bookStateService.recordAgentUsage('reviser', result.usage);
              this.bookStateService.endStream$();
              const newDraft = result.draft;
              if (!endsWithSentenceTerminator(newDraft.content)) {
                // Reviser returned a tail-truncated draft — same
                // retry semantics as a thrown error. Fall back to
                // `currentDraft` (the pre-revision draft, which
                // already passed the writer's completeness check)
                // when retries are exhausted, mirroring the existing
                // "reviser gave up, original draft kept" path.
                const tailSnippet = newDraft.content.slice(-80).replace(/\s+/g, ' ').trim();
                console.warn(
                  `Orchestrator: reviser attempt ${attempt}/${maxReviseRetries} for chapter ${brief.number} returned a truncated draft. Tail: "${tailSnippet}"`
                );
                this.bookStateService.incrementErrorCount();
                this.bookStateService.endStream$();
                if (attempt >= maxReviseRetries) {
                  console.warn(
                    `Orchestrator: reviser exhausted ${maxReviseRetries} attempts for chapter ${brief.number}; keeping current draft.`
                  );
                  finish(currentDraft, 'reviser gave up, original draft kept');
                  return;
                }
                this.bookStateService.incrementRetryCount();
                this.scheduleTimer(doAttempt, 2000);
                return;
              }
              const criticContext: CriticContext = {
                model: config.model,
                chapterBrief: brief,
                chapterContent: newDraft.content,
                previousChapters: this.bookStateService.getState().chapters,
                characterState: this.bookStateService.getState().characterStore[brief.povCharacter] || null,
                worldState: this.bookStateService.getState().worldStateDoc
              };

              this.criticService.evaluateChapterWithUsage(newDraft.content, brief, criticContext).subscribe({
                next: (newCritiqueResult) => {
                  if (completed) return;
                  this.bookStateService.recordAgentUsage('critic', newCritiqueResult.usage);
                  currentDraft = newDraft;
                  const score = newCritiqueResult.data?.overallScore ?? 0;
                  if (score >= 7 || round >= maxRevisionRounds) {
                    finish(currentDraft, `score ${score} after round ${round}`);
                  } else {
                    this.bookStateService.setRevisionCount(round + 1);
                    this.bookStateService.setActiveAgent('reviser');
                    runReviserRound(round + 1);
                  }
                },
                error: (error) => {
                  // Critic is supposed to be non-throwing now
                  // (returns an unavailableReason sentinel). If it
                  // does throw, keep the current draft and finish.
                  console.warn(
                    `Orchestrator: critic re-eval failed for chapter ${brief.number}; keeping current draft.`,
                    error?.message || error
                  );
                  this.bookStateService.incrementErrorCount();
                  finish(currentDraft, 'critic re-eval failed, keeping draft');
                }
              });
            },
            error: (error) => {
              if (completed) return;
              console.warn(
                `Orchestrator: reviser attempt ${attempt}/${maxReviseRetries} for chapter ${brief.number} failed: ${error?.message || error}`
              );
              this.bookStateService.incrementErrorCount();
              this.bookStateService.endStream$();
              this.bookStateService.incrementRetryCount();
              this.scheduleTimer(doAttempt, 2000);
            }
          });
        };

        doAttempt();
      };

      runReviserRound(1);

      // Teardown: if the outer subscriber unsubscribes (e.g.
      // stop()), flip the completed flag so no in-flight timer
      // callback re-issues an API call. Timers themselves are
      // cleared by the orchestrator-level teardown in orchestrate().
      return () => {
        completed = true;
      };
    });
  }

  /**
   * Schedule a timer and register its handle so we can clear it
   * on stop/unsubscribe. Returns the handle for the rare caller
   * that wants to cancel a specific timer early.
   */
  private scheduleTimer(fn: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    if (this.stopped) {
      // Don't even queue a timer for a stopped run.
      return -1 as unknown as ReturnType<typeof setTimeout>;
    }
    const handle = setTimeout(() => {
      this.pendingTimers.delete(handle);
      if (this.stopped) return;
      fn();
    }, delayMs);
    this.pendingTimers.add(handle);
    return handle;
  }

  /**
   * Cancel every pending retry timer and clear the registry.
   * Idempotent — safe to call multiple times.
   */
  private clearAllTimers(): void {
    for (const handle of this.pendingTimers) {
      clearTimeout(handle);
    }
    this.pendingTimers.clear();
  }

  /**
   * Stop the generation process. Sets the stopped flag so any
   * in-flight timer callback that already fired will no-op, clears
   * every pending retry timer, and unsubscribes the inner pipeline
   * subscription so no further API calls go out.
   */
  stop(): void {
    this.stopped = true;
    this.clearAllTimers();
    if (this.currentSubscription) {
      this.currentSubscription.unsubscribe();
      this.currentSubscription = null;
    }
    this.bookStateService.setStatus('idle');
    this.bookStateService.setActiveAgent(null);
    this.bookStateService.endGenerationTimer();
    // Drop the live stream buffer immediately — the 2s tail window
    // is for natural completion, not for stop. Leaving the partial
    // prose visible would suggest generation is still running.
    this.bookStateService.endStream$();
    this.bookStateService.clearLiveStreamBuffer();
  }
}
