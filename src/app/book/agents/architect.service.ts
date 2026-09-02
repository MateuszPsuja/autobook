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
          return { data: this.sanitizeBriefTitles(blueprint), usage: extractUsage(response) };
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

    const blueprint: Blueprint = {
      chapters,
      characterArcs: [],
      worldBuilding: [],
      themes: Array.isArray(config.themes) ? config.themes : [],
      keyPlotPoints: [],
    };
    return this.sanitizeBriefTitles(blueprint);
  }

  /**
   * Rewrite any chapter title that the model emitted as a placeholder
   * (e.g. "Chapter", "Chapter 1", "Chapter Title", "Untitled"). The
   * architect prompt forbids these, but weaker models copy the
   * example value verbatim, so this is a defensive safety net that
   * guarantees the user always sees a real title in the chapter list
   * and the PDF table of contents.
   *
   * Strategy: derive a 2–6 word title from the chapter's own
   * `plotBeat`. If the plotBeat is also generic (e.g. the fallback
   * blueprint's "Chapter N of the story — …"), fall back to
   * "Chapter N: <POV character's stage of the journey>".
   */
  private sanitizeBriefTitles(blueprint: Blueprint): Blueprint {
    if (!blueprint?.chapters?.length) return blueprint;
    blueprint.chapters = blueprint.chapters.map((brief) => {
      const cleaned = (brief.title ?? '').trim();
      if (cleaned && !this.isBannedTitle(cleaned)) {
        return { ...brief, title: cleaned };
      }
      const synthesized = this.deriveTitleFromPlotBeat(brief.plotBeat, brief.number, brief.povCharacter);
      if (cleaned !== synthesized) {
        console.warn(
          `Architect: sanitised chapter ${brief.number} title from "${cleaned}" to "${synthesized}".`,
        );
      }
      return { ...brief, title: synthesized };
    });
    return blueprint;
  }

  /**
   * True if `title` is a placeholder / banned pattern the post-processor
   * must rewrite. Matches:
   *   - empty / whitespace-only
   *   - "Untitled"
   *   - "Chapter", "Chapter 1", "Chapter 12", "Chapter One", "Chapter 1." (any
   *     "Chapter [N]" label with NO descriptive content after it)
   *   - "Chapter Title" (the literal placeholder from the old prompt)
   *
   * Explicitly allowed: "Chapter 1: The Beginning", "Chapter One — The Fall",
   * and anything else that has descriptive content after the "Chapter N"
   * label, since those are real, user-readable titles.
   */
  private isBannedTitle(title: string): boolean {
    const t = title.trim();
    if (!t) return true;
    if (/^untitled$/i.test(t)) return true;
    if (/^chapter\s+title$/i.test(t)) return true;
    // Just "Chapter", "Chapter 1", "Chapter 12", "Chapter One", with
    // optional trailing dot/colon and nothing after. The `$` anchor
    // means "Chapter 1: The Beginning" is NOT banned.
    if (/^chapter(\s+(\d+|[A-Za-z]+))?\.?\s*$/i.test(t)) return true;
    return false;
  }

  /**
   * Produce a 2–6 word title from the chapter's plotBeat. Strips
   * leading "Chapter N" / "Chapter N of the story" boilerplate,
   * drops filler words, and Title Cases the result. Falls back to
   * "Chapter N: The Journey Continues" if the plotBeat is unusable.
   */
  private deriveTitleFromPlotBeat(plotBeat: string | undefined, number: number, povCharacter?: string): string {
    const FALLBACK = `Chapter ${number}: The Journey Continues`;
    if (!plotBeat) return FALLBACK;

    let text = plotBeat
      .replace(/^chapter\s+\w+\s+of\s+the\s+story\s*[—\-–:]\s*/i, '')
      .replace(/^chapter\s+\d+\s*[—\-–:]\s*/i, '')
      .replace(/^advance\s+the\s+plot[,\s]*/i, '')
      .trim();
    if (!text) return FALLBACK;

    // Keep the first ~10 words, drop common stopwords at the
    // start so the title doesn't lead with "The" or "A", and strip
    // trailing stopwords so we don't end on "…and" or "…the". The
    // pick limit is loose (10) so a 6-word target survives even when
    // a few stopwords get skipped or stripped.
    const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'as', 'by', 'with', 'from']);
    const words = text.split(/\s+/).filter(Boolean);
    const picked: string[] = [];
    for (const w of words) {
      if (picked.length >= 10) break;
      const clean = w.replace(/[^\p{L}\p{N}'’\-]/gu, '');
      if (!clean) continue;
      if (picked.length === 0 && STOP.has(clean.toLowerCase())) continue;
      picked.push(clean);
    }
    while (picked.length > 1 && STOP.has(picked[picked.length - 1].toLowerCase())) {
      picked.pop();
    }
    // Cap to 8 words max for a tight, readable title.
    if (picked.length > 8) picked.length = 8;
    if (picked.length === 0) return FALLBACK;
    if (picked.length === 1) {
      // Single-word title — give it more context using the POV.
      return povCharacter
        ? `${this.titleCase(picked[0])} — ${povCharacter}'s Turn`
        : this.titleCase(picked[0]);
    }
    return this.titleCase(picked.join(' '));
  }

  /** Title-case each word while preserving common short words lowercased. */
  private titleCase(s: string): string {
    const LOW = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'up', 'yet']);
    const parts = s.split(/\s+/);
    return parts
      .map((w, i) => {
        const lower = w.toLowerCase();
        // Always lowercase common stopwords (including the last word) so
        // titles read like "Storm Rolls in and the Bridge" rather than
        // "Storm Rolls in and the Bridge".
        if (LOW.has(lower)) return lower;
        // Preserve internal capitalisation (e.g. "Mara's", "Millhaven").
        if (/[A-Z]/.test(w.slice(1))) return w;
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(' ');
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
