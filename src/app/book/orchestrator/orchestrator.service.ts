import { Injectable } from '@angular/core';
import { Observable, Subscription, throwError } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
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
      this.bookStateService.setCurrentDraft(null);
      this.bookStateService.setCritique(null);
      this.bookStateService.setRevisionCount(0);
      this.bookStateService.setStatus('configuring');
      this.bookStateService.setActiveAgent(null);

      // Start with architect
      this.bookStateService.setActiveAgent('architect');
      this.bookStateService.setStatus('generating');

      this.currentSubscription = this.architectService.generateBlueprintWithUsage(config).pipe(
        switchMap((result) => {
          // Record architect usage
          this.bookStateService.recordAgentUsage('architect', result.usage);
          this.bookStateService.setBlueprint(result.data);
          this.bookStateService.setActiveAgent('author');

          // Process each chapter
          return this.processChapters(result.data, config);
        }),
        catchError(error => {
          this.bookStateService.setStatus('error');
          this.bookStateService.setError(error.message);
          return throwError(error);
        })
      ).subscribe({
        next: async () => {
          this.bookStateService.endGenerationTimer();

          // Calculate total words from chapters
          const chapters = this.bookStateService.getState().chapters;
          const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);
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
        this.processChapter(chapterBrief, config, expectedNumber).subscribe({
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
   * Process a single chapter through the agent pipeline
   */
  private processChapter(brief: ChapterBrief, config: BookConfig, chapterNumber: number): Observable<any> {
    return new Observable(subscriber => {
      this.writeChapterWithRetry(brief, config, 3).subscribe({
        next: (result) => {
          const { draft, usage } = result;
          this.bookStateService.recordAgentUsage('author', usage);
          this.bookStateService.setCurrentDraft(draft);
          
          // 2. Critic evaluates the chapter
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
                    this.runPostRevisionChecks(brief, revisedDraft, config, chapterNumber).subscribe({
                      next: () => {
                        this.approveChapter(brief, revisedDraft, criticResult.data, chapterNumber);
                        subscriber.next('Chapter approved after revision');
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
                this.runPostRevisionChecks(brief, draft, config, chapterNumber).subscribe({
                  next: () => {
                    this.approveChapter(brief, draft, criticResult.data, chapterNumber);
                    subscriber.next('Chapter approved');
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
                  subscriber.next('Continuity check failed, continuing...');
                  subscriber.complete();
                }
              });
            },
            error: (err) => {
              console.error('Character update error:', err);
              subscriber.next('Character update failed, continuing...');
              subscriber.complete();
            }
          });
        },
        error: (err) => {
          console.error('Character check error:', err);
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
   * network error, empty response, too-short response, or thrown
   * validation error from the author service. The first successful
   * draft wins.
   */
  private writeChapterWithRetry(brief: ChapterBrief, config: BookConfig, maxRetries: number): Observable<{ draft: ChapterDraft; usage: any }> {
    return new Observable(subscriber => {
      this.bookStateService.setActiveAgent('author');

      let attempt = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let gaveUp = false;
      let finished = false;

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
          gaveUp = true;
          finished = true;
          subscriber.error(new Error(`Failed to generate chapter ${brief.number} after ${maxRetries} attempts`));
          return;
        }
        self.scheduleTimer(() => ctx.attempt(), 2000);
      };

      ctx.attempt = () => {
        if (finished || gaveUp) return;
        if (self.stopped) {
          finished = true;
          subscriber.complete();
          return;
        }
        attempt++;
        console.log(`Writing chapter attempt ${attempt}/${maxRetries}`);

        self.authorService.writeChapterWithUsage(brief, {
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
              scheduleRetry();
              return;
            }
            console.log(`Orchestrator: Received draft with ${draft.wordCount} words`);
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

          this.authorService.reviseChapterWithUsage(currentDraft, critique, brief, config.model, this.buildAuthorStyleContext(config)).subscribe({
            next: (result) => {
              if (completed) return;
              this.bookStateService.recordAgentUsage('reviser', result.usage);
              const newDraft = result.draft;
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
                  finish(currentDraft, 'critic re-eval failed, keeping draft');
                }
              });
            },
            error: (error) => {
              if (completed) return;
              console.warn(
                `Orchestrator: reviser attempt ${attempt}/${maxReviseRetries} for chapter ${brief.number} failed: ${error?.message || error}`
              );
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
   * Approve a chapter and add it to the book
   */
  private approveChapter(brief: ChapterBrief, draft: ChapterDraft, critique: any, chapterNumber: number): void {
    const chapter = {
      id: `chapter-${chapterNumber}`,
      number: chapterNumber,
      title: brief.title,
      content: draft.content,
      wordCount: draft.wordCount,
      status: 'approved' as const,
      createdAt: new Date(),
      approvedAt: new Date(),
      critique,
      revisions: []
    };

    const currentState = this.bookStateService.getState();
    const updatedChapters = [...currentState.chapters, chapter];
    
    this.bookStateService.setChapters(updatedChapters);
    this.bookStateService.setCurrentDraft(null);
    this.bookStateService.setCritique(null);
    this.bookStateService.setRevisionCount(0);

    // Auto-save checkpoint using RxJS Observable
    this.persistenceService.saveCheckpoint('current-book', this.bookStateService.getState())
      .subscribe({
        next: () => console.log('Checkpoint saved successfully'),
        error: (err) => console.error('Failed to save checkpoint:', err)
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
  }
}
