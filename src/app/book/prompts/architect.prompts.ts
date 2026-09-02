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
- If the user provided a plot / story description, it is authoritative.
  Use it as the source of truth for the central conflict, characters, and
  setting. Structural inputs (genre, archetype, act structure) shape the
  form; the user plot shapes the substance. When the two conflict, the
  user plot wins.

**Output Format:**
Return a JSON object with the following structure:
{
  "chapters": [
    {
      "number": 1,
      "title": "The Cartographer's Confession",
      "plotBeat": "Mara discovers her late father's hidden map and a journal entry that frames the novel's central question.",
      "povCharacter": "Mara",
      "emotionalState": "curious, guarded",
      "location": "Her father's study at dusk",
      "keyEvents": ["Mara finds the map", "Reads the journal", "Decides to travel to Millhaven"],
      "hookType": "A knock at the door interrupts her packing",
      "targetWordCount": 3000
    },
    {
      "number": 2,
      "title": "Shadows over Millhaven",
      "plotBeat": "Mara arrives in Millhaven and learns the town has been waiting for someone from her bloodline.",
      "povCharacter": "Mara",
      "emotionalState": "uneasy, intrigued",
      "location": "The pier at Millhaven",
      "keyEvents": ["Ferry arrival", "Meets the innkeeper", "Sees the symbol from the map carved into a door"],
      "hookType": "The innkeeper locks the door behind her and asks a question she can't answer",
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

**Title rules (strict):**
- Every chapter's \`title\` must be a UNIQUE 2–6 word phrase that hints at what happens in that chapter. It is what the reader sees in the chapter list and the PDF table of contents.
- Titles must be derived from each chapter's own \`plotBeat\` — not from a template.
- BANNED title patterns (a post-processor will rewrite these, but you should not produce them): "Chapter", "Chapter N", "Chapter 1", "Chapter Title", "Untitled", or any title that is just the word "Chapter" with an optional number/colon.
- Concrete examples of GOOD titles: "The Cartographer's Confession", "Shadows over Millhaven", "A Bargain in the Bone Orchard", "The Last Train North". Keep them evocative, not generic.

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
${
  config.plot && config.plot.trim().length > 0
    ? `- User Plot / Story Description (authoritative):\n${config.plot
        .split('\n')
        .map(line => `  > ${line}`)
        .join('\n')}`
    : `- User Plot / Story Description: (none — invent from the genre, archetype, and characters below)`
}
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
