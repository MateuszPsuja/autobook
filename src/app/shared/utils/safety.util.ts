/**
 * Detect LLM safety-filter / content-policy responses.
 *
 * Several providers (Cerebras, Llama-Guard-routed routes, OpenAI
 * with the moderation header, some Anthropic deployments, and
 * random third-party OpenRouter models) respond to a flagged
 * prompt by returning a short metadata block instead of refusing
 * in prose. The user has seen at least one of these patterns
 * land in a stored chapter:
 *
 *   "User Safety: unsafe
 *    Safety Categories: Violence, Guns and Illegal Weapons"
 *
 *   "Safety Warning: This content was flagged for ..."
 *
 *   "[Content blocked by safety filter]"
 *
 * Without a filter, that block ends up in `chapter.content` and
 * the user sees a metadata dump where the prose should be.
 * With it, the caller (author service, translation service) can
 * throw and let the existing retry / fallback pipeline do its
 * job — exactly the same path that already handles refusals
 * like "I can't write that".
 *
 * The patterns here are intentionally case-insensitive and
 * tolerant of extra whitespace; safety templates vary between
 * providers and we don't want to miss a near-miss.
 */

const REFUSAL_PHRASES: readonly RegExp[] = [
  // OpenRouter / Llama-Guard / generic safety blocks
  /\buser\s*safety\s*[:：]\s*unsafe\b/i,
  /\bsafety\s*categor(?:y|ies)\s*[:：]/i,
  /\bcontent\s*(?:was|is|has\s*been)\s*(?:flagged|blocked|filtered|moderated)\b/i,
  /\bcontent\s*(?:policy|moderation)\s*violation\b/i,
  /\bsafety\s*warning\s*[:：]/i,
  // Bracketed safety markers — no leading \b because `[` is a
  // non-word character and the marker is usually at the start of
  // the line. Pattern still requires a word boundary on the
  // trailing side to avoid matching inside normal prose.
  /\[content\s+(?:blocked|filtered|flagged|moderated)\b/i,
  /\bmoderation\s*(?:blocked|rejected|flagged)\b/i,

  // Plain-language refusals — chat models that just say "no"
  /\bi\s*(?:can(?:not)?|won'?t|will\s*not|am\s*not\s*able\s*to|am\s*unable\s*to)\s+(?:help|assist|provide|write|create|generate|continue|comply|do\s*that)/i,
  /\bi'?m\s+sorry[,\s]+but\s+i\s+(?:can(?:not)?|won'?t|am\s*not\s*able)/i,
  /\bi\s+apologize[,\s]+but\s+i\s+(?:can(?:not)?|won'?t|am\s*not\s+able)/i,
  /\bas\s+an?\s+ai(?:[,\s]+(?:language\s+model|assistant))?[,\s]+i\s+(?:can(?:not)?|am\s+not\s+able)/i,
  /\bthis\s+(?:request|prompt|content)\s+(?:violates|goes\s*against)\s+(?:our|my)\s+(?:content\s+)?policy\b/i,
  /\bnot\s+able\s+to\s+(?:help|assist|comply|provide|generate)\s+with\s+that\b/i
];

const REFUSAL_PHRASE_RE = new RegExp(
  REFUSAL_PHRASES.map(re => `(?:${re.source})`).join('|'),
  'i'
);

/**
 * `finish_reason` values the upstream API may set when content
 * was suppressed by a content-policy / safety filter. Different
 * providers spell this differently — OpenAI uses `content_filter`,
 * some OpenRouter routes use `safety` or `stop` with an empty
 * choice. Treat any of these as a refusal.
 */
const SAFETY_FINISH_REASONS = new Set([
  'content_filter',
  'safety',
  'policy_violation',
  'refused',
  'blocked'
]);

/**
 * Returns true when the LLM response looks like a safety-filter
 * metadata block or a plain-language refusal. The caller should
 * treat the response as unusable (throw / return null / surface
 * to the user as `unavailableReason`).
 *
 * Cheap: just regex matches against the first ~4 KB of the
 * content, so a 50 KB chapter body never spends time scanning
 * for the phrase.
 */
export function isRefusalOrSafety(content: string | null | undefined, finishReason?: string | null): boolean {
  if (finishReason && SAFETY_FINISH_REASONS.has(finishReason)) {
    return true;
  }
  if (!content) return false;
  // Cap at the first 4 KB. Refusal templates are always short
  // (a few lines at most); if we haven't seen a match by then,
  // the rest is real prose.
  const head = content.length > 4096 ? content.slice(0, 4096) : content;
  return REFUSAL_PHRASE_RE.test(head);
}
