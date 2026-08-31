import { CritiqueReport } from './critique.model';

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
