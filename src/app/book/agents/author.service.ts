import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { ApiService, TokenUsage } from '../../core/api.service';
import { ChapterBrief, AuthorContext, AuthorStyleContext } from '../../models/book-state.model';
import { ChapterDraft } from '../../models/chapter.model';
import { authorSystemPrompt, authorChapterPrompt, authorRevisionPrompt } from '../prompts/author.prompts';
import { stripRunningWordCount } from '../../shared/utils/chapter-cleanup';

export interface AuthorResult {
  draft: ChapterDraft;
  usage: TokenUsage;
}

@Injectable({
  providedIn: 'root'
})
export class AuthorService {
  constructor(private apiService: ApiService) {}

  /**
   * Write a chapter with streaming output
   */
  writeChapter(brief: ChapterBrief, ctx: AuthorContext): Observable<ChapterDraft> {
    const messages = [
      { role: 'system' as const, content: authorSystemPrompt(ctx.styleContext) },
      { role: 'user' as const, content: authorChapterPrompt(brief, ctx) }
    ];

    const request = {
      model: ctx.model,
      messages,
      temperature: 0.8,
      max_tokens: brief.targetWordCount * 2, // Allow for longer responses
      stream: true
    };

    const subject = new Subject<ChapterDraft>();
    let content = '';
    let wordCount = 0;
    let hasEmitted = false;

    const stream = this.apiService.chatCompletionStream(request);
    let subscription = stream.subscribe({
      next: (token: string) => {
        content += token;
        // Strip the running word counter (if the model emits one) so
        // the stored content and live progress text are clean prose.
        const cleaned = stripRunningWordCount(content);
        wordCount = this.countWords(cleaned);
        hasEmitted = true;

        const draft: ChapterDraft = {
          chapterId: `chapter-${brief.number}`,
          content: cleaned,
          wordCount,
          progress: Math.min(100, Math.floor((wordCount / brief.targetWordCount) * 100)),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        subject.next(draft);
      },
      error: (error) => {
        console.error('Author stream error:', error);
        // If we have partial content, emit it as a partial draft instead of erroring
        if (content.length > 0) {
          const cleaned = stripRunningWordCount(content);
          const partialDraft: ChapterDraft = {
            chapterId: `chapter-${brief.number}`,
            content: cleaned,
            wordCount: this.countWords(cleaned),
            progress: Math.min(100, Math.floor((this.countWords(cleaned) / brief.targetWordCount) * 100)),
            createdAt: new Date(),
            updatedAt: new Date()
          };
          subject.next(partialDraft);
          subject.complete();
        } else {
          subject.error(error);
        }
      },
      complete: () => {
        // Ensure we emit at least one draft even if stream was empty
        if (!hasEmitted) {
          console.warn('Author stream completed without emitting any content');
          // Create an empty draft as a fallback
          const emptyDraft: ChapterDraft = {
            chapterId: `chapter-${brief.number}`,
            content: '',
            wordCount: 0,
            progress: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          subject.next(emptyDraft);
        }
        subject.complete();
      }
    });

    // Clean up subscription when subject is unsubscribed
    subject.subscribe({
      complete: () => subscription.unsubscribe()
    });

    return subject.asObservable();
  }

  /**
   * Write a chapter with usage tracking (non-streaming for accurate token count)
   */
  writeChapterWithUsage(brief: ChapterBrief, ctx: AuthorContext): Observable<AuthorResult> {
    const messages = [
      { role: 'system' as const, content: authorSystemPrompt(ctx.styleContext) },
      { role: 'user' as const, content: authorChapterPrompt(brief, ctx) }
    ];

    // Use non-streaming for accurate token counting
    const request = {
      model: ctx.model,
      messages,
      temperature: 0.8,
      max_tokens: brief.targetWordCount * 2
    };

    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = stripRunningWordCount(response.choices[0]?.message?.content || '');
        const wordCount = this.countWords(content);

        // Treat "mostly preamble" or "tiny fragment" as a failure so the
        // orchestrator's writeChapterWithRetry can re-ask the model. The
        // cleanup utility already strips reasoning preambles; if the
        // surviving content is still very short, the model almost
        // certainly bailed (refusal, hit max_tokens, or returned just a
        // title and a sentence). ~200 words is well below any
        // reasonable targetWordCount and a clear signal of a bad draft.
        const minViableWords = Math.min(200, Math.max(50, Math.floor(brief.targetWordCount * 0.2)));
        if (wordCount < minViableWords) {
          throw new Error(
            `Author returned only ${wordCount} words after cleanup (minimum ${minViableWords}). ` +
            `Likely a refusal, truncation, or reasoning-only response — will retry.`
          );
        }

        const draft: ChapterDraft = {
          chapterId: `chapter-${brief.number}`,
          content,
          wordCount,
          progress: Math.min(100, Math.floor((wordCount / brief.targetWordCount) * 100)),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const usage: TokenUsage = {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0
        };

        return { draft, usage };
      })
    );
  }

  /**
   * Revise a chapter based on critique
   */
  reviseChapter(draft: ChapterDraft, critique: any, brief: ChapterBrief, model: string, styleContext: AuthorStyleContext): Observable<ChapterDraft> {
    const messages = [
      { role: 'system' as const, content: authorSystemPrompt(styleContext) },
      { role: 'user' as const, content: authorRevisionPrompt(draft.content, critique, brief) }
    ];

    const request = {
      model: model,
      messages,
      temperature: 0.7,
      max_tokens: draft.wordCount * 2
    };

    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = stripRunningWordCount(response.choices[0].message.content);
        const revisedDraft: ChapterDraft = {
          ...draft,
          content,
          wordCount: this.countWords(content),
          updatedAt: new Date()
        };
        return revisedDraft;
      })
    );
  }

  /**
   * Revise a chapter with usage tracking
   */
  reviseChapterWithUsage(draft: ChapterDraft, critique: any, brief: ChapterBrief, model: string, styleContext: AuthorStyleContext): Observable<AuthorResult> {
    const messages = [
      { role: 'system' as const, content: authorSystemPrompt(styleContext) },
      { role: 'user' as const, content: authorRevisionPrompt(draft.content, critique, brief) }
    ];

    const request = {
      model: model,
      messages,
      temperature: 0.7,
      max_tokens: draft.wordCount * 2
    };

    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const raw = response.choices[0]?.message?.content || draft.content;
        const content = stripRunningWordCount(raw);
        const wordCount = this.countWords(content);

        // Same "too short after cleanup" guard as writeChapterWithUsage.
        // We compare against the original draft's word count so a
        // legitimately shorter revision doesn't get rejected.
        const minViableWords = Math.min(200, Math.max(50, Math.floor(draft.wordCount * 0.5)));
        if (wordCount < minViableWords) {
          throw new Error(
            `Reviser returned only ${wordCount} words after cleanup (minimum ${minViableWords}). ` +
            `Likely a refusal or truncation — will retry.`
          );
        }

        const revisedDraft: ChapterDraft = {
          ...draft,
          content,
          wordCount,
          updatedAt: new Date()
        };

        const usage: TokenUsage = {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0
        };

        return { draft: revisedDraft, usage };
      })
    );
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }
}
