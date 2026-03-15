export interface BookConfig {
  title: string;
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
  role: 'Protagonist' | 'Antagonist' | 'Supporting';
  age: number;
  background: string;
  motivations: string[];
  flaws: string[];
  arc: string;
}