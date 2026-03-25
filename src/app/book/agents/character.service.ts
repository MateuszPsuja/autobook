import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
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
    
    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0].message.content;
        const parsed = this.jsonParser.parse(content) as CharacterAnalysisResponse;

        return {
          violations: parsed.violations || [],
          suggestions: parsed.suggestions || []
        };
      }),
      catchError(error => {
        console.error('Character analysis error:', error);
        return new Observable<CharacterCheckResult>(subscriber => {
          subscriber.next({ violations: [], suggestions: ['Failed to analyze character consistency'] });
          subscriber.complete();
        });
      })
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
    
    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0].message.content;
        const parsed = this.jsonParser.parse(content) as CharacterAnalysisResponse;

        const result: CharacterCheckResult = {
          violations: parsed.violations || [],
          suggestions: parsed.suggestions || []
        };

        return { data: result, usage: extractUsage(response) };
      }),
      catchError(error => {
        console.error('Character analysis error:', error);
        return new Observable<ApiResult<CharacterCheckResult>>(subscriber => {
          subscriber.next({
            data: { violations: [], suggestions: ['Failed to analyze character consistency'] },
            usage: defaultUsage()
          });
          subscriber.complete();
        });
      })
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
    
    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0].message.content;
        const parsed = this.jsonParser.parse(content) as CharacterAnalysisResponse;

        return this.applyCharacterUpdates(characterStore, parsed.characterStates, chapterNumber);
      }),
      catchError(error => {
        console.error('Character update error:', error);
        return new Observable<CharacterStore>(subscriber => {
          subscriber.next(characterStore);
          subscriber.complete();
        });
      })
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
    
    return this.apiService.chatCompletion(request).pipe(
      map(response => {
        const content = response.choices[0].message.content;
        const parsed = this.jsonParser.parse(content) as CharacterAnalysisResponse;

        const updatedStore = this.applyCharacterUpdates(characterStore, parsed.characterStates, chapterNumber);
        return { data: updatedStore, usage: extractUsage(response) };
      }),
      catchError(error => {
        console.error('Character update error:', error);
        return new Observable<ApiResult<CharacterStore>>(subscriber => {
          subscriber.next({ data: characterStore, usage: defaultUsage() });
          subscriber.complete();
        });
      })
    );
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
