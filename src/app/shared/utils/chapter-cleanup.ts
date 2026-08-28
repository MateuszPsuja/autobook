/**
 * Chapter text cleanup utilities.
 *
 * Some chat-tuned LLMs, when given a "target word count" instruction,
 * try to count as they write and end up embedding per-word indexes
 * inline:
 *
 *   "Count: A1 banner2 fluttered3 ... snap91. 91 words. ECHOES OF TOMORROW 10"
 *
 * This module provides `stripRunningWordCount` to clean that pattern
 * out of stored chapter content. The cleanup is intentionally
 * conservative — it only fires on a strong signal (the "Count:" prefix
 * or a trailing "N words." summary, combined with a high density of
 * `\w+\d+` matches) so it never mangles normal prose like "page 42",
 * "iPhone 15", "Room 101", or a legitimate sentence-end "100 words."
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

  const hasCountPrefix = PREFIX_RE.test(text);
  const hasWordsSuffix = SUFFIX_WORDS_RE.test(text.trim());
  if (!hasCountPrefix && !hasWordsSuffix) return text;

  // Density check: count "letter+digits" matches. A high density (>30%
  // of words) confirms the corruption pattern; without it we leave the
  // text alone.
  const counterMatches = text.match(COUNTER_RE) || [];
  const totalWords = (text.match(WORD_RE) || []).length;
  const density = totalWords > 0 ? counterMatches.length / totalWords : 0;
  if (density < 0.3 && !hasCountPrefix) return text;

  let result = text;
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
