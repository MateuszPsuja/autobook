import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { JsonParserService } from '../../shared/utils/json-parser.service';
import { ChapterBrief, Issue } from '../../models/book-state.model';
import { Chapter } from '../../models/chapter.model';
import { continuitySystemPrompt, continuityChapterPrompt, continuityFlagsPrompt } from '../prompts/continuity.prompts';
import { ApiResult, extractUsage, defaultUsage } from '../../shared/utils/api-result.util';

interface ContinuityAnalysisResponse {
  issues: Issue[];
  overallContinuity: 'Good' | 'Fair' | 'Poor';
  summary: string;
}

interface ContinuityFlagsResponse {
  resolvedFlags: string[];
  newFlags: Issue[];
  remainingFlags: Issue[];
}

export interface ContinuityResult {
  issues: Issue[];
  overallContinuity: string;
}

export interface ContinuityFlagsResult {
  resolvedFlags: string[];
  newFlags: Issue[];
  remainingFlags: Issue[];
}

/**
 * Thrown internally when the LLM returns an empty / null response.
 * Distinct from JSON parse errors so the catch handler can treat it as
 * a recoverable condition (rate limit, timeout, refusal).
 */
class ContinuityEmptyResponseError extends Error {
  constructor() {
    super('Empty response content from continuity');
    this.name = 'ContinuityEmptyResponseError';
  }
}

/**
 * Thrown when the LLM returned content but it could not be parsed as
 * JSON. Recoverable — the pipeline continues with no continuity issues.
 */
class ContinuityParseError extends Error {
  constructor(cause: string) {
    super(`Continuity response was not parseable JSON: ${cause}`);
    this.name = 'ContinuityParseError';
  }
}

@Injectable({
  providedIn: 'root'
})
export class ContinuityService {
  constructor(
    private apiService: ApiService,
    private jsonParser: JsonParserService
  ) {}

  /**
   * Check chapter for continuity issues with previous chapters
   */
  checkContinuity(
    chapterContent: string,
    brief: ChapterBrief,
    previousChapters: Chapter[],
    model: string
  ): Observable<ContinuityResult> {
    const request = this.buildContinuityRequest(chapterContent, brief, previousChapters, model);

    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0]?.message?.content;
        if (!content || content.trim().length === 0) {
          throw new ContinuityEmptyResponseError();
        }
        return this.parseContinuity(content, brief);
      }),
      catchError(error => this.handleContinuityError(error, false))
    );
  }

  /**
   * Check chapter for continuity with usage tracking
   */
  checkContinuityWithUsage(
    chapterContent: string,
    brief: ChapterBrief,
    previousChapters: Chapter[],
    model: string
  ): Observable<ApiResult<ContinuityResult>> {
    const request = this.buildContinuityRequest(chapterContent, brief, previousChapters, model);

    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0]?.message?.content;
        if (!content || content.trim().length === 0) {
          throw new ContinuityEmptyResponseError();
        }
        return this.parseContinuityWithUsage(content, brief, response);
      }),
      catchError(error => this.handleContinuityError(error, true))
    );
  }

  private parseContinuity(content: string, brief: ChapterBrief): ContinuityResult {
    try {
      const parsed = this.jsonParser.parse(content) as ContinuityAnalysisResponse;
      const issuesWithChapter = this.addChapterToIssues(parsed.issues || [], brief.number);
      return {
        issues: issuesWithChapter,
        overallContinuity: parsed.overallContinuity || 'Fair'
      };
    } catch (e) {
      throw new ContinuityParseError((e as Error).message);
    }
  }

  private parseContinuityWithUsage(content: string, brief: ChapterBrief, response: any): ApiResult<ContinuityResult> {
    try {
      const parsed = this.jsonParser.parse(content) as ContinuityAnalysisResponse;
      const issuesWithChapter = this.addChapterToIssues(parsed.issues || [], brief.number);
      return {
        data: {
          issues: issuesWithChapter,
          overallContinuity: parsed.overallContinuity || 'Fair'
        },
        usage: extractUsage(response)
      };
    } catch (e) {
      throw new ContinuityParseError((e as Error).message);
    }
  }

  private handleContinuityError(error: unknown, withUsage: true): Observable<ApiResult<ContinuityResult>>;
  private handleContinuityError(error: unknown, withUsage: false): Observable<ContinuityResult>;
  private handleContinuityError(error: unknown, withUsage: boolean): Observable<any> {
    if (error instanceof ContinuityEmptyResponseError) {
      // LLM returned no content — recoverable (rate limit, timeout,
      // model refusal). Log a warning, not an error.
      console.warn('Continuity returned no content; skipping analysis.');
    } else if (error instanceof ContinuityParseError) {
      // LLM returned content but it wasn't parseable JSON. Still
      // recoverable — empty analysis is the right fallback. Warn
      // rather than error so paper bots don't get spammed red.
      console.warn('Continuity returned non-JSON content; skipping analysis. ' + (error as Error).message);
    } else {
      console.error('Continuity analysis error:', error);
    }
    return new Observable(subscriber => {
      if (withUsage) {
        subscriber.next({
          data: { issues: [], overallContinuity: 'Fair' },
          usage: defaultUsage()
        });
      } else {
        subscriber.next({ issues: [], overallContinuity: 'Fair' });
      }
      subscriber.complete();
    });
  }

  /**
   * Check continuity flags against current chapter
   */
  checkContinuityFlags(
    currentFlags: Issue[],
    chapterContent: string,
    brief: ChapterBrief,
    chapterNumber: number,
    model: string
  ): Observable<ContinuityFlagsResult> {
    const request = this.buildFlagsRequest(currentFlags, chapterContent, brief, model);
    
    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0].message.content;
        const parsed = this.jsonParser.parse(content) as ContinuityFlagsResponse;
        const newFlagsWithChapter = this.addChapterToIssues(parsed.newFlags || [], chapterNumber);
        return {
          resolvedFlags: parsed.resolvedFlags || [],
          newFlags: newFlagsWithChapter,
          remainingFlags: parsed.remainingFlags || []
        };
      }),
      catchError(error => {
        console.error('Continuity flags check error:', error);
        return new Observable<ContinuityFlagsResult>(subscriber => {
          subscriber.next({ resolvedFlags: [], newFlags: [], remainingFlags: [] });
          subscriber.complete();
        });
      })
    );
  }

  /**
   * Check continuity flags with usage tracking
   */
  checkContinuityFlagsWithUsage(
    currentFlags: Issue[],
    chapterContent: string,
    brief: ChapterBrief,
    chapterNumber: number,
    model: string
  ): Observable<ApiResult<ContinuityFlagsResult>> {
    const request = this.buildFlagsRequest(currentFlags, chapterContent, brief, model);
    
    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0].message.content;
        const parsed = this.jsonParser.parse(content) as ContinuityFlagsResponse;
        const newFlagsWithChapter = this.addChapterToIssues(parsed.newFlags || [], chapterNumber);
        return {
          data: {
            resolvedFlags: parsed.resolvedFlags || [],
            newFlags: newFlagsWithChapter,
            remainingFlags: parsed.remainingFlags || []
          },
          usage: extractUsage(response)
        };
      }),
      catchError(error => {
        console.error('Continuity flags check error:', error);
        return new Observable<ApiResult<ContinuityFlagsResult>>(subscriber => {
          subscriber.next({
            data: { resolvedFlags: [], newFlags: [], remainingFlags: [] },
            usage: defaultUsage()
          });
          subscriber.complete();
        });
      })
    );
  }

  private buildContinuityRequest(chapterContent: string, brief: ChapterBrief, previousChapters: Chapter[], model: string) {
    const messages = [
      { role: 'system' as const, content: continuitySystemPrompt },
      { role: 'user' as const, content: continuityChapterPrompt(chapterContent, brief, previousChapters) }
    ];
    return { model, messages, temperature: 0.3, max_tokens: 2000 };
  }

  private buildFlagsRequest(currentFlags: Issue[], chapterContent: string, brief: ChapterBrief, model: string) {
    const messages = [
      { role: 'system' as const, content: continuitySystemPrompt },
      { role: 'user' as const, content: continuityFlagsPrompt(currentFlags, chapterContent, brief) }
    ];
    return { model, messages, temperature: 0.2, max_tokens: 1500 };
  }

  private addChapterToIssues(issues: Issue[], chapterNumber: number): Issue[] {
    return issues.map(issue => ({ ...issue, chapter: chapterNumber }));
  }
}
