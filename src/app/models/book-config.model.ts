export interface BookConfig {
  title: string;
  /**
   * Optional free-form plot / story description from the user. When set,
   * the Architect uses it as the authoritative anchor for the blueprint;
   * structural inputs (genre, archetype, characters) fill in the gaps.
   * When empty, the Architect invents the plot from those structural inputs.
   */
  plot?: string;
  genre: Genre;
  style: WritingStyle;
  tone: Tone;
  pov: PointOfView;
  tense: Tense;
  audience: Audience;
  plotArchetype: PlotArchetype;
  actStructure: ActStructure;
  themes: string[];           // max 5
  worldType: WorldType;
  targetLength: BookLength;
  chapterLength: ChapterLength;
  protagonist: CharacterProfile;
  antagonist: CharacterProfile;
  /**
   * Optional secondary cast. Each entry is a full `CharacterProfile` so
   * the prompts (architect/author/character) can reference them like any
   * other character. The form lets the user add them with a stripped
   * UI (name + role + notes) and fills the unused fields with safe
   * defaults (empty arrays / zero age) so the profile stays valid.
   */
  supportingCharacters?: CharacterProfile[];
  hasPrologue: boolean;
  hasEpilogue: boolean;
  model: string;             // single OpenRouter model ID for all agents
}

// Enums and types
export type Genre = 
  | 'Fantasy'
  | 'Science Fiction'
  | 'Mystery'
  | 'Romance'
  | 'Thriller'
  | 'Historical Fiction'
  | 'Literary Fiction'
  | 'Horror'
  | 'Young Adult'
  | 'Non-Fiction';

export type WritingStyle = 
  | 'Literary'
  | 'Commercial'
  | 'Genre Fiction'
  | 'Experimental'
  | 'Minimalist'
  | 'Epic';

export type Tone = 
  | 'Serious'
  | 'Humorous'
  | 'Dark'
  | 'Hopeful'
  | 'Satirical'
  | 'Mysterious'
  | 'Romantic'
  | 'Epic';

export type PointOfView = 
  | 'First Person'
  | 'Third Person Limited'
  | 'Third Person Omniscient'
  | 'Second Person';

export type Tense = 
  | 'Past'
  | 'Present'
  | 'Future';

export type Audience = 
  | 'Young Adult'
  | 'Adult'
  | 'Middle Grade'
  | 'New Adult';

export type PlotArchetype = 
  | 'Hero\'s Journey'
  | 'Rags to Riches'
  | 'Quest'
  | 'Voyage and Return'
  | 'Comedy'
  | 'Tragedy'
  | 'Rebirth';

export type ActStructure = 
  | 'Three Act'
  | 'Five Act'
  | 'Seven Point'
  | 'Save the Cat';

export type WorldType = 
  | 'Contemporary'
  | 'Historical'
  | 'Fantasy'
  | 'Science Fiction'
  | 'Alternate History'
  | 'Mythic';

export type BookLength = 
  | 'Short Story'
  | 'Novella'
  | 'Novel'
  | 'Epic';

export type ChapterLength = 
  | 'Short'
  | 'Standard'
  | 'Long';

export interface CharacterProfile {
  name: string;
  /**
   * `Protagonist` / `Antagonist` for the named leads, or a free-form
   * archetype string for supporting characters (e.g. "Mentor",
   * "Sidekick", "Love Interest"). The string is widened here so the
   * form's role select can store custom archetypes without forcing a
   * new union member every time.
   */
  role: string;
  age: number;
  background: string;
  motivations: string[];
  flaws: string[];
  arc: string;
}