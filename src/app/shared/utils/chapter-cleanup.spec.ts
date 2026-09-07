import { stripReasoningPreamble, stripRunningWordCount, stripThinkingBlocks, stripUnclosedThinkingBlock } from './chapter-cleanup';

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

  it('strips a lone "think> ..." preamble (DeepSeek/QwQ-style leak)', () => {
    const input = [
      'think> The user wants me to write Chapter 1 of a novel called "The Weight You Carry."',
      'Let me analyze the requirements:',
      '- need a hook',
      '- need the protagonist',
      '',
      'The morning sun cracked the horizon. Mara was already walking.'
    ].join('\n');

    const result = stripReasoningPreamble(input);
    expect(result.startsWith('The morning sun')).toBe(true);
    expect(result).not.toContain('analyze the requirements');
  });
});

describe('stripThinkingBlocks', () => {
  it('returns the input unchanged when there is no thinking block', () => {
    const prose = 'Phoenix knelt in the dust and pressed her palm to the shard.';
    expect(stripThinkingBlocks(prose)).toBe(prose);
  });

  it('strips a <think>...</think> block at the start', () => {
    const input = '<think>The user wants a chapter opening with a strong hook. Let me draft.</think>\n\nPhoenix knelt in the dust and pressed her palm to the shard.';
    const result = stripThinkingBlocks(input);
    expect(result.startsWith('Phoenix')).toBe(true);
    expect(result).not.toContain('strong hook');
  });

  it('strips a <think>...</think> block in the middle', () => {
    const input = 'The first paragraph.\n\n<think>internal reasoning here</think>\n\nThe second paragraph.';
    const result = stripThinkingBlocks(input);
    expect(result).toContain('first paragraph');
    expect(result).toContain('second paragraph');
    expect(result).not.toContain('internal reasoning');
  });

  it('strips an Anthropic-style <|thinking|>...<|/thinking|> block', () => {
    const input = '<|thinking|>drafting a hook<|/thinking|>Phoenix knelt in the dust.';
    const result = stripThinkingBlocks(input);
    expect(result).toBe('Phoenix knelt in the dust.');
  });

  it('strips a <reasoning>...</reasoning> block', () => {
    const input = '<reasoning>plan out chapter beats</reasoning>\n\nThe wind shifted.';
    const result = stripThinkingBlocks(input);
    expect(result).toBe('The wind shifted.');
  });
});

describe('stripUnclosedThinkingBlock', () => {
  it('returns the input unchanged when there is no opening tag', () => {
    const prose = 'You bury the lantern at the crossroads, and the dawn finds you walking.';
    expect(stripUnclosedThinkingBlock(prose)).toBe(prose);
  });

  it('strips an unclosed <think>...prose block at the start', () => {
    // Reproduces the bug observed when an OpenRouter route surfaced
    // a reasoning-capable model that emitted <think> and then streamed
    // the chapter without ever writing </think>. The reasoning ran for
    // ~40 lines of list items before the model switched to actual prose.
    const input = [
      '<think>Let me write Chapter 4: "The Dawn Between" following all the strict requirements.',
      '',
      'Key elements to include:',
      '- Start directly with 1. You bury Jordan\'s lantern with honor',
      '2. You begin walking toward the city',
      '3. You carry both light and shadow in your heart',
      '- Children find you and follow',
      '- You become the bridge between two worlds',
      '',
      'You bury the lantern at the crossroads. The dawn finds you walking toward the city.',
      'The children fall in behind you, a strange procession moving toward the last light.'
    ].join('\n');

    const result = stripUnclosedThinkingBlock(input);
    expect(result).not.toContain('Let me write Chapter 4');
    expect(result).not.toContain('Key elements');
    expect(result).not.toContain('<think');
    expect(result.startsWith('You bury the lantern')).toBe(true);
  });

  it('strips an unclosed <reasoning> block', () => {
    const input = '<reasoning>outline the chapter beats and character arcs\n\nYou walk toward the city.';
    const result = stripUnclosedThinkingBlock(input);
    expect(result).not.toContain('outline the chapter beats');
    expect(result.startsWith('You walk toward the city.')).toBe(true);
  });

  it('falls back to stripThinkingBlocks when the block IS properly closed', () => {
    // Defensive: if a future caller forgets to run stripThinkingBlocks
    // first, this pass should not duplicate the work or damage the
    // paired-block output.
    const input = '<think>plan a hook</think>\n\nThe dawn found her walking.';
    const result = stripUnclosedThinkingBlock(input);
    expect(result).toBe(input);
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

  it('strips a mid-stream <think> block that escaped the preamble detector', () => {
    // Some providers surface reasoning in the main content field
    // without a leading English marker line, so the preamble detector
    // misses it. The stripThinkingBlocks pass catches it.
    const input = '<think>The user wants me to write Chapter 1.\nLet me analyze.\n- hook\n- body</think>\n\nPhoenix knelt in the dust and pressed her palm to the shard. It was warm.';
    const result = stripRunningWordCount(input);
    expect(result.startsWith('Phoenix')).toBe(true);
    expect(result).not.toContain('analyze');
    expect(result).not.toContain('strong hook');
  });

  it('strips an UNCLOSED <think> block (reasoning + prose inside one tag)', () => {
    // Reproduces the bug observed when an OpenRouter route surfaced
    // a reasoning-capable model that emitted <think> and then streamed
    // the chapter prose without ever writing </think>. The reasoning
    // preamble detector misses it (no English marker line), and the
    // paired-block detector misses it (no closing tag). The
    // unclosed-block pass catches it.
    const input = [
      '<think>Let me write Chapter 4: "The Dawn Between" following all the strict requirements.',
      '',
      'Key elements to include:',
      '- Start directly with 1. You bury',
      '2. You begin walking',
      '3. You carry both light and shadow',
      '',
      'You bury the lantern at the crossroads. The dawn finds you walking toward the city.'
    ].join('\n');

    const result = stripRunningWordCount(input);
    expect(result.startsWith('You bury the lantern')).toBe(true);
    expect(result).not.toContain('Let me write Chapter 4');
    expect(result).not.toContain('Key elements');
    expect(result).not.toContain('<think');
  });
});
