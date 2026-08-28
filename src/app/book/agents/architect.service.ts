import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { JsonParserService } from '../../shared/utils/json-parser.service';
import { BookConfig, BookLength, ChapterLength } from '../../models/book-config.model';
import { Blueprint, ChapterBrief } from '../../models/book-state.model';
import { architectSystemPrompt, architectBookPrompt } from '../prompts/architect.prompts';
import { ApiResult, extractUsage, defaultUsage } from '../../shared/utils/api-result.util';

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
   * Generate a complete story blueprint with usage tracking. If the LLM
   * returns an empty response, refuses, or produces unparseable output,
   * fall back to a minimal blueprint derived from the book config so
   * the rest of the pipeline can still produce something. Paper bots
   * in particular should not abort a whole book because the architect
   * agent had a bad response.
   */
  generateBlueprintWithUsage(config: BookConfig): Observable<ArchitectResult> {
    return this.apiService.chatCompletion(this.buildRequest(config)).pipe(
      map(response => {
        const content = response?.choices?.[0]?.message?.content;
        if (!content) {
          console.warn('Architect returned no content; using fallback blueprint.');
          return { data: this.buildFallbackBlueprint(config), usage: extractUsage(response) };
        }

        try {
          const blueprint = this.jsonParser.parse<Blueprint>(content);
          return { data: blueprint, usage: extractUsage(response) };
        } catch (e) {
          console.warn(
            'Architect response was not parseable JSON; using fallback blueprint. Error:',
            (e as Error).message,
          );
          return { data: this.buildFallbackBlueprint(config), usage: extractUsage(response) };
        }
      }),
    );
  }

  /**
   * Build a minimal blueprint from the book config when the architect
   * agent can't produce one. Chapter count and target word count are
   * derived from the configured targetLength / chapterLength.
   */
  private buildFallbackBlueprint(config: BookConfig): Blueprint {
    const chapterCount = this.estimateChapterCount(config.targetLength);
    const targetWordCount = this.estimateWordCount(config.chapterLength);
    const pov = config.protagonist?.name || 'the protagonist';

    const chapters: ChapterBrief[] = [];
    for (let i = 1; i <= chapterCount; i++) {
      chapters.push({
        number: i,
        title: `Chapter ${i}`,
        plotBeat: `Chapter ${i} of the story — advance the plot, develop ${pov}, and build toward the climax.`,
        povCharacter: pov,
        emotionalState: 'engaged',
        location: 'as established by previous chapters',
        keyEvents: [`Key event ${i}`],
        hookType: i < chapterCount ? 'continuation' : 'resolution',
        targetWordCount,
      });
    }

    return {
      chapters,
      characterArcs: [],
      worldBuilding: [],
      themes: Array.isArray(config.themes) ? config.themes : [],
      keyPlotPoints: [],
    };
  }

  private estimateChapterCount(targetLength: BookLength | undefined): number {
    switch (targetLength) {
      case 'Short Story': return 3;
      case 'Novella': return 7;
      case 'Novel': return 15;
      case 'Epic': return 25;
      default: return 5;
    }
  }

  private estimateWordCount(chapterLength: ChapterLength | undefined): number {
    switch (chapterLength) {
      case 'Short': return 1500;
      case 'Long': return 3500;
      case 'Standard':
      default: return 2500;
    }
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
