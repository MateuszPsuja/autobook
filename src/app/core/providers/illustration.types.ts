import { Chapter } from '../../models/chapter.model';
import { BookConfig } from '../../models/book-config.model';
import { CharacterState } from '../../models/character.model';
import { Blueprint } from '../../models/book-state.model';

export type IllustrationStyle =
  | 'auto' | 'photorealistic' | 'watercolor' | 'oil-painting'
  | 'digital-art' | 'pencil-sketch' | 'anime' | 'comic';

export interface ChapterIllustration {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png';
  /** e.g. "Chapter 3 · A storm gathers over the harbor" */
  caption: string;
}

export interface CharacterReference {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png';
  characterName: string;
}

export interface BookCoverArt {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png';
  side: 'front' | 'back';
}

export interface IllustrationResult {
  chapterIllustrations: Map<string, ChapterIllustration>;
  coverArt?: BookCoverArt;
  backCoverArt?: BookCoverArt;
  /** count of successful + failed image calls for progress reporting */
  totalCalls: number;
  completedCalls: number;
}

export interface IllustrationRequest {
  chapters: Chapter[];
  config: BookConfig;
  /**
   * Architect's blueprint. Each chapter in `chapters` has a matching
   * `ChapterBrief` (looked up by `chapter.number`) with structured
   * fields (title, plotBeat, povCharacter, location, keyEvents,
   * emotionalState, hookType). When present, the brief is the
   * primary source of truth for the chapter plate's scene — the
   * 600-char prose excerpt is now a fallback. The blueprint's
   * top-level `keyPlotPoints` and `characterArcs` also feed the
   * cover scene LLM call so covers reflect the actual story
   * instead of inventing a generic "iconic moment" from the title.
   * Null when the book was generated without a blueprint (e.g.
   * hand-imported) — the service falls back to the old behaviour.
   */
  blueprint?: Blueprint | null;
  characterStore: Record<string, CharacterState>;
  style: IllustrationStyle;
  onProgress?: (completed: number, total: number) => void;
  /** returns true if the user requested stop */
  signal?: () => boolean;
}
