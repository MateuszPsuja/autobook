import { BookConfig } from './book-config.model';
import { Chapter, ChapterDraft } from './chapter.model';
import { CritiqueReport } from './critique.model';
import { CharacterState } from './character.model';

export interface GenerationStats {
  startTime: Date | null;
  endTime: Date | null;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalWords: number;
  agentStats: {
    [key in AgentType]: {
      calls: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
}

export function createInitialStats(): GenerationStats {
  const agentStats: GenerationStats['agentStats'] = {
    architect: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    author: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    critic: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    reviser: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    character: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    continuity: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  };
  
  return {
    startTime: null,
    endTime: null,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalWords: 0,
    agentStats
  };
}

export interface BookState {
  config: BookConfig;
  blueprint: Blueprint | null;
  chapters: Chapter[];
  currentDraft: ChapterDraft | null;
  characterStore: Record<string, CharacterState>;
  worldStateDoc: string;
  critique: CritiqueReport | null;
  revisionCount: number;
  continuityFlags: Issue[];
  activeAgent: AgentType | null;
  status: GenerationStatus;
  error: string | null;
  stats: GenerationStats;
}

export interface Blueprint {
  chapters: ChapterBrief[];
  characterArcs: CharacterArc[];
  worldBuilding: WorldBuildingElement[];
  themes: string[];
  keyPlotPoints: string[];
}

export interface ChapterBrief {
  number: number;
  title: string;
  plotBeat: string;
  povCharacter: string;
  emotionalState: string;
  location: string;
  keyEvents: string[];
  hookType: string;
  targetWordCount: number;
}

export interface CharacterArc {
  name: string;
  arcType: 'Positive' | 'Negative' | 'Flat';
  startingState: string;
  endingState: string;
  keyMoments: string[];
}

export interface WorldBuildingElement {
  name: string;
  description: string;
  rules: string[];
  significance: string;
}

export interface Issue {
  type: 'Continuity' | 'Character' | 'WorldBuilding';
  description: string;
  severity: 'Low' | 'Medium' | 'High';
  chapter: number;
  suggestedFix: string;
}

export type AgentType = 
  | 'architect'
  | 'author'
  | 'critic'
  | 'reviser'
  | 'character'
  | 'continuity';

export type GenerationStatus = 
  | 'idle'
  | 'configuring'
  | 'generating'
  | 'writing'
  | 'critiquing'
  | 'revising'
  | 'completed'
  | 'error';

export interface AuthorContext {
  model: string;
  chapterBrief: ChapterBrief;
  previousChapters: Chapter[];
  characterState: CharacterState;
  worldState: string;
  currentDraft?: ChapterDraft;
}

export interface CriticContext {
  model: string;
  chapterBrief: ChapterBrief;
  chapterContent: string;
  characterState: CharacterState;
  worldState: string;
  previousChapters: Chapter[];
}
