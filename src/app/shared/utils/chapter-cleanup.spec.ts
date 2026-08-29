import { stripReasoningPreamble, stripRunningWordCount } from './chapter-cleanup';

describe('stripReasoningPreamble', () => {
  it('returns the input unchanged when there is no preamble', () => {
    const prose = 'Phoenix knelt in the dust and pressed her palm to the shard. It was warm.';
    expect(stripReasoningPreamble(prose)).toBe(prose);
  });

  it('strips a "Here is a thinking process:" block', () => {
    const input = [
      "Here's a thinking process:",
      '',
      '1.  **Analyze the Request:**',
      '   - User wants Chapter 1: "The Wanderer\'s Call"',
      '   - Context: Previous chapter not available',
      '',
      '2.  **Drafting:**',
      '   - hook',
      '   - body',
      '',
      'Phoenix knelt in the dust and pressed her palm to the shard. It was warm.'
    ].join('\n');

    const result = stripReasoningPreamble(input);
    expect(result.startsWith('Phoenix')).toBe(true);
    expect(result).not.toContain("thinking process");
    expect(result).not.toContain('Analyze the Request');
  });

  it('strips a "Let me think..." block', () => {
    const input = [
      'Let me think about this chapter:',
      '',
      '- need a strong hook',
      '- need the vision scene',
      '- end on the Reese hook',
      '',
      'The morning sun cracked the horizon. Phoenix was already walking.'
    ].join('\n');

    const result = stripReasoningPreamble(input);
    expect(result.startsWith('The morning sun')).toBe(true);
    expect(result).not.toContain('need a strong hook');
  });

  it('strips a "My plan:" block', () => {
    const input = [
      'My plan:',
      '',
      '1. Open with the discovery.',
      '2. Build the vision.',
      '3. End with the shard pulsing.',
      '',
      'The wind shifted. Phoenix stopped.'
    ].join('\n');

    const result = stripReasoningPreamble(input);
    expect(result.startsWith('The wind shifted')).toBe(true);
  });

  it('strips a "Step 1:" block', () => {
    const input = [
      'Step 1: Plan the chapter.',
      'Step 2: Draft the prose.',
      '',
      'Rain hammered the plains that morning.'
    ].join('\n');

    const result = stripReasoningPreamble(input);
    expect(result.startsWith('Rain hammered')).toBe(true);
  });

  it('strips a bold-header "Thinking Process:" variant', () => {
    const input = [
      '**Thinking Process:**',
      '',
      '**Hook opening** — start with atmosphere.',
      '**Discovery** — describe the shard.',
      '',
      'The shard glowed under her fingers.'
    ].join('\n');

    const result = stripReasoningPreamble(input);
    expect(result.startsWith('The shard glowed')).toBe(true);
  });

  it('returns an empty string when only reasoning is present (no prose follows)', () => {
    const input = [
      "Here's a thinking process:",
      '',
      '1. Analyze the request',
      '2. Plan the chapter',
      '3. Draft the prose'
    ].join('\n');

    expect(stripReasoningPreamble(input)).toBe('');
  });

  it('does not strip mid-text occurrences of the phrases', () => {
    const prose = 'She whispered, "let me think about it," and reached for the shard.';
    // Without a leading "Let me think:" marker, the function leaves it alone.
    expect(stripReasoningPreamble(prose)).toBe(prose);
  });

  it('handles a thinking block followed by indented content with sentence punctuation', () => {
    const input = [
      "Here's a thinking process:",
      '',
      '   1. step one',
      '   2. step two',
      '',
      '   Phoenix pressed the shard to her chest. It hummed.'
    ].join('\n');

    const result = stripReasoningPreamble(input);
    expect(result).toContain('Phoenix pressed');
  });
});

describe('stripRunningWordCount', () => {
  it('passes through clean prose', () => {
    const prose = 'Phoenix knelt in the dust and pressed her palm to the shard.';
    expect(stripRunningWordCount(prose)).toBe(prose);
  });

  it('strips a "Count: word1 word2 word3..." pattern', () => {
    const input = 'Count: A1 banner2 fluttered3 in4 the5 wind6. 6 words.';
    // The density check + suffix match should fire here.
    const result = stripRunningWordCount(input);
    // The per-word counters ("1", "2", "3", ...) are removed but the
    // underlying words stay.
    expect(result).toBe('A banner fluttered in the wind.');
    expect(result).not.toContain('Count:');
    expect(result).not.toContain('6 words.');
  });

  it('strips a trailing "N words." summary when paired with a Count: prefix', () => {
    // The function is conservative: it only strips "N words." when
    // there's a strong signal (Count: prefix OR high counter density).
    // A bare "100 words." at the end of otherwise-clean prose is left
    // alone so we don't mangle legitimate sentences like "I wrote 100
    // words."
    const proseOnly = 'The shard glowed. The world tilted. 100 words.';
    expect(stripRunningWordCount(proseOnly)).toBe(proseOnly);

    // With a Count: prefix the function fires and strips the summary.
    const withCount = 'Count: The1 shard2 glowed3. The4 world5 tilted6. 6 words.';
    const result = stripRunningWordCount(withCount);
    expect(result).not.toMatch(/\d+\s*words\.\s*$/);
  });

  it('strips a trailing all-caps title + chapter number when paired with a Count: prefix', () => {
    // The function is conservative: the title-stripper only fires when
    // there's a strong signal (Count: prefix OR "N words." suffix OR
    // high counter density). A bare title with no other signal stays
    // alone so we don't mangle legitimate prose.
    const proseOnly = 'The shard glowed. ECHOES OF TOMORROW 10';
    expect(stripRunningWordCount(proseOnly)).toBe(proseOnly);

    // With a Count: prefix the function fires and strips the title.
    const withCount = 'Count: The1 shard2 glowed3. 3 words. ECHOES OF TOMORROW 10';
    const result = stripRunningWordCount(withCount);
    expect(result).not.toContain('ECHOES');
  });

  it('does not mangle normal numbers in prose', () => {
    const prose = 'In room 42, she found page 15 of the journal. The iPhone 15 box sat on the table.';
    // Density check should not fire — the "word+digits" pattern is sparse.
    expect(stripRunningWordCount(prose)).toBe(prose);
  });

  it('chained: strips a reasoning preamble AND a trailing words summary when both signals are present', () => {
    const input = [
      "Here's a thinking process:",
      '',
      '1. hook',
      '2. body',
      '',
      'Count: Phoenix1 pressed2 her3 palm4 to5 the6 shard7. The8 air9 hummed10. 10 words.'
    ].join('\n');

    const result = stripRunningWordCount(input);
    expect(result.startsWith('Phoenix')).toBe(true);
    expect(result).not.toContain('thinking process');
    expect(result).not.toMatch(/10 words\.\s*$/);
  });
});
