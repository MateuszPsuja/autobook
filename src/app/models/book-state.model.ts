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
  /**
   * Optional approved prologue chapter. Lives outside `chapters` so
   * the chapter-numbering pipeline (`number !== position` check in the
   * exporter) treats it as front-matter. Persisted on the same
   * checkpoint and rendered before Chapter 1 in every export format.
   */
  prologue?: Chapter | null;
  /**
   * Optional approved epilogue chapter. Same persistence + ordering
   * rules as `prologue`; rendered after the last numbered chapter.
   */
  epilogue?: Chapter | null;
  /**
   * Chapter numbers that the orchestrator couldn't generate and
   * skipped, so the rest of the book could continue. Empty when
   * generation was clean. The user can re-trigger generation and
   * the orchestrator should retry these specifically.
   */
  skippedChapters: number[];
  /**
   * 1-based chapter number the orchestrator is currently working on,
   * or `null` before any chapter has started / after a reset. The UI
   * watches this to detect chapter boundaries and reset its pipeline
   * card row — without it, agents from a finished chapter stay
   * visually "done" and mask the next chapter's progress.
   */
  currentChapterNumber: number | null;
  stats: GenerationStats;
  /**
   * Accumulated prose text from the currently-streaming prose agent
   * (architect/author/reviser). Cleared at the start of each attempt
   * by `beginStream$`, grown token-by-token via `appendStream$`, and
   * left in place after `endStream$` so the UI can show a brief tail
   * before the card hides.
   */
  liveStream: string;
  /**
   * Which agent currently owns the stream buffer. `null` means no
   * stream is active. The stream card is visible while this is
   * non-null and for ~2s after it flips back to `null` (see
   * generator component for the tail-window logic).
   */
  liveStreamAgent: AgentType | null;
  /**
   * Epoch-ms when the current stream began, or `null` when no stream
   * is active. Used to compute tokens/sec for the live stats chips.
   */
  liveStreamStartedAt: number | null;
  /**
   * Running heuristic token estimate (`chars / 4`) of the live stream.
   * Off by ~30–50% on real prose vs API-reported totals — the per-agent
   * stats card is the source of truth for the final count.
   */
  liveTokensApprox: number;
}

export interface Blueprint {
  chapters: ChapterBrief[];
  /**
   * Optional architect-authored brief for the prologue section. Only
   * populated when the user opted in via `BookConfig.hasPrologue`.
   * Lives outside `chapters` so the rest of the orchestrator pipeline
   * (chapter numbering, skip list, etc.) is unaffected.
   */
  prologue?: ChapterBrief | null;
  /**
   * Optional architect-authored brief for the epilogue section. Same
   * shape and lifecycle rules as `prologue`.
   */
  epilogue?: ChapterBrief | null;
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
  | 'translating'
  | 'completed'
  | 'error';

/**
 * The style fields the Author's system prompt needs to render
 * the book-voice preamble. Kept small and stringy on purpose so the
 * prompt template doesn't have to depend on a full BookConfig — and
 * so a future change to BookConfig (e.g. renaming a field) can't
 * silently break the LLM prompt.
 */
export interface AuthorStyleContext {
  style: string;
  tone: string;
  pov: string;
  tense: string;
}

export interface AuthorContext {
  model: string;
  chapterBrief: ChapterBrief;
  previousChapters: Chapter[];
  characterState: CharacterState;
  worldState: string;
  currentDraft?: ChapterDraft;
  styleContext: AuthorStyleContext;
}

export interface CriticContext {
  model: string;
  chapterBrief: ChapterBrief;
  chapterContent: string;
  characterState: CharacterState;
  worldState: string;
  previousChapters: Chapter[];
}
