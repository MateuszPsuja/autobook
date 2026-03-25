import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { JsonParserService } from '../../shared/utils/json-parser.service';
import { ChapterBrief, CriticContext } from '../../models/book-state.model';
import { CritiqueReport } from '../../models/critique.model';
import { criticSystemPrompt, criticChapterPrompt, criticRevisionPrompt } from '../prompts/critic.prompts';
import { ApiResult, extractUsage } from '../../shared/utils/api-result.util';

export interface CriticResult extends ApiResult<CritiqueReport> {}

@Injectable({
  providedIn: 'root'
})
export class CriticService {
  constructor(
    private apiService: ApiService,
    private jsonParser: JsonParserService
  ) {}

  /**
   * Evaluate a chapter and provide critique
   */
  evaluateChapter(chapterContent: string, brief: ChapterBrief, ctx: CriticContext): Observable<CritiqueReport> {
    const request = this.buildRequest(chapterContent, brief, ctx);
    
    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0]?.message?.content;
        if (!content || content.trim().length === 0) {
          throw new Error('Empty response content from critic');
        }
        const critique = this.jsonParser.parse<CritiqueReport>(content);
        critique.createdAt = new Date();
        return critique;
      }),
      catchError(error => {
        console.error('Critic evaluation error:', error);
        return new Observable<CritiqueReport>(subscriber => {
          subscriber.next({} as CritiqueReport);
          subscriber.complete();
        });
      })
    );
  }

  /**
   * Evaluate a chapter with usage tracking
   */
  evaluateChapterWithUsage(chapterContent: string, brief: ChapterBrief, ctx: CriticContext): Observable<CriticResult> {
    const request = this.buildRequest(chapterContent, brief, ctx);
    
    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0]?.message?.content;
        if (!content || content.trim().length === 0) {
          throw new Error('Empty response content from critic');
        }
        const critique = this.jsonParser.parse<CritiqueReport>(content);
        critique.createdAt = new Date();
        return {
          data: critique,
          usage: extractUsage(response)
        };
      }),
      catchError(error => {
        console.error('Critic evaluation error:', error);
        return new Observable<CriticResult>(subscriber => {
          subscriber.next({
            data: {} as CritiqueReport,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
          });
          subscriber.complete();
        });
      })
    );
  }

  private buildRequest(chapterContent: string, brief: ChapterBrief, ctx: CriticContext) {
    const messages = [
      { role: 'system' as const, content: criticSystemPrompt },
      { role: 'user' as const, content: criticChapterPrompt(chapterContent, brief, ctx) }
    ];

    return {
      model: ctx.model,
      messages,
      temperature: 0.3,
      max_tokens: 2000
    };
  }

  /**
   * Compare original and revised drafts
   */
  compareRevisions(originalDraft: string, revisedDraft: string, brief: ChapterBrief, model: string): Observable<any> {
    const messages = [
      { role: 'system' as const, content: criticSystemPrompt },
      { role: 'user' as const, content: criticRevisionPrompt(originalDraft, revisedDraft, brief) }
    ];

    const request = {
      model: model,
      messages,
      temperature: 0.3,
      max_tokens: 1500
    };

    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0].message.content;
        return this.jsonParser.parse(content);
      })
    );
  }
}
