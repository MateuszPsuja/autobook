import { Chapter } from '../../models/chapter.model';
import { BookConfig } from '../../models/book-config.model';
import { CharacterState } from '../../models/character.model';

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
  characterStore: Record<string, CharacterState>;
  style: IllustrationStyle;
  onProgress?: (completed: number, total: number) => void;
  /** returns true if the user requested stop */
  signal?: () => boolean;
}
