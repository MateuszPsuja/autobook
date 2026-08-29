import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { JsonParserService } from '../../shared/utils/json-parser.service';
import { ChapterBrief, CriticContext } from '../../models/book-state.model';
import { CritiqueReport } from '../../models/critique.model';
import { criticSystemPrompt, criticChapterPrompt, criticRevisionPrompt } from '../prompts/critic.prompts';
import { ApiResult, extractUsage, defaultUsage } from '../../shared/utils/api-result.util';

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
      switchMap(response => this.handleFirstResponse(response, false)),
      catchError(error => this.handleCriticError(error, false))
    );
  }

  /**
   * Evaluate a chapter with usage tracking
   */
  evaluateChapterWithUsage(chapterContent: string, brief: ChapterBrief, ctx: CriticContext): Observable<CriticResult> {
    const request = this.buildRequest(chapterContent, brief, ctx);

    return this.apiService.chatCompletion(request).pipe(
      switchMap(response => this.handleFirstResponse(response, true)),
      catchError(error => this.handleCriticError(error, true))
    );
  }

  /**
   * Process the first LLM response: extract content, parse it, and on
   * parse failure kick off a single rescue retry that re-asks the model
   * to return ONLY valid JSON. This is the "work correctly every time"
   * path for the feedback-missing bug — we no longer silently return
   * an empty critique just because the model wrapped the JSON in prose
   * or markdown.
   */
  private handleFirstResponse(response: any, withUsage: true): Observable<CriticResult>;
  private handleFirstResponse(response: any, withUsage: false): Observable<CritiqueReport>;
  private handleFirstResponse(response: any, withUsage: boolean): Observable<CritiqueReport | CriticResult> {
    const content = response.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      // No content — try a rescue once. Sometimes the model just
      // returns whitespace, and a direct re-ask with a tighter prompt
      // gets a real answer.
      return this.rescueRetry(response, 'Critic returned empty content; retrying with stricter prompt.', withUsage)
        .pipe(catchError(error => this.handleCriticError(error, withUsage as any)));
    }
    try {
      if (withUsage) {
        return of(this.parseCritiqueWithUsage(content, response));
      }
      return of(this.parseCritique(content));
    } catch (parseError) {
      // First parse failed — try once more with a strict JSON-only
      // prompt. If that also fails, fall through to the empty-critique
      // fallback so the rest of the pipeline can continue.
      const model = response.model;
      return this.rescueRetryForParse(content, model, withUsage as any)
        .pipe(catchError(error => this.handleCriticError(error, withUsage as any)));
    }
  }

  /**
   * Re-ask the same model with the strictest possible "return ONLY
   * valid JSON" prompt. Used when the first response was empty.
   */
  private rescueRetry(prevResponse: any, _reason: string, withUsage: boolean): Observable<CritiqueReport | CriticResult> {
    const model = prevResponse.model;
    const messages = [
      {
        role: 'system' as const,
        content: 'You are a strict JSON generator. Return ONLY a single valid JSON object. No prose, no markdown, no explanations before or after. The first character of your reply must be "{" and the last must be "}".'
      },
      {
        role: 'user' as const,
        content: 'Reply with an empty critique object: {"scores":{},"overallScore":0,"feedback":"","mustFix":[],"suggestions":[]}'
      }
    ];
    return this.apiService.chatCompletion({ model, messages, temperature: 0.1, max_tokens: 800 })
      .pipe(
        switchMap(response => {
          const content = response.choices?.[0]?.message?.content;
          if (!content || content.trim().length === 0) {
            throw new CriticEmptyResponseError();
          }
          if (withUsage) {
            return of(this.parseCritiqueWithUsage(content, response));
          }
          return of(this.parseCritique(content));
        })
      );
  }

  /**
   * Re-ask the same model to extract the JSON from a previous reply
   * that was unparseable. Cheaper than regenerating the full critique.
   */
  private rescueRetryForParse(prevContent: string, model: string, withUsage: boolean): Observable<CritiqueReport | CriticResult> {
    const messages = [
      {
        role: 'system' as const,
        content: 'You are a strict JSON extractor. The user will give you a text that is supposed to contain a JSON object. Extract the JSON object and return it verbatim — no prose, no markdown, no comments. The first character of your reply must be "{" and the last must be "}".'
      },
      {
        role: 'user' as const,
        content: 'Extract the JSON object from this text:\n\n' + prevContent
      }
    ];
    return this.apiService.chatCompletion({ model, messages, temperature: 0.1, max_tokens: 2000 })
      .pipe(
        switchMap(response => {
          const content = response.choices?.[0]?.message?.content;
          if (!content || content.trim().length === 0) {
            throw new CriticEmptyResponseError();
          }
          if (withUsage) {
            return of(this.parseCritiqueWithUsage(content, response));
          }
          return of(this.parseCritique(content));
        })
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
      // can continue. The fallback carries a `unavailableReason` field
      // so the UI can render an explicit "Critique unavailable" message
      // instead of an empty panel.
      console.warn('Critic returned no content; skipping critique.');
    } else if (error instanceof CriticParseError) {
      // LLM returned content but it wasn't parseable JSON. Still
      // recoverable — empty critique is the right fallback. Warn
      // rather than error so paper bots don't get spammed red.
      console.warn('Critic returned non-JSON content; skipping critique. ' + (error as Error).message);
    } else {
      console.error('Critic evaluation error:', error);
    }
    const unavailable: CritiqueReport = {
      unavailableReason: 'The reviewer model did not return a parseable critique. The chapter itself is intact — you can still export it.'
    } as CritiqueReport;
    return new Observable(subscriber => {
      if (withUsage) {
        subscriber.next({
          data: unavailable,
          usage: defaultUsage()
        });
      } else {
        subscriber.next(unavailable);
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
