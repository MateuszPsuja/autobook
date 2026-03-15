import { CritiqueReport } from './critique.model';
import { CharacterState } from './character.model';
import { ChapterBrief } from './book-state.model';

export interface Chapter {
  id: string;
  number: number;
  title: string;
  content: string;
  wordCount: number;
  status: 'draft' | 'approved' | 'revised';
  createdAt: Date;
  approvedAt?: Date;
  critique?: CritiqueReport;
  revisions: ChapterRevision[];
}

export interface ChapterDraft {
  chapterId: string;
  content: string;
  wordCount: number;
  progress: number; // 0-100
  createdAt: Date;
  updatedAt: Date;
}

export interface ChapterRevision {
  id: string;
  content: string;
  reason: string;
  createdAt: Date;
  critique?: CritiqueReport;
}

export interface AuthorContext {
  chapterBrief: ChapterBrief;
  previousChapters: Chapter[];
  characterState: CharacterState | null;
  worldState: string;
  currentChapterNumber: number;
}

export interface CriticContext {
  chapterBrief: ChapterBrief;
  chapterContent: string;
  previousChapters: Chapter[];
  characterState: CharacterState | null;
  worldState: string;
}
