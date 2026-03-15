import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { JsonParserService } from '../../shared/utils/json-parser.service';
import { BookConfig } from '../../models/book-config.model';
import { Blueprint } from '../../models/book-state.model';
import { architectSystemPrompt, architectBookPrompt } from '../prompts/architect.prompts';
import { ApiResult, extractUsage } from '../../shared/utils/api-result.util';

export interface ArchitectResult extends ApiResult<Blueprint> {}

@Injectable({
  providedIn: 'root'
})
export class ArchitectService {
  constructor(
    private apiService: ApiService,
    private jsonParser: JsonParserService
  ) {}

  /**
   * Generate a complete story blueprint (legacy method - use generateBlueprintWithUsage)
   */
  generateBlueprint(config: BookConfig): Observable<Blueprint> {
    return this.generateBlueprintWithUsage(config).pipe(
      map(result => result.data)
    );
  }

  /**
   * Generate a complete story blueprint with usage tracking
   */
  generateBlueprintWithUsage(config: BookConfig): Observable<ArchitectResult> {
    return this.apiService.chatCompletion(this.buildRequest(config)).pipe(
      map(response => {
        const content = response?.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error('Empty response content from architect API');
        }

        let blueprint: Blueprint;
        try {
          blueprint = this.jsonParser.parse<Blueprint>(content);
        } catch (e) {
          throw new Error('Failed to parse blueprint JSON: ' + (e as Error).message);
        }

        return { data: blueprint, usage: extractUsage(response) } as ArchitectResult;
      })
    );
  }

  private buildRequest(config: BookConfig) {
    const messages = [
      { role: 'system' as const, content: architectSystemPrompt },
      { role: 'user' as const, content: architectBookPrompt(config) }
    ];

    return {
      model: config.model,
      messages,
      temperature: 0.7,
      max_tokens: 8000
    };
  }
}
