import { isRefusalOrSafety } from './safety.util';

describe('isRefusalOrSafety', () => {
  describe('user-reported safety template', () => {
    it('matches the exact "User Safety: unsafe" header the user saw in a chapter', () => {
      const safetyBlock =
        'User Safety: unsafe\nSafety Categories: Violence, Guns and Illegal Weapons';
      expect(isRefusalOrSafety(safetyBlock)).toBe(true);
    });

    it('matches a safety block with extra leading prose', () => {
      const safetyBlock =
        'I can\'t help with that.\nUser Safety: unsafe\nSafety Categories: Hate';
      expect(isRefusalOrSafety(safetyBlock)).toBe(true);
    });
  });

  describe('provider safety metadata variants', () => {
    it('matches "[Content blocked by safety filter]"', () => {
      expect(isRefusalOrSafety('[Content blocked by safety filter]')).toBe(true);
    });

    it('matches "Content was flagged for ..."', () => {
      expect(isRefusalOrSafety('Content was flagged for violent themes.')).toBe(true);
    });

    it('matches "Content policy violation"', () => {
      expect(isRefusalOrSafety('Content policy violation detected.')).toBe(true);
    });

    it('matches "Safety Warning:" with category list', () => {
      expect(isRefusalOrSafety('Safety Warning: Violence, Self-harm')).toBe(true);
    });

    it('matches "Moderation blocked" phrasing', () => {
      expect(isRefusalOrSafety('Moderation blocked this request.')).toBe(true);
    });
  });

  describe('plain-language refusals', () => {
    it('matches "I cannot help with that"', () => {
      expect(isRefusalOrSafety('I cannot help with that request.')).toBe(true);
    });

    it('matches "I am not able to write violent content"', () => {
      expect(isRefusalOrSafety('I am not able to write violent content.')).toBe(true);
    });

    it('matches "I\'m sorry, but I can\'t"', () => {
      expect(isRefusalOrSafety("I'm sorry, but I can't write that.")).toBe(true);
    });

    it('matches "I apologize, but I won\'t"', () => {
      expect(isRefusalOrSafety("I apologize, but I won't generate that.")).toBe(true);
    });

    it('matches "As an AI, I cannot ..."', () => {
      expect(isRefusalOrSafety('As an AI, I cannot write that story.')).toBe(true);
    });

    it('matches "This request violates our content policy"', () => {
      expect(isRefusalOrSafety('This request violates our content policy.')).toBe(true);
    });
  });

  describe('finish_reason shortcuts', () => {
    it('flags content_filter from OpenAI', () => {
      expect(isRefusalOrSafety('Any text', 'content_filter')).toBe(true);
    });

    it('flags safety from some OpenRouter routes', () => {
      expect(isRefusalOrSafety('Any text', 'safety')).toBe(true);
    });

    it('flags policy_violation', () => {
      expect(isRefusalOrSafety('Any text', 'policy_violation')).toBe(true);
    });

    it('flags refused and blocked', () => {
      expect(isRefusalOrSafety('Any text', 'refused')).toBe(true);
      expect(isRefusalOrSafety('Any text', 'blocked')).toBe(true);
    });

    it('does NOT flag finish_reason=stop with normal content', () => {
      expect(isRefusalOrSafety('Chapter 1 content here.', 'stop')).toBe(false);
    });

    it('does NOT flag finish_reason=length (truncation, but real content)', () => {
      expect(isRefusalOrSafety('Chapter 1 content here.', 'length')).toBe(false);
    });
  });

  describe('clean chapter content is NOT flagged', () => {
    it('returns false for normal English prose', () => {
      expect(isRefusalOrSafety(
        'The wind howled through the trees as Mara pulled her cloak tighter. The path ahead disappeared into the mist.'
      )).toBe(false);
    });

    it('returns false for normal Polish prose', () => {
      expect(isRefusalOrSafety(
        'Wiatr wył między drzewami, kiedy Mara ściągnęła ciaśniej płaszcz. Ścieżka przed nią znikała we mgle.'
      )).toBe(false);
    });

    it('returns false for empty / nullish input', () => {
      expect(isRefusalOrSafety('')).toBe(false);
      expect(isRefusalOrSafety(null)).toBe(false);
      expect(isRefusalOrSafety(undefined)).toBe(false);
    });

    it('does NOT flag legitimate prose that happens to contain "safety"', () => {
      // The trigger words must appear as a refusal pattern, not just
      // as a vocabulary word. A chapter that literally says "she
      // grabbed the safety rail" must not be treated as a refusal.
      const prose =
        'She reached for the safety rail as the carriage lurched. ' +
        'Below, the city sprawled in candlelight. It was not a kind world, ' +
        'but it was hers.';
      expect(isRefusalOrSafety(prose)).toBe(false);
    });
  });

  describe('only inspects the first ~4KB of content', () => {
    it('does not match a refusal pattern that appears past the head', () => {
      // Build a 5KB blob of clean prose, then append a refusal
      // pattern at the end. The helper only scans the first 4KB,
      // so it should report clean.
      const prose = 'The castle stood silent against the grey sky. '.repeat(120);
      const tail = 'User Safety: unsafe';
      const content = prose + tail;
      expect(content.length).toBeGreaterThan(4096);
      expect(isRefusalOrSafety(content)).toBe(false);
    });
  });
});
