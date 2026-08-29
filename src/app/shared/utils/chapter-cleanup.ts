/**
 * Chapter text cleanup utilities.
 *
 * Two kinds of LLM output corruption are handled here:
 *
 * 1. Running word counter. Some chat-tuned LLMs, when given a "target
 *    word count" instruction, try to count as they write and end up
 *    embedding per-word indexes inline:
 *
 *      "Count: A1 banner2 fluttered3 ... snap91. 91 words. ECHOES OF TOMORROW 10"
 *
 *    `stripRunningWordCount` cleans that pattern out of stored chapter
 *    content. The cleanup is intentionally conservative — it only
 *    fires on a strong signal (the "Count:" prefix or a trailing "N
 *    words." summary, combined with a high density of `\w+\d+` matches)
 *    so it never mangles normal prose like "page 42", "iPhone 15",
 *    "Room 101", or a legitimate sentence-end "100 words."
 *
 * 2. Reasoning preamble. Reasoning-capable models (DeepSeek R1, Claude
 *    with extended thinking, o1, etc.) and chat-tuned models will
 *    sometimes begin their reply with a "thinking" block before the
 *    actual chapter prose:
 *
 *      "Here's a thinking process:\n\n1. **Analyze the Request:**\n
 *       - point a\n   - point b\n\n2. **Draft:**\n  - hook\n  - body\n\n
 *       [actual prose starts here]"
 *
 *    `stripReasoningPreamble` detects a small set of common markers,
 *    then walks the content until it finds a paragraph that looks
 *    like narrative prose (no list / header markers, has sentence
 *    punctuation). Everything before that paragraph is discarded.
 */

const COUNTER_RE = /\b\p{L}+[^\p{L}\s\d]*\d+/gu;
const WORD_RE = /\b\p{L}+\b/gu;

const PREFIX_RE = /^\s*(?:count|counting)\s*[:\-]\s*/i;
const SUFFIX_WORDS_RE = /\s*\b\d+\s*words?\.?\s*$/i;
const SUFFIX_TITLE_RE =
  /\s+[A-Z][A-Z0-9 '\-]{2,}(?:\s+[A-Z0-9]+)?\s*$/;
const COUNTER_STRIP_RE =
  /\b(\p{L}+)([^\p{L}\s\d]*)\d+(?=[\s.,;:!?"')\]]|$)/gu;

export function stripRunningWordCount(text: string): string {
  if (!text) return text;

  // Always strip any reasoning preamble first. If the model only
  // emitted its chain-of-thought and never produced real prose, this
  // will return an empty string, which is the right answer — the
  // orchestrator's empty-content check will then trigger a retry.
  let result = stripReasoningPreamble(text);

  const hasCountPrefix = PREFIX_RE.test(result);
  const hasWordsSuffix = SUFFIX_WORDS_RE.test(result.trim());
  if (!hasCountPrefix && !hasWordsSuffix) return result;

  // Density check: count "letter+digits" matches. A high density (>30%
  // of words) confirms the corruption pattern; without it we leave the
  // text alone.
  const counterMatches = result.match(COUNTER_RE) || [];
  const totalWords = (result.match(WORD_RE) || []).length;
  const density = totalWords > 0 ? counterMatches.length / totalWords : 0;
  if (density < 0.3 && !hasCountPrefix) return result;

  // 1. Strip the leading "Count:" or "Counting:" prefix.
  result = result.replace(PREFIX_RE, '');

  // 2. Strip per-word counters. The non-digit constraint in the
  //    character class is critical — without it the engine splits the
  //    digit run between the punctuation class and `\d+`.
  //    e.g. "snap91."      → "snap."
  //         "lamppost,6 "  → "lamppost, "
  //         "the seal — a53"  → "the seal — a"
  result = result.replace(COUNTER_STRIP_RE, '$1$2');

  // 3. Strip a trailing all-caps title + chapter number (e.g.
  //    "ECHOES OF TOMORROW 10"). Run before the words summary so the
  //    "$" anchor in the next step matches the actual end of string.
  result = result.replace(SUFFIX_TITLE_RE, (m) => {
    const stripped = m.trim();
    if (stripped.length > 80) return m;
    if (!/\s+\d+\s*$/.test(stripped)) return m;
    if (/[.!?]$/.test(stripped)) return m;
    return '';
  });

  // 4. Strip a trailing "N words." / "N word." summary line.
  result = result.replace(SUFFIX_WORDS_RE, '');

  return result.trim();
}

/**
 * Markers that the LLM uses to announce the start of its reasoning
 * block. We only match at the very start of the content — a chapter
 * that legitimately contains the phrase "let me think about it" in
 * dialogue is not a reasoning preamble.
 */
const REASONING_PREAMBLE_RE = /^\s*(?:\*\*)?(?:here(?:'s| is)\s+(?:a|my)\s+thinking\s+process[:.]?|thinking\s+process[:.]?|thinking[:.]?|let\s+me\s+(?:think|plan|analyze|consider|outline|draft)[:.]?|my\s+(?:approach|plan|outline)[:.]?|step\s+1\b|first[,]?\s*let\s+me\s+(?:think|plan|analyze|consider))/i;

/**
 * Lines that look like structured reasoning (numbered list, bulleted
 * list, bold-led section, "Step N:" labeled line, ATX header, or
 * blockquote) rather than narrative prose. The first paragraph that's
 * none of these is where the actual chapter begins.
 */
const STRUCTURED_LINE_RE = /^\s*(?:\d+[.)]\s+|[-*+]\s+|#+\s+|>\s+|\*\*[^*]|Step\s+\d+\b)/;

/**
 * Detect and strip a reasoning preamble from the start of the content.
 * Returns the original text (trimmed) when no preamble is detected, so
 * it's safe to call unconditionally.
 */
export function stripReasoningPreamble(text: string): string {
  if (!text) return text;
  if (!REASONING_PREAMBLE_RE.test(text)) return text.trim();

  const lines = text.split('\n');

  // Skip the preamble-marker line itself (and any blank lines that
  // immediately follow it).
  let i = 0;
  while (i < lines.length && (REASONING_PREAMBLE_RE.test(lines[i]) || lines[i].trim() === '')) {
    i++;
  }

  // Walk through any structured-reasoning lines (numbered list, bulleted
  // list, bold-led sections, "Step N:" labels, ATX headers, blockquotes).
  // The first non-structured line — ideally one with sentence-ending
  // punctuation — is where the prose begins.
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      // Blank line: peek at the next non-blank line. If it is structured
      // (list, bold header, etc.) keep walking; if it looks like prose,
      // the chapter starts there. Blank lines often separate the
      // reasoning block from the actual chapter.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const next = lines[j];
      if (next === undefined) break;
      if (!STRUCTURED_LINE_RE.test(next) && /[.!?]/.test(next)) {
        return lines.slice(j).join('\n').trim();
      }
      i = j;
      continue;
    }

    if (STRUCTURED_LINE_RE.test(trimmed)) {
      i++;
      continue;
    }

    // First non-structured line. If it has sentence punctuation, treat
    // it as the start of the chapter. Otherwise keep walking — could be
    // a stray label or a single-line preamble.
    if (/[.!?]/.test(trimmed)) {
      return lines.slice(i).join('\n').trim();
    }

    i++;
  }

  // We never found a clear "this is prose" signal. The whole content
  // is reasoning. Return empty so the orchestrator's empty-content
  // check triggers a retry.
  return '';
}
