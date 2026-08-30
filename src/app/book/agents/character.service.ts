import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { JsonParserService } from '../../shared/utils/json-parser.service';
import { ChapterBrief } from '../../models/book-state.model';
import { CharacterStore, CharacterState } from '../../models/character.model';
import { CharacterCheckResult, CharacterViolation } from '../../models/critique.model';
import { characterSystemPrompt, characterChapterPrompt, characterUpdatePrompt } from '../prompts/character.prompts';
import { ApiResult, extractUsage, defaultUsage } from '../../shared/utils/api-result.util';

interface CharacterAnalysisResponse {
  violations: CharacterViolation[];
  suggestions: string[];
  characterStates: {
    [characterName: string]: {
      emotionalState: string;
      physicalState: string;
      location: string;
      keyDevelopments: string[];
    };
  };
}

@Injectable({
  providedIn: 'root'
})
export class CharacterService {
  constructor(
    private apiService: ApiService,
    private jsonParser: JsonParserService
  ) {}

  /**
   * Check chapter for character consistency violations
   */
  checkCharacterConsistency(
    chapterContent: string,
    brief: ChapterBrief,
    characterStore: CharacterStore,
    model: string
  ): Observable<CharacterCheckResult> {
    const request = this.buildCharacterCheckRequest(chapterContent, brief, characterStore, model);
    return this.runWithRescue(request, (parsed) => ({
      violations: parsed.violations || [],
      suggestions: parsed.suggestions || []
    })).pipe(
      catchError(error => this.fallbackCheck(error))
    );
  }

  /**
   * Check chapter for character consistency with usage tracking
   */
  checkCharacterConsistencyWithUsage(
    chapterContent: string,
    brief: ChapterBrief,
    characterStore: CharacterStore,
    model: string
  ): Observable<ApiResult<CharacterCheckResult>> {
    const request = this.buildCharacterCheckRequest(chapterContent, brief, characterStore, model);
    return this.runWithRescue(request, (parsed, response) => ({
      data: {
        violations: parsed.violations || [],
        suggestions: parsed.suggestions || []
      } as CharacterCheckResult,
      usage: extractUsage(response)
    })).pipe(
      catchError(error => this.fallbackCheckWithUsage(error))
    );
  }

  /**
   * Update character states based on chapter events
   */
  updateCharacterStates(
    chapterContent: string,
    brief: ChapterBrief,
    characterStore: CharacterStore,
    chapterNumber: number,
    model: string
  ): Observable<CharacterStore> {
    const request = this.buildCharacterUpdateRequest(chapterContent, brief, characterStore);
    return this.runWithRescue(request, (parsed) =>
      this.applyCharacterUpdates(characterStore, parsed.characterStates, chapterNumber)
    ).pipe(
      catchError(error => this.fallbackUpdate(characterStore, error))
    );
  }

  /**
   * Update character states with usage tracking
   */
  updateCharacterStatesWithUsage(
    chapterContent: string,
    brief: ChapterBrief,
    characterStore: CharacterStore,
    chapterNumber: number,
    model: string
  ): Observable<ApiResult<CharacterStore>> {
    const request = this.buildCharacterUpdateRequest(chapterContent, brief, characterStore);
    return this.runWithRescue(request, (parsed, response) => ({
      data: this.applyCharacterUpdates(characterStore, parsed.characterStates, chapterNumber),
      usage: extractUsage(response)
    })).pipe(
      catchError(error => this.fallbackUpdateWithUsage(characterStore, error))
    );
  }

  /**
   * Run an LLM call, parse the JSON response, and apply a transform.
   * On empty content or parse failure, retry once with a stricter
   * "JSON only" system prompt that reuses the original user message
   * so the model still has the chapter. If both attempts fail, the
   * error is rethrown and the caller's catchError returns a fallback
   * so the chapter pipeline keeps going.
   */
  private runWithRescue<T>(request: any, transform: (parsed: CharacterAnalysisResponse, response: any) => T): Observable<T> {
    return this.apiService.chatCompletion(request).pipe(
      switchMap(response => this.handleResponse(response, request, transform))
    );
  }

  private handleResponse<T>(response: any, request: any, transform: (parsed: CharacterAnalysisResponse, response: any) => T): Observable<T> {
    const content = response.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      return this.rescueAndParse(request, transform);
    }
    try {
      const parsed = this.jsonParser.parse(content) as CharacterAnalysisResponse;
      return of(transform(parsed, response));
    } catch (parseError) {
      // First parse failed — try to extract JSON from the model's
      // own previous reply (it has the original content to work with).
      return this.rescueExtractAndParse(content, request.model, transform);
    }
  }

  /**
   * Re-runs the original evaluation under a stricter "JSON only"
   * system prompt, reusing the original user message so the model
   * still has the chapter to evaluate.
   */
  private rescueAndParse<T>(originalRequest: any, transform: (parsed: CharacterAnalysisResponse, response: any) => T): Observable<T> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content: 'You are a strict JSON evaluator. Return ONLY a single valid JSON object. No prose, no markdown, no explanations before or after. The first character of your reply must be "{" and the last must be "}".'
      },
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
          throw new Error('Character service: rescue retry returned empty content');
        }
        const parsed = this.jsonParser.parse(content) as CharacterAnalysisResponse;
        return of(transform(parsed, response));
      })
    );
  }

  private rescueExtractAndParse<T>(prevContent: string, model: string, transform: (parsed: CharacterAnalysisResponse, response: any) => T): Observable<T> {
    return this.apiService.chatCompletion({
      model,
      messages: [
        {
          role: 'system' as const,
          content: 'You are a strict JSON extractor. The user will give you a text that is supposed to contain a JSON object. Extract the JSON object and return it verbatim — no prose, no markdown, no comments. The first character of your reply must be "{" and the last must be "}".'
        },
        { role: 'user' as const, content: 'Extract the JSON object from this text:\n\n' + prevContent }
      ],
      temperature: 0.1,
      max_tokens: 2000
    }).pipe(
      switchMap(response => {
        const content = response.choices?.[0]?.message?.content;
        if (!content || content.trim().length === 0) {
          throw new Error('Character service: extract rescue returned empty content');
        }
        const parsed = this.jsonParser.parse(content) as CharacterAnalysisResponse;
        return of(transform(parsed, response));
      })
    );
  }

  private fallbackCheck(error: unknown): Observable<CharacterCheckResult> {
    console.warn('Character analysis unavailable, using empty fallback:', (error as Error)?.message || error);
    return of({ violations: [], suggestions: ['Character consistency check unavailable for this chapter'] });
  }

  private fallbackCheckWithUsage(error: unknown): Observable<ApiResult<CharacterCheckResult>> {
    console.warn('Character analysis unavailable, using empty fallback:', (error as Error)?.message || error);
    return of({
      data: { violations: [], suggestions: ['Character consistency check unavailable for this chapter'] },
      usage: defaultUsage()
    });
  }

  private fallbackUpdate(store: CharacterStore, error: unknown): Observable<CharacterStore> {
    console.warn('Character update unavailable, keeping previous state:', (error as Error)?.message || error);
    return of(store);
  }

  private fallbackUpdateWithUsage(store: CharacterStore, error: unknown): Observable<ApiResult<CharacterStore>> {
    console.warn('Character update unavailable, keeping previous state:', (error as Error)?.message || error);
    return of({ data: store, usage: defaultUsage() });
  }

  private buildCharacterCheckRequest(chapterContent: string, brief: ChapterBrief, characterStore: CharacterStore, model: string) {
    const messages = [
      { role: 'system' as const, content: characterSystemPrompt },
      { role: 'user' as const, content: characterChapterPrompt(chapterContent, brief, characterStore) }
    ];
    return { model, messages, temperature: 0.3, max_tokens: 2000 };
  }

  private buildCharacterUpdateRequest(chapterContent: string, brief: ChapterBrief, characterStore: CharacterStore) {
    const messages = [
      { role: 'system' as const, content: characterSystemPrompt },
      { role: 'user' as const, content: characterUpdatePrompt(chapterContent, brief, characterStore) }
    ];
    return { model: 'gpt-4o', messages, temperature: 0.4, max_tokens: 1500 };
  }

  private applyCharacterUpdates(
    originalStore: CharacterStore,
    characterStates: CharacterAnalysisResponse['characterStates'],
    chapterNumber: number
  ): CharacterStore {
    const updatedStore: CharacterStore = { ...originalStore };

    if (characterStates) {
      for (const [name, updates] of Object.entries(characterStates)) {
        if (updatedStore[name]) {
          updatedStore[name] = {
            ...updatedStore[name],
            currentStatus: {
              ...updatedStore[name].currentStatus,
              emotionalState: updates.emotionalState || updatedStore[name].currentStatus.emotionalState,
              physicalState: updates.physicalState || updatedStore[name].currentStatus.physicalState,
              location: updates.location || updatedStore[name].currentStatus.location
            },
            development: {
              ...updatedStore[name].development,
              keyMoments: [
                ...updatedStore[name].development.keyMoments,
                ...(updates.keyDevelopments || []).map(dev => ({
                  chapter: chapterNumber,
                  event: dev,
                  impact: `Development in chapter ${chapterNumber}`,
                  emotionalChange: updates.emotionalState,
                  relationshipChange: undefined as unknown as string
                }))
              ]
            },
            lastUpdated: new Date()
          };
        }
      }
    }

    return updatedStore;
  }
}
