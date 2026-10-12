import { slugifyTitle } from './export-filename';

describe('slugifyTitle', () => {
  it('joins words with dashes and preserves capitalisation', () => {
    expect(slugifyTitle('The Crystal Kingdom')).toBe('The-Crystal-Kingdom');
  });

  it('strips diacritics instead of deleting the letter', () => {
    expect(slugifyTitle('Café Society')).toBe('Cafe-Society');
    expect(slugifyTitle('Zamknięte Niebo')).toBe('Zamkniete-Niebo');
  });

  it('replaces characters that are illegal in filenames with dashes', () => {
    expect(slugifyTitle('Who? What: Really/<Now>')).toBe('Who-What-Really-Now');
  });

  it('drops trailing punctuation that leaves the words intact', () => {
    expect(slugifyTitle('The Crystal Kingdom: Volume II!')).toBe('The-Crystal-Kingdom-Volume-II');
  });

  it('collapses whitespace runs and trims the ends', () => {
    expect(slugifyTitle('  spaced   out  ')).toBe('spaced-out');
  });

  it('strips a trailing dot, which Windows Explorer would hide', () => {
    expect(slugifyTitle('Mr. Smith.')).toBe('Mr-Smith');
  });

  it('falls back to "book" for a title with no ASCII-safe characters', () => {
    // Accepted limitation: non-Latin titles cannot become ASCII slugs.
    expect(slugifyTitle('星の王国')).toBe('book');
  });

  it('keeps the Latin part of a mixed-script title', () => {
    expect(slugifyTitle('Saga  星の王国')).toBe('Saga');
  });

  it('falls back to "book" for empty and missing input', () => {
    expect(slugifyTitle('')).toBe('book');
    expect(slugifyTitle('   ')).toBe('book');
    expect(slugifyTitle(null)).toBe('book');
    expect(slugifyTitle(undefined)).toBe('book');
  });

  it('caps the slug at 100 characters without leaving a dangling dash or dot', () => {
    const slug = slugifyTitle('A'.repeat(150));
    expect(slug.length).toBe(100);
    expect(slug).not.toMatch(/[.-]$/);

    // Cut lands mid-word here; the tail is trimmed, not left dangling.
    const dashed = slugifyTitle(`${'word '.repeat(40)}end`);
    expect(dashed.length).toBeLessThanOrEqual(100);
    expect(dashed).not.toMatch(/[.-]$/);
  });

  it('prefixes Windows reserved device names so the download cannot be swallowed', () => {
    expect(slugifyTitle('CON')).toBe('book-CON');
    expect(slugifyTitle('com1')).toBe('book-com1');
    expect(slugifyTitle('Console')).toBe('Console');
  });
});
