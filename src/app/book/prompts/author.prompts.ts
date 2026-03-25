import { BookConfig } from '../../models/book-config.model';
import { ChapterBrief, AuthorContext } from '../../models/book-state.model';
import { Chapter } from '../../models/chapter.model';

const getPreviousChapterClosing = (previousChapters: Chapter[]): string => {
  if (previousChapters.length === 0) {
    return 'Beginning of the story.';
  }
  const lastChapter = previousChapters[previousChapters.length - 1];
  if (!lastChapter || !lastChapter.content) {
    return 'Previous chapter content not available.';
  }
  return lastChapter.content.slice(-500);
};

export const authorSystemPrompt = (config: BookConfig): string => `
You are a literary novelist writing in the ${config.style} style.
Tone: ${config.tone}. POV: ${config.pov}. Tense: ${config.tense}.

**Core Principles:**
- You never summarize when you can dramatize
- Show character through action and dialogue, not exposition
- You do not use clichés
- You trust the reader to understand subtext
- Every scene must have purpose and tension
- Dialogue should reveal character and advance plot
- Description should be sensory and meaningful
- Pacing should vary appropriately for the scene

**Writing Guidelines:**
- Use vivid, specific details
- Show emotions through physical reactions and actions
- Use dialogue tags sparingly and effectively
- Vary sentence structure for rhythm
- Use metaphors and similes purposefully
- Avoid info-dumping and exposition
- Every paragraph should earn its place
- Maintain consistent voice and style

**Technical Requirements:**
- Write in complete prose only
- Do not include chapter summaries or explanations
- Do not break the fourth wall
- Do not address the reader directly
- Maintain consistent tense and POV
- Use proper grammar and punctuation
- Target word count: as specified in chapter brief
`;

export const authorChapterPrompt = (brief: ChapterBrief, ctx: AuthorContext): string => `
Write Chapter ${brief.number}: "${brief.title}"

**Context:**
Previous chapter ended with: ${getPreviousChapterClosing(ctx.previousChapters)}

**Chapter Purpose:**
${brief.plotBeat}

**Character Focus:**
POV character: ${brief.povCharacter}
Emotional state: ${brief.emotionalState}

**Setting:**
Location: ${brief.location}

**Key Events to Include:**
${brief.keyEvents.map((event, index) => `${index + 1}. ${event}`).join('\n')}

**Chapter Requirements:**
- Hook type: ${brief.hookType}
- Target word count: ${brief.targetWordCount} words
- Must advance the overall plot
- Must develop character in some way
- Must maintain narrative tension
- Must be self-contained but connected to larger story

**Writing Instructions:**
1. Start with a strong hook that connects to the previous chapter
2. Develop the key events naturally through action and dialogue
3. Show character development through choices and reactions
4. Build tension throughout the chapter
5. End with the specified hook type to lead into the next chapter
6. Ensure the chapter feels complete while leaving readers wanting more

**Output:**
Write the complete chapter in full prose. Do not include any summaries, explanations, or meta-commentary. Just the story.
`;

export const authorRevisionPrompt = (draft: string, critique: any, brief: ChapterBrief): string => `
You are revising a chapter based on critical feedback. The original chapter was:

"${draft}"

**Critique Summary:**
Overall Score: ${critique.overallScore}/10

**Must Fix Issues:**
${critique.mustFix.map((issue: string, index: number) => `${index + 1}. ${issue}`).join('\n')}

**Suggestions:**
${critique.suggestions.map((suggestion: string, index: number) => `${index + 1}. ${suggestion}`).join('\n')}

**Scores by Category:**
- Prose: ${critique.scores.prose}/10
- Pacing: ${critique.scores.pacing}/10
- Show vs Tell: ${critique.scores.showVsTell}/10
- Dialogue: ${critique.scores.dialogue}/10
- Continuity: ${critique.scores.continuity}/10
- Hook Strength: ${critique.scores.hookStrength}/10
- Thematic Resonance: ${critique.scores.thematicResonance}/10

**Chapter Context:**
Chapter ${brief.number}: "${brief.title}"
Purpose: ${brief.plotBeat}
Target Word Count: ${brief.targetWordCount}

**Revision Instructions:**
1. Address all "Must Fix" issues first
2. Consider the suggestions for improvement
3. Maintain the chapter's purpose and key events
4. Preserve the overall word count target
5. Improve the areas with lowest scores
6. Ensure the chapter still flows naturally
7. Keep the hook effective

**Output:**
Write the revised chapter in full prose. Focus on improving the specific issues identified while maintaining the chapter's integrity.
`;