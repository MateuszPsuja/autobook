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

/**
 * Thrown internally when the LLM returns an empty / null response.
 * Distinct from JSON parse errors so the catch handler can treat it as
 * a recoverable condition (rate limit, timeout, refusal).
 */
class CriticEmptyResponseError extends Error {
  constructor() {
    super('Empty response content from critic');
    this.name = 'CriticEmptyResponseError';
  }
}

/**
 * Thrown when the LLM returned content but it could not be parsed as
 * JSON. Recoverable — the pipeline continues with an empty critique.
 */
class CriticParseError extends Error {
  constructor(cause: string) {
    super(`Critic response was not parseable JSON: ${cause}`);
    this.name = 'CriticParseError';
  }
}

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
          throw new CriticEmptyResponseError();
        }
        return this.parseCritique(content);
      }),
      catchError(error => this.handleCriticError(error))
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
          throw new CriticEmptyResponseError();
        }
        return this.parseCritiqueWithUsage(content, response);
      }),
      catchError(error => this.handleCriticError(error, true))
    );
  }

  private parseCritique(content: string): CritiqueReport {
    try {
      const critique = this.jsonParser.parse<CritiqueReport>(content);
      critique.createdAt = new Date();
      return critique;
    } catch (e) {
      throw new CriticParseError((e as Error).message);
    }
  }

  private parseCritiqueWithUsage(content: string, response: any): CriticResult {
    try {
      const critique = this.jsonParser.parse<CritiqueReport>(content);
      critique.createdAt = new Date();
      return { data: critique, usage: extractUsage(response) };
    } catch (e) {
      throw new CriticParseError((e as Error).message);
    }
  }

  private handleCriticError<T>(error: unknown, withUsage: true): Observable<{ data: CritiqueReport; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }>;
  private handleCriticError<T>(error: unknown, withUsage?: false): Observable<CritiqueReport>;
  private handleCriticError<T>(error: unknown, withUsage = false): Observable<any> {
    if (error instanceof CriticEmptyResponseError) {
      // LLM returned no content — recoverable (rate limit, timeout,
      // model refusal). Log a warning, not an error, and fall through
      // to the empty-critique fallback so the rest of the pipeline
      // can continue.
      console.warn('Critic returned no content; skipping critique.');
    } else if (error instanceof CriticParseError) {
      // LLM returned content but it wasn't parseable JSON. Still
      // recoverable — empty critique is the right fallback. Warn
      // rather than error so paper bots don't get spammed red.
      console.warn('Critic returned non-JSON content; skipping critique. ' + (error as Error).message);
    } else {
      console.error('Critic evaluation error:', error);
    }
    return new Observable(subscriber => {
      if (withUsage) {
        subscriber.next({
          data: {} as CritiqueReport,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        });
      } else {
        subscriber.next({} as CritiqueReport);
      }
      subscriber.complete();
    });
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
