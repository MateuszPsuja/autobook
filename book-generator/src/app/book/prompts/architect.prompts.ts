import { BookConfig } from '../../models/book-config.model';
import { Blueprint, ChapterBrief } from '../../models/book-state.model';

export const architectSystemPrompt = `
You are a master architect for long-form narrative fiction. Your task is to design a complete story blueprint that will guide the writing of a publication-quality book.

**Core Principles:**
- Every chapter must advance the plot, develop character, or build the world
- The story must have a clear narrative arc with rising tension
- Character motivations must be clear and consistent
- World-building must be integrated naturally into the plot
- The blueprint must be detailed enough to guide chapter-by-chapter writing

**Output Format:**
Return a JSON object with the following structure:
{
  "chapters": [
    {
      "number": 1,
      "title": "Chapter Title",
      "plotBeat": "What happens in this chapter",
      "povCharacter": "Character name",
      "emotionalState": "Character's emotional state",
      "location": "Where this chapter takes place",
      "keyEvents": ["Event 1", "Event 2", "Event 3"],
      "hookType": "What hooks the reader for the next chapter",
      "targetWordCount": 3000
    }
  ],
  "characterArcs": [
    {
      "name": "Character Name",
      "arcType": "Positive/Negative/Flat",
      "startingState": "Initial state",
      "endingState": "Final state",
      "keyMoments": ["Moment 1", "Moment 2", "Moment 3"]
    }
  ],
  "worldBuilding": [
    {
      "name": "World Element",
      "description": "What it is",
      "rules": ["Rule 1", "Rule 2", "Rule 3"],
      "significance": "Why it matters to the story"
    }
  ],
  "themes": ["Theme 1", "Theme 2", "Theme 3"],
  "keyPlotPoints": ["Plot Point 1", "Plot Point 2", "Plot Point 3"]
}

**Important:**
- Do not write prose, only the blueprint structure
- Each chapter should be distinct and necessary
- Character arcs should span the entire story
- World-building should be relevant to the plot
- Themes should be woven throughout the narrative
`;

/**
 * Determine chapter count based on book length string.
 * Uses includes() to handle values like "Short Story (5,000-10,000 words)"
 */
const getChapterCount = (length: string): string => {
  if (length.includes('Short Story')) return '3-5';
  if (length.includes('Novella')) return '6-10';
  if (length.includes('Long Novel')) return '25-40';
  if (length.includes('Novel')) return '15-25';
  return '15-25'; // Default fallback
};

export const architectBookPrompt = (config: BookConfig): string => `
Design a blueprint for a book with the following specifications:

**Book Details:**
- Title: ${config.title}
- Genre: ${config.genre}
- Writing Style: ${config.style}
- Tone: ${config.tone}
- POV: ${config.pov}
- Tense: ${config.tense}
- Target Audience: ${config.audience}
- Plot Archetype: ${config.plotArchetype}
- Act Structure: ${config.actStructure}
- Target Length: ${config.targetLength}
- Chapter Length: ${config.chapterLength}

**Characters:**
- Protagonist: ${config.protagonist.name} (${config.protagonist.background})
- Antagonist: ${config.antagonist.name} (${config.antagonist.background})

**Themes:** ${config.themes.join(', ')}

**World Type:** ${config.worldType}

**Requirements:**
1. Design ${getChapterCount(config.targetLength)} chapters
2. Each chapter should have a clear purpose in the narrative
3. Include character development throughout
4. Integrate world-building elements naturally
5. Ensure the story has a satisfying arc
6. Consider the target audience's expectations
7. Align with the chosen plot archetype and act structure

**Output:**
Return only the JSON blueprint as specified in the system prompt. Do not include any additional text, explanations, or formatting.
`;
