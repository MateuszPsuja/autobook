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

  // Strip any XML-style reasoning blocks (<think>...</think>,
  // <|thinking|>...<|/thinking|>, <reasoning>...</reasoning>, etc.)
  // and stray `think>` / `reasoning>` blocks that some reasoning
  // models emit mid-stream. These can appear anywhere, not just at
  // the start, so we run this as a global pass after the preamble
  // strip.
  result = stripThinkingBlocks(result);

  // Handle the case where a reasoning model emits `<think>` and then
  // streams the chapter prose without ever closing the tag — the
  // regular stripThinkingBlocks pass requires a matching close and
  // would leave the entire reasoning + chapter chunk intact. This
  // pass excises the unclosed block up to the first prose paragraph.
  result = stripUnclosedThinkingBlock(result);

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
const REASONING_PREAMBLE_RE = /^\s*(?:\*\*)?(?:here(?:'s| is)\s+(?:a|my)\s+thinking\s+process[:.]?|thinking\s+process[:.]?|thinking[:.]?|think[>]|let\s+me\s+(?:think|plan|analyze|consider|outline|draft)[:.]?|my\s+(?:approach|plan|outline)[:.]?|step\s+1\b|first[,]?\s*let\s+me\s+(?:think|plan|analyze|consider))/i;

/**
 * XML-style reasoning block tags. Different reasoning models wrap
 * their chain-of-thought in different tags (DeepSeek/QwQ use
 * `<think>...</think>`, Anthropic-style adapters on some OpenRouter
 * routes use `<|thinking|>...<|/thinking|>`, others use
 * `<reasoning>...</reasoning>`). All of them leak into `chapter.content`
 * when the provider surfaces reasoning in the main `content` field
 * instead of a separate `reasoning_content` channel. The pattern is
 * deliberately permissive on the tag name and treats `<|` and `|` as
 * optional brackets.
 */
const THINKING_BLOCK_RE = /<\s*(?:\|\s*)?(?:think(?:ing)?|reasoning|thought|chain_of_thought|reflection)\s*(?:\|\s*)?>[\s\S]*?<\s*(?:\|\s*)?\/\s*(?:\|\s*)?(?:think(?:ing)?|reasoning|thought|chain_of_thought|reflection)\s*(?:\|\s*)?>/gi;

/**
 * Opening tag for a reasoning block, without requiring a matching close.
 * Some providers emit `<think>` (or `<reasoning>`, etc.) and then start
 * streaming prose without ever closing the tag — the reasoning + the
 * entire chapter end up inside one unterminated block. Matching just the
 * opener lets `stripUnclosedThinkingBlock` find and excise it.
 */
const THINKING_OPEN_RE = /<\s*(?:\|\s*)?(?:think(?:ing)?|reasoning|thought|chain_of_thought|reflection)\s*(?:\|\s*)?>/i;

/**
 * Strip reasoning that some models emit as a `think>` / `reasoning>`
 * block without ever closing it. We only strip these at the start of
 * the content (preamble case) — the structured-line walker in
 * `stripReasoningPreamble` takes over once the marker is detected.
 */
const LONE_THINK_PREAMBLE_RE = /^\s*(?:\*\*)?(?:think|reasoning|thought|plan)>/i;

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
  // The preamble regex only matches the structured English-style
  // markers (e.g. "Here's a thinking process:"). For the simpler
  // `think> ...` / `reasoning> ...` style — used by some reasoning
  // models when they leak their chain-of-thought into the main
  // content field — we additionally check for a lone `think>`-style
  // opener at the start and treat it as a preamble.
  const hasPreamble = REASONING_PREAMBLE_RE.test(text) || LONE_THINK_PREAMBLE_RE.test(text);
  if (!hasPreamble) return text.trim();

  const lines = text.split('\n');

  // Skip the preamble-marker line itself (and any blank lines that
  // immediately follow it).
  let i = 0;
  const isMarkerLine = (line: string) =>
    REASONING_PREAMBLE_RE.test(line) || LONE_THINK_PREAMBLE_RE.test(line);
  while (i < lines.length && (isMarkerLine(lines[i]) || lines[i].trim() === '')) {
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

/**
 * Remove any XML-style reasoning blocks (`<think>...</think>`,
 * `<|thinking|>...<|/thinking|>`, `<reasoning>...</reasoning>`,
 * etc.) from anywhere in the content. These can appear mid-stream
 * when a reasoning model surfaces its chain-of-thought in the main
 * `content` field instead of a separate `reasoning_content` channel.
 *
 * Returns the input unchanged when no block is found, so it's safe
 * to call unconditionally.
 */
export function stripThinkingBlocks(text: string): string {
  if (!text) return text;
  THINKING_BLOCK_RE.lastIndex = 0;
  if (!THINKING_BLOCK_RE.test(text)) return text;
  THINKING_BLOCK_RE.lastIndex = 0;
  return text.replace(THINKING_BLOCK_RE, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Detect and remove an unclosed `<think>` (or `<reasoning>`, etc.)
 * block. Some providers — typically OpenRouter routes surfacing
 * reasoning-capable models — emit the opening tag and then stream the
 * model's chain-of-thought followed by the chapter prose, all without
 * ever writing the closing tag. The standard `THINKING_BLOCK_RE` only
 * matches properly-paired blocks and leaves the entire chunk intact.
 *
 * Strategy:
 *  1. If no opening tag is present, the input is already clean.
 *  2. If the opening tag is present and has a matching close somewhere
 *     later, the standard `stripThinkingBlocks` pass handles it — bail.
 *  3. Otherwise: walk the content after the opening tag, look for the
 *     first paragraph that looks like narrative prose (long enough, has
 *     sentence punctuation, isn't a list/bold/heading line), and treat
 *     everything from the opening tag up to (but not including) that
 *     paragraph as leaked reasoning.
 *
 * Returns the input unchanged when no opener is found, so it's safe to
 * call unconditionally.
 */
export function stripUnclosedThinkingBlock(text: string): string {
  if (!text) return text;
  const openMatch = THINKING_OPEN_RE.exec(text);
  if (!openMatch) return text;

  // Already paired? Let stripThinkingBlocks handle it.
  THINKING_BLOCK_RE.lastIndex = 0;
  if (THINKING_BLOCK_RE.test(text)) return text;
  THINKING_BLOCK_RE.lastIndex = 0;

  const tail = text.slice(openMatch.index + openMatch[0].length);
  const lines = tail.split('\n');

  // Walk through and find the first paragraph that looks like actual
  // narrative prose. The reasoning block that follows an unclosed
  // <think> tag is typically a mix of (a) English-language meta lines
  // ("Let me write Chapter 4..."), (b) list items ("- bullet", "1.
  // step"), and (c) short declarative sentences without sentence-end
  // punctuation ("outline the chapter beats"). Real chapter prose is
  // almost always separated from the reasoning by a blank line and
  // carries sentence-ending punctuation. We use that blank-line +
  // sentence-end signal as the primary "prose starts here" marker;
  // as a fall-back we also accept a long multi-sentence paragraph
  // even without a blank-line separator.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (STRUCTURED_LINE_RE.test(trimmed)) continue;

    const sentenceEnds = (trimmed.match(/[.!?]/g) || []).length;
    if (sentenceEnds < 1) continue;

    // Blank-line separator above is the strongest "prose starts here"
    // signal — reasoning blocks virtually always end with a blank line
    // before the prose begins.
    let prev = i - 1;
    while (prev >= 0 && lines[prev].trim() === '') prev--;
    const hasBlankLineAbove = prev < i - 1;
    if (hasBlankLineAbove) {
      return lines.slice(i).join('\n').trim();
    }

    // Fall-back: a long multi-sentence paragraph is almost certainly
    // prose even without a blank-line separator above it.
    if (sentenceEnds >= 2 && trimmed.length >= 40) {
      return lines.slice(i).join('\n').trim();
    }
  }

  // Couldn't find a clear prose paragraph. Most likely the stream was
  // truncated mid-reasoning — return whatever sits after the opening
  // tag, but trim the obviously-leaky bits.
  const trimmedTail = tail.replace(/^\s+/, '').trim();
  return trimmedTail;
}

/**
 * Tail-completeness check. Returns `true` when the supplied text
 * appears to end on a real sentence terminator (after stripping
 * common typographic ornaments some models append), and `false`
 * when the tail looks truncated mid-sentence.
 *
 * Three classes of false positives are guarded against:
 *
 * 1. Trailing typographic ornaments. Streaming authors sometimes
 *    close the final sentence with `"`, `*`, `~`, backtick, or
 *    curly-quote decoration that lives *after* the period. We strip
 *    a small set of these from the very tail before checking.
 *
 * 2. Markdown noise at the end. A model that wraps an example in a
 *    fenced code block finishes with `` ``` `` — no terminal
 *    punctuation, but not a truncated chapter. We strip a trailing
 *    fence (and trailing `---` horizontal rule / `<!-- … -->` HTML
 *    comment) before checking.
 *
 * 3. Legitimate stylistic fragments. Some prose deliberately ends
 *    on a short fragment after a longer paragraph (a trailing image,
 *    a beat of silence). A naive "last character must be `.`/`?`/`!`"
 *    rule would force those through a retry. The two-line guard
 *    mitigates this: only flag as truncated when the LAST non-blank
 *    line has no terminal punctuation AND the previous non-blank
 *    line is also short (< 60 chars). A long previous paragraph
 *    reads as a deliberate fragment; a short one plus a short tail
 *    reads as a mid-sentence cut.
 *
 * Returns `false` (treat as truncated) when `text` is empty or when
 * the only content is a single short line with no terminal
 * punctuation — these are almost certainly interrupted streams, not
 * stylistic endings.
 */
const TAIL_ORNAMENTS_RE = /[\s"'`’”*_~]+$/;
const TRAILING_RULE_RE = /\n*---\s*$/m;
const TRAILING_HTML_COMMENT_RE = /\n*<!--[\s\S]*?-->\s*$/m;
const TERMINAL_CHAR_RE = /[.!?…。」』\)\]"'”]$/;

/**
 * Function words that almost never end a finished sentence in literary
 * prose. When the trailing line has no terminal punctuation AND its last
 * word is one of these, the stream was almost certainly cut mid-clause
 * (mid-enumeration "..., or had...", preposition tail "with the",
 * dangling auxiliary "had been", etc.). Flagged as truncated even when
 * the previous paragraph is long — the two-line guard's
 * "long-previous-paragraph = deliberate fragment" assumption doesn't
 * hold for these patterns. Conservative closed set; anything not listed
 * still falls through to the existing heuristic.
 */
const DANGLING_TAIL_WORDS = new Set<string>([
  // coordinating conjunctions
  'or', 'and', 'but', 'nor', 'yet', 'so',
  // articles
  'a', 'an', 'the',
  // prepositions (common literary-prose subset)
  'in', 'on', 'at', 'to', 'for', 'with', 'by', 'of', 'from',
  'into', 'onto', 'upon', 'about', 'around', 'between',
  'under', 'over', 'through', 'across', 'against',
  'without', 'within', 'toward', 'towards', 'beyond',
  // auxiliaries / modals
  'is', 'was', 'are', 'were', 'be', 'been', 'being', 'am',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'can', 'could',
  'may', 'might', 'must',
  // personal pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them',
  // possessives / demonstratives
  'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those',
  // relative pronouns
  'who', 'whom', 'whose', 'which',
]);

/**
 * Strip a trailing fenced code block (``` or ~~~) so the
 * completeness check doesn't mistake the fence's lack of terminal
 * punctuation for a truncated chapter. Done with string operations
 * rather than a regex because the regex engine does leftmost
 * matching — a `/^|\n````[\s\S]*?\````$/` style pattern would
 * happily strip the OPENING fence and leave the prose-after-fence
 * intact, which is the opposite of what we want.
 *
 * The function only fires when the text ends with a closing fence
 * (after `trimEnd`) AND the matching opening fence is at the start
 * of its own line — so inline triple-backticks inside prose (rare
 * but possible in technical writing) are left alone.
 */
function stripTrailingCodeFence(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  const fenceMatch = /(```+|~~~+)$/.exec(trimmed);
  if (!fenceMatch) return text;
  const fence = fenceMatch[1];
  const closingIdx = trimmed.length - fence.length;
  const before = trimmed.slice(0, closingIdx);
  const openingIdx = before.lastIndexOf(fence);
  if (openingIdx < 0) return text;
  const prevNewline = before.lastIndexOf('\n', openingIdx - 1);
  const openerLineStart = prevNewline >= 0 ? prevNewline + 1 : 0;
  if (openingIdx !== openerLineStart) {
    // The "opening" ``` is mid-line — inline triple-backticks in
    // prose, not a real fence. Leave it alone.
    return text;
  }
  return before.slice(0, openerLineStart).replace(/\s+$/, '');
}

export function endsWithSentenceTerminator(text: string): boolean {
  if (!text) return false;

  // Strip a markdown code fence / horizontal rule / HTML comment
  // tail first so we don't mistake those for a truncated sentence.
  let cleaned = stripTrailingCodeFence(text);
  cleaned = cleaned
    .replace(TRAILING_HTML_COMMENT_RE, '')
    .replace(TRAILING_RULE_RE, '');

  // Strip a small set of trailing typographic ornaments (closing
  // quote / asterisk / backtick / curly-quote / em-dash / whitespace)
  // that some models append after the final sentence.
  cleaned = cleaned.replace(TAIL_ORNAMENTS_RE, '').trimEnd();
  if (!cleaned) return false;

  // Fast path: the tail ends on real sentence-ending punctuation
  // (period, question mark, exclamation, ellipsis, closing bracket
  // or quote). Treat as complete.
  if (TERMINAL_CHAR_RE.test(cleaned)) return true;

  // The last non-blank line has no terminal punctuation. Compute
  // both the tail line and the previous line once so the checks
  // below don't re-split the content.
  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return false;
  const tailLine = lines[lines.length - 1] ?? '';
  const prevLine = lines[lines.length - 2];

  // Dangling-terminal-word check: if the unterminated tail ends on a
  // function word (conjunction, article, preposition, auxiliary,
  // pronoun, …) the model was almost certainly cut mid-clause.
  // Examples: "..., or had", "with the", "had been", "in a".
  // The check sits BEFORE the two-line guard so the existing
  // "long previous paragraph = deliberate fragment" rule still
  // applies for stylistic fragments like "He kept glancing"
  // (verb + adverb — neither word is on the dangling list).
  const lastWordMatch = tailLine.match(/\b([a-zA-Z]+(?:'[a-zA-Z]+)*)\s*$/);
  if (lastWordMatch) {
    // Contractions like "didn't", "it's", "she'd" carry the bare
    // lemma on the apostrophe's left side, but with one extra letter
    // glued on from the contraction suffix ("didn't" → "didn", not
    // "did"). Split on the apostrophe for the right-side forms
    // ("it's" → "it"), then also try dropping one trailing letter
    // to handle the "n't" negation forms ("didn" → "did"). The
    // stem-stripping is conservative (only fires for ≥ 3-char
    // parts) so it cannot mistreat a genuine short word ("an" →
    // "a", but "a" is already a dangling article; "of" wouldn't
    // match anything either way).
    const lemma = lastWordMatch[1].toLowerCase().split("'")[0];
    if (DANGLING_TAIL_WORDS.has(lemma)) {
      return false;
    }
    if (lemma.length > 2 && DANGLING_TAIL_WORDS.has(lemma.slice(0, -1))) {
      return false;
    }
  }

  // Slow path: the last non-blank line has no terminal punctuation
  // and doesn't end on a dangling function word. Apply the two-line
  // guard from the planning notes: only flag as truncated when the
  // previous non-blank line is also short (< 60 chars). A long
  // previous paragraph signals a deliberate stylistic ending; a
  // short previous paragraph plus a short tail suggests the model
  // was cut mid-sentence.
  if (prevLine.length < 60) return false;
  return true;
}
