export interface CritiqueReport {
  scores: {
    prose: number;             // 1–10
    pacing: number;            // 1–10
    showVsTell: number;        // 1–10
    dialogue: number;          // 1–10
    continuity: number;        // 1–10
    hookStrength: number;      // 1–10
    thematicResonance: number; // 1–10
  };
  overallScore: number;
  feedback: string;
  mustFix: string[];
  suggestions: string[];
  createdAt: Date;
  /**
   * Set when the reviewer model failed to return a parseable critique.
   * The UI should display this message in place of the normal
   * scores/feedback/mustFix/suggestions panel.
   */
  unavailableReason?: string;
}

export interface CharacterCheckResult {
  violations: CharacterViolation[];
  suggestions: string[];
}

export interface CharacterViolation {
  characterName: string;
  issue: string;
  location: string; // chapter number or specific location
  severity: 'Low' | 'Medium' | 'High';
  suggestedFix: string;
}