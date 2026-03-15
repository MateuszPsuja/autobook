import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { ApiService, TokenUsage } from '../../core/api.service';
import { ChapterBrief, AuthorContext } from '../../models/book-state.model';
import { ChapterDraft } from '../../models/chapter.model';
import { authorSystemPrompt, authorChapterPrompt, authorRevisionPrompt } from '../prompts/author.prompts';

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
      { role: 'system' as const, content: authorSystemPrompt(ctx as any) },
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
        wordCount = this.countWords(content);
        hasEmitted = true;
        
        const draft: ChapterDraft = {
          chapterId: `chapter-${brief.number}`,
          content,
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
          const partialDraft: ChapterDraft = {
            chapterId: `chapter-${brief.number}`,
            content,
            wordCount,
            progress: Math.min(100, Math.floor((wordCount / brief.targetWordCount) * 100)),
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
      { role: 'system' as const, content: authorSystemPrompt(ctx as any) },
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
        const content = response.choices[0]?.message?.content || '';
        const wordCount = this.countWords(content);
        
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
  reviseChapter(draft: ChapterDraft, critique: any, brief: ChapterBrief, model: string): Observable<ChapterDraft> {
    const messages = [
      { role: 'system' as const, content: authorSystemPrompt(brief as any) },
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
        const content = response.choices[0].message.content;
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
  reviseChapterWithUsage(draft: ChapterDraft, critique: any, brief: ChapterBrief, model: string): Observable<AuthorResult> {
    const messages = [
      { role: 'system' as const, content: authorSystemPrompt(brief as any) },
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
        const content = response.choices[0]?.message?.content || draft.content;
        const wordCount = this.countWords(content);
        
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
