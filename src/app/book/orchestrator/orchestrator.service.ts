import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { BookStateService } from '../state/book-state.service';
import { ArchitectService } from '../agents/architect.service';
import { AuthorService } from '../agents/author.service';
import { CriticService } from '../agents/critic.service';
import { CharacterService } from '../agents/character.service';
import { ContinuityService } from '../agents/continuity.service';
import { BookConfig } from '../../models/book-config.model';
import { Blueprint, AgentType, GenerationStatus } from '../../models/book-state.model';
import { ChapterBrief, CriticContext } from '../../models/book-state.model';
import { ChapterDraft } from '../../models/chapter.model';
import { PersistenceService } from '../../core/persistence.service';

@Injectable({
  providedIn: 'root'
})
export class OrchestratorService {
  constructor(
    private bookStateService: BookStateService,
    private architectService: ArchitectService,
    private authorService: AuthorService,
    private criticService: CriticService,
    private characterService: CharacterService,
    private continuityService: ContinuityService,
    private persistenceService: PersistenceService
  ) {}

  /**
   * Start the book generation process
   */
  orchestrate(config: BookConfig): Observable<any> {
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

      this.architectService.generateBlueprintWithUsage(config).pipe(
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
        next: () => {
          this.bookStateService.endGenerationTimer();
          
          // Calculate total words from chapters
          const chapters = this.bookStateService.getState().chapters;
          const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);
          this.bookStateService.updateTotalWords(totalWords);
          
          this.bookStateService.setStatus('completed');
          subscriber.next('Book generation completed');
          subscriber.complete();
        },
        error: (error) => {
          this.bookStateService.endGenerationTimer();
          subscriber.error(error);
        }
      });
    });
  }

  /**
   * Process all chapters in sequence
   */
  private processChapters(blueprint: Blueprint, config: BookConfig): Observable<any> {
    return new Observable(subscriber => {
      const chapters = blueprint.chapters;
      let currentChapterIndex = 0;

      const processNextChapter = () => {
        if (currentChapterIndex >= chapters.length) {
          subscriber.next('All chapters processed');
          subscriber.complete();
          return;
        }

        const chapterBrief = chapters[currentChapterIndex];
        this.processChapter(chapterBrief, config, currentChapterIndex + 1).subscribe({
          next: () => {
            currentChapterIndex++;
            processNextChapter();
          },
          error: (error) => {
            subscriber.error(error);
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
   * Write chapter with retry logic for empty responses
   */
  private writeChapterWithRetry(brief: ChapterBrief, config: BookConfig, maxRetries: number): Observable<{ draft: ChapterDraft; usage: any }> {
    return new Observable(subscriber => {
      this.bookStateService.setActiveAgent('author');
      
      let attempt = 0;
      
      const attemptWrite = () => {
        attempt++;
        console.log(`Writing chapter attempt ${attempt}/${maxRetries}`);
        
        let latestDraft: ChapterDraft | null = null;
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        
        this.authorService.writeChapterWithUsage(brief, {
          model: config.model,
          chapterBrief: brief,
          previousChapters: this.bookStateService.getState().chapters,
          characterState: this.bookStateService.getState().characterStore[brief.povCharacter] || null,
          worldState: this.bookStateService.getState().worldStateDoc
        }).subscribe({
          next: (result) => {
            latestDraft = result.draft;
            totalPromptTokens += result.usage.promptTokens;
            totalCompletionTokens += result.usage.completionTokens;
          },
          error: (error) => {
            subscriber.error(error);
          },
          complete: () => {
            if (!latestDraft || !latestDraft.content || latestDraft.content.trim().length === 0) {
              console.error(`Empty draft received on attempt ${attempt}`);
              if (attempt < maxRetries) {
                // Wait a bit before retrying
                setTimeout(() => attemptWrite(), 2000);
              } else {
                subscriber.error(new Error(`Failed to generate chapter after ${maxRetries} attempts`));
              }
              return;
            }
            
            console.log(`Orchestrator: Received draft with ${latestDraft.wordCount} words`);
            subscriber.next({
              draft: latestDraft,
              usage: {
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                totalTokens: totalPromptTokens + totalCompletionTokens
              }
            });
            subscriber.complete();
          }
        });
      };
      
      attemptWrite();
    });
  }

  /**
   * Handle chapter revision loop
   */
  private handleRevision(brief: ChapterBrief, draft: ChapterDraft, critique: any, config: BookConfig): Observable<any> {
    return new Observable(subscriber => {
      let revisionCount = 0;
      let currentDraft = draft;

      const revise = () => {
        revisionCount++;
        this.bookStateService.setRevisionCount(revisionCount);
        this.bookStateService.setActiveAgent('reviser');

        this.authorService.reviseChapterWithUsage(currentDraft, critique, brief, config.model).subscribe({
          next: (result) => {
            this.bookStateService.recordAgentUsage('reviser', result.usage);
            
            // Re-evaluate the revised chapter
            const criticContext: CriticContext = {
              model: config.model,
              chapterBrief: brief,
              chapterContent: result.draft.content,
              previousChapters: this.bookStateService.getState().chapters,
              characterState: this.bookStateService.getState().characterStore[brief.povCharacter] || null,
              worldState: this.bookStateService.getState().worldStateDoc
            };

            this.criticService.evaluateChapterWithUsage(result.draft.content, brief, criticContext).subscribe({
              next: (newCritiqueResult) => {
                this.bookStateService.recordAgentUsage('critic', newCritiqueResult.usage);
                
                if (newCritiqueResult.data.overallScore >= 7 || revisionCount >= 3) {
                  currentDraft = result.draft;
                  subscriber.next('Revision loop completed');
                  subscriber.complete();
                } else {
                  currentDraft = result.draft;
                  revise(); // Continue revision loop
                }
              },
              error: (error) => {
                subscriber.error(error);
              }
            });
          },
          error: (error) => {
            subscriber.error(error);
          }
        });
      };

      revise();
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
   * Stop the generation process
   */
  stop(): void {
    this.bookStateService.setStatus('idle');
    this.bookStateService.setActiveAgent(null);
    this.bookStateService.endGenerationTimer();
  }
}
