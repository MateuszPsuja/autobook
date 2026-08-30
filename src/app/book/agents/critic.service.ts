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
      switchMap(response => this.handleFirstResponse(response, request, false)),
      catchError(error => this.handleCriticError(error, false))
    ) as unknown as Observable<CritiqueReport>;
  }

  /**
   * Evaluate a chapter with usage tracking
   */
  evaluateChapterWithUsage(chapterContent: string, brief: ChapterBrief, ctx: CriticContext): Observable<CriticResult> {
    const request = this.buildRequest(chapterContent, brief, ctx);

    return this.apiService.chatCompletion(request).pipe(
      switchMap(response => this.handleFirstResponse(response, request, true)),
      catchError(error => this.handleCriticError(error, true))
    ) as unknown as Observable<CriticResult>;
  }

  /**
   * Process the first LLM response: extract content, parse it, and on
   * parse failure (or empty content) kick off a single rescue retry
   * that re-runs the *original* evaluation with a stricter
   * "JSON only" system prompt — so the model still has the chapter
   * to evaluate, unlike a generic "give me an empty critique" retry.
   * If both attempts fail, fall through to the unavailableReason
   * sentinel.
   */
  private handleFirstResponse(
    response: any,
    originalRequest: any,
    withUsage: boolean
  ): Observable<CritiqueReport | CriticResult> {
    const content = response.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      return this.rescueRetry(originalRequest, withUsage)
        .pipe(catchError(error => this.handleCriticError(error, withUsage as any)));
    }
    try {
      if (withUsage) {
        return of(this.parseCritiqueWithUsage(content, response));
      }
      return of(this.parseCritique(content));
    } catch (parseError) {
      // The model produced content but it wasn't parseable JSON.
      // Asking the model to "extract" JSON from its own broken output
      // is a hard task and the model often produces yet more broken
      // JSON. A more reliable rescue is to re-run the ORIGINAL
      // evaluation with a stricter "JSON only" system prompt — the
      // model still has the chapter to evaluate.
      return this.rescueRetry(originalRequest, withUsage)
        .pipe(catchError(error => this.handleCriticError(error, withUsage as any)));
    }
  }

  /**
   * When the first response was empty, re-run the ORIGINAL evaluation
   * with a stricter "JSON only" system prompt. Crucially, the user
   * message is the same as the original — the model still has the
   * chapter to evaluate, so it can produce a real critique instead
   * of bailing with an empty object.
   */
  private rescueRetry(originalRequest: any, withUsage: boolean): Observable<CritiqueReport | CriticResult> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content: 'You are a strict JSON evaluator. Evaluate the chapter the user provides and respond with ONLY a single valid JSON object. No prose, no markdown, no explanations before or after. The first character of your reply must be "{" and the last must be "}". Use this exact schema: {"scores":{"prose":N,"pacing":N,"showVsTell":N,"dialogue":N,"continuity":N,"hookStrength":N,"thematicResonance":N},"overallScore":N,"feedback":"<2-3 sentences>","mustFix":["<items>"],"suggestions":["<items>"]} with N in 1-10.'
      },
      // Keep the original user prompt — the model still has the chapter.
      originalRequest.messages[originalRequest.messages.length - 1]
    ];
    return this.apiService.chatCompletion({
      model: originalRequest.model,
      messages,
      temperature: 0.1,
      max_tokens: 2000
    }).pipe(
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
      this.assertCritiqueHasContent(critique);
      return critique;
    } catch (e) {
      throw new CriticParseError((e as Error).message);
    }
  }

  private parseCritiqueWithUsage(content: string, response: any): CriticResult {
    try {
      const critique = this.jsonParser.parse<CritiqueReport>(content);
      critique.createdAt = new Date();
      this.assertCritiqueHasContent(critique);
      return { data: critique, usage: extractUsage(response) };
    } catch (e) {
      throw new CriticParseError((e as Error).message);
    }
  }

  /**
   * Reject "structurally valid but effectively empty" critiques —
   * the all-zeros, no-feedback object that some models return when
   * they comply literally with a "reply with an empty critique
   * object" prompt. Without this check the chapter ends up with a
   * valid `CritiqueReport` containing all-zeros and empty strings,
   * which renders as a 0/10 panel instead of the "unavailable"
   * panel the user actually wants to see.
   */
  private assertCritiqueHasContent(critique: CritiqueReport): void {
    if (!critique) {
      throw new CriticParseError('Critique parsed to null/undefined');
    }
    if (critique.unavailableReason) {
      // Already an unavailable sentinel; nothing to validate.
      return;
    }
    const hasText = (s?: string) => !!(s && s.trim().length > 0);
    const feedback = hasText(critique.feedback);
    const hasMustFix = Array.isArray(critique.mustFix) && critique.mustFix.length > 0;
    const hasSuggestions = Array.isArray(critique.suggestions) && critique.suggestions.length > 0;
    const scores = critique.scores || {};
    const hasAnyScore = Object.values(scores).some(v => typeof v === 'number' && v > 0);

    if (!feedback && !hasMustFix && !hasSuggestions && !hasAnyScore) {
      throw new CriticParseError('Critique parsed but is empty (no feedback, no items, all scores 0)');
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
