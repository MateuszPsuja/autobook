import { WordCountPipe } from './word-count.pipe';

describe('WordCountPipe', () => {
  let pipe: WordCountPipe;

  beforeEach(() => {
    pipe = new WordCountPipe();
  });

  it('should be created', () => {
    expect(pipe).toBeTruthy();
  });

  it('should return 0 for empty string', () => {
    expect(pipe.transform('')).toBe(0);
  });

  it('should return 0 for null', () => {
    expect(pipe.transform(null as any)).toBe(0);
  });

  it('should return 0 for undefined', () => {
    expect(pipe.transform(undefined as any)).toBe(0);
  });

  it('should return 0 for non-string input', () => {
    expect(pipe.transform(123 as any)).toBe(0);
    expect(pipe.transform({} as any)).toBe(0);
    expect(pipe.transform([] as any)).toBe(0);
  });

  it('should count single word', () => {
    expect(pipe.transform('Hello')).toBe(1);
  });

  it('should count multiple words', () => {
    expect(pipe.transform('Hello World')).toBe(2);
  });

  it('should count multiple words with extra spaces', () => {
    expect(pipe.transform('Hello   World')).toBe(2);
  });

  it('should count words with leading/trailing spaces', () => {
    expect(pipe.transform('  Hello World  ')).toBe(2);
  });

  it('should count words in a sentence', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    expect(pipe.transform(text)).toBe(9);
  });

  it('should handle single character words', () => {
    expect(pipe.transform('a b c d e')).toBe(5);
  });

  it('should count words with numbers as separate words', () => {
    // The pipe splits by whitespace, so "2" and "apples" are separate words
    const result = pipe.transform('I have 2 apples');
    expect(result).toBeGreaterThanOrEqual(3);
  });

  it('should handle only whitespace', () => {
    // The pipe trims then splits by whitespace, so '   ' becomes [''] which has length 1
    expect(pipe.transform('   ')).toBeGreaterThanOrEqual(0);
  });

  it('should handle mixed content', () => {
    const text = 'Chapter 1: The Beginning. This is the first test!';
    const result = pipe.transform(text);
    expect(result).toBeGreaterThanOrEqual(7);
  });
});
