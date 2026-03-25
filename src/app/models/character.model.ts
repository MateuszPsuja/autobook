import { CharacterProfile } from './book-config.model';

export interface CharacterState {
  profile: CharacterProfile;
  currentStatus: CharacterStatus;
  relationships: CharacterRelationship[];
  development: CharacterDevelopment;
  lastUpdated: Date;
}

export interface CharacterStatus {
  emotionalState: string;
  physicalState: string;
  location: string;
  goals: string[];
  conflicts: string[];
  relationships: string[];
}

export interface CharacterRelationship {
  characterName: string;
  relationshipType: 'Friend' | 'Enemy' | 'Ally' | 'Love Interest' | 'Family' | 'Neutral';
  currentStatus: 'Positive' | 'Negative' | 'Neutral' | 'Complex';
  history: string;
  lastInteraction: string;
}

export interface CharacterDevelopment {
  arcStage: 'Introduction' | 'Development' | 'Crisis' | 'Resolution';
  keyMoments: CharacterMoment[];
  growthAreas: string[];
  remainingFlaws: string[];
}

export interface CharacterMoment {
  chapter: number;
  event: string;
  impact: string;
  emotionalChange: string;
  relationshipChange?: string;
}

export interface CharacterStore {
  [characterName: string]: CharacterState;
}