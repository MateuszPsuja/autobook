import { ChapterBrief } from '../../models/book-state.model';
import { CharacterState, CharacterStore } from '../../models/character.model';

const buildCharacterProfiles = (characterStore: CharacterStore): string => {
  return Object.entries(characterStore).map(([name, state]) => `
**${name}:**
- Physical: ${state.currentStatus.physicalState}
- Emotional: ${state.currentStatus.emotionalState}
- Location: ${state.currentStatus.location}
- Goals: ${state.currentStatus.goals.join(', ') || 'None specified'}
- Conflicts: ${state.currentStatus.conflicts.join(', ') || 'None specified'}
- Arc Stage: ${state.development.arcStage}
- Key Moments: ${state.development.keyMoments.map(m => `Ch.${m.chapter}: ${m.event}`).join('; ') || 'None yet'}
`).join('\n');
};

export const characterSystemPrompt = `
You are a character consistency expert. Your role is to analyze chapters and ensure all character behaviors, speech patterns, and developments are consistent with established character profiles.

**Your Responsibilities:**

1. **Behavior Consistency:**
   - Actions match character's personality and abilities
   - Decisions align with character's goals and conflicts
   - Emotional responses are appropriate to character's arc

2. **Speech Pattern Consistency:**
   - Dialogue matches character's established voice
   - Vocabulary and tone are consistent
   - Speech reflects character's background and education

3. **Physical Consistency:**
   - Descriptions match established appearance
   - Actions are physically possible for the character
   - Location and movement are logical

4. **Relationship Consistency:**
   - Interactions reflect current relationship status
   - History influences current behavior appropriately
   - Emotional reactions to other characters are consistent

**Output Format:**
Return a JSON object:
{
  "violations": [
    {
      "characterName": "string",
      "issue": "string",
      "location": "string (chapter or specific text)",
      "severity": "Low|Medium|High",
      "suggestedFix": "string"
    }
  ],
  "suggestions": ["string"],
  "characterStates": {
    "characterName": {
      "emotionalState": "string",
      "physicalState": "string",
      "location": "string",
      "keyDevelopments": ["string"]
    }
  }
}

**Important:**
- Be thorough but fair - not every deviation is a violation
- Consider the character's current arc stage
- Account for intentional character growth
- Only flag real inconsistencies
`;

export const characterChapterPrompt = (
  chapterContent: string, 
  brief: ChapterBrief, 
  characterStore: CharacterStore
): string => `
Analyze this chapter for character consistency:

**Chapter Information:**
- Chapter ${brief.number}: "${brief.title}"
- POV Character: ${brief.povCharacter}
- Emotional State: ${brief.emotionalState}
- Location: ${brief.location}

**Character Profiles:**
${buildCharacterProfiles(characterStore)}

**Chapter Content:**
"${chapterContent}"

**Analysis Instructions:**
1. Check if POV character's actions and emotions match their profile
2. Verify all other characters behave consistently
3. Look for dialogue that contradicts established speech patterns
4. Identify any character development that should be tracked
5. Flag any physical descriptions that conflict with established appearance

**Output:**
Return only the JSON analysis. Do not include additional text.
`;

export const characterUpdatePrompt = (
  chapterContent: string,
  brief: ChapterBrief,
  characterStore: CharacterStore
): string => `
Based on this chapter, update the character states for tracking:

**Chapter Information:**
- Chapter ${brief.number}: "${brief.title}"
- POV Character: ${brief.povCharacter}

**Character Profiles:**
${buildCharacterProfiles(characterStore)}

**Chapter Content:**
"${chapterContent}"

**Instructions:**
1. Identify what happened to each character in this chapter
2. Update emotional states based on events
3. Note any relationship changes
4. Track key moments for character arcs
5. Update physical states if described

**Output:**
Return only a JSON object with updated characterStates as specified in the system prompt.
`;
