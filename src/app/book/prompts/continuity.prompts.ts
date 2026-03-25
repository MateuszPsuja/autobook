import { ChapterBrief } from '../../models/book-state.model';
import { Chapter } from '../../models/chapter.model';
import { Issue } from '../../models/book-state.model';

const buildPreviousChaptersSummary = (chapters: Chapter[]): string => {
  if (chapters.length === 0) return 'No previous chapters - this is the beginning of the story.';
  
  return chapters.map(ch => `
**Chapter ${ch.number}: ${ch.title}**
- Word Count: ${ch.wordCount}
- Content Summary: ${ch.content.slice(0, 300)}...
`).join('\n');
};

export const continuitySystemPrompt = `
You are a continuity expert specializing in maintaining story consistency across chapters. Your role is to identify and flag any inconsistencies in plot, timeline, world-building, or facts established in previous chapters.

**Your Responsibilities:**

1. **Timeline Consistency:**
   - Events occur in logical chronological order
   - Time passage is consistent (day/night, seasons)
   - No contradictory time references

2. **Plot Consistency:**
   - Plot points don't contradict each other
   - Cause and effect relationships are logical
   - Foreshadowing is properly set up

3. **World-Building Consistency:**
   - Geography and locations are consistent
   - Rules of the world are followed
   - Technology/magic systems work consistently

4. **Fact Consistency:**
   - Character names and descriptions stay the same
   - Object locations are tracked
   - Previous revelations are acknowledged

**Output Format:**
Return a JSON object:
{
  "issues": [
    {
      "type": "Continuity|WorldBuilding|Plot",
      "description": "string",
      "severity": "Low|Medium|High",
      "chapter": number,
      "suggestedFix": "string"
    }
  ],
  "overallContinuity": "Good|Fair|Poor",
  "summary": "string"
}

**Important:**
- Focus on genuine issues, not minor style preferences
- Consider that some ambiguity is acceptable
- Don't flag intentional mysteries or foreshadowing
- Be specific about locations in the text
`;

export const continuityChapterPrompt = (
  chapterContent: string,
  brief: ChapterBrief,
  previousChapters: Chapter[]
): string => `
Analyze this chapter for continuity with previous chapters:

**Current Chapter:**
- Chapter ${brief.number}: "${brief.title}"
- Location: ${brief.location}
- Key Events: ${brief.keyEvents.join(', ')}

**Previous Chapters:**
${buildPreviousChaptersSummary(previousChapters)}

**Current Chapter Content:**
"${chapterContent}"

**Analysis Instructions:**
1. Check timeline consistency with previous chapters
2. Verify location descriptions are consistent
3. Look for plot contradictions
4. Check that key events from previous chapters are referenced/acknowledged
5. Verify world-building rules are followed
6. Track objects and their locations

**Output:**
Return only the JSON analysis. Do not include additional text.
`;

export const continuityFlagsPrompt = (
  currentIssues: Issue[],
  chapterContent: string,
  brief: ChapterBrief
): string => `
Review the current continuity flags and check if this chapter addresses or introduces new issues:

**Outstanding Continuity Flags:**
${currentIssues.length > 0 ? currentIssues.map(f => `
- [${f.severity}] Chapter ${f.chapter}: ${f.description}
  Suggested Fix: ${f.suggestedFix}
`).join('\n') : 'No outstanding flags - good!'}

**Current Chapter:**
- Chapter ${brief.number}: "${brief.title}"

**Chapter Content:**
"${chapterContent}"

**Instructions:**
1. Check if any outstanding flags were addressed
2. Identify any new issues introduced
3. Update severity if issues were fixed
4. Mark resolved flags as completed

**Output:**
Return only a JSON object:
{
  "resolvedFlags": ["flag descriptions that were resolved"],
  "newFlags": [new issues as per system prompt format],
  "remainingFlags": [flags still outstanding]
}
`;
