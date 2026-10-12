/**
 * Download-filename derivation for the export feature.
 *
 * Every export used to ship as `book-export.{pdf,epub,docx,md}`, so
 * downloading two different books produced two files with the same
 * name. Files are now named after the book title.
 *
 * The slug is intentionally ASCII-only: diacritics are stripped
 * (`Café` → `Cafe`) and anything outside `[A-Za-z0-9._-]` is
 * dropped, which is what removes Cyrillic, CJK, and emoji. A title
 * made entirely of those characters collapses to the `book`
 * fallback — a deliberate trade-off (see the plan's "Known
 * limitation") in exchange for filenames that survive every
 * filesystem and browser download shim.
 */

/** Longest slug we emit, before the extension. */
const MAX_LENGTH = 100;

/** Worst-case name: nothing usable survived slugification. */
const FALLBACK = 'book';

/**
 * Windows refuses to create files with these names regardless of
 * extension, and macOS/Linux resolve `CON` to the console device on
 * some mounts. Prefix instead of dropping the user's title.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Turn a user-typed book title into a safe download basename.
 *
 * Capitalisation is preserved (`The-Crystal-Kingdom`, not
 * `the-crystal-kingdom`). Returns `book` when the input is missing,
 * blank, or contains nothing ASCII-safe.
 */
export function slugifyTitle(raw: string | null | undefined): string {
  let slug = (raw ?? '').trim();

  // Decompose so `é` becomes `e` + a combining accent, then drop the
  // accents. Without this, every accented character would simply be
  // deleted by the ASCII filter below and `Café` → `Caf`.
  slug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Path separators, Windows-reserved punctuation, and control
  // characters become dashes so words don't fuse together.
  slug = slug
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\u0000-\u001f]/g, '-');

  // A period that ends a word ("Mr. Smith") is punctuation, not part of
  // the name. Drop it before whitespace becomes a dash, otherwise it
  // turns into a dangling separator: `Mr.-Smith`.
  slug = slug.replace(/\.(?=\s|$)/g, '');

  // Whitespace runs collapse to a single dash.
  slug = slug.replace(/\s+/g, '-');

  // Everything outside the safe set goes — this is the step that
  // drops Cyrillic, CJK, Arabic, and emoji.
  slug = slug.replace(/[^A-Za-z0-9._-]/g, '');

  // Tidy separators and strip leading/trailing dots and dashes: a
  // trailing dot makes Windows Explorer hide the extension.
  slug = slug
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-\s]+/, '')
    .replace(/[.\-\s]+$/, '');

  // Cap the length, then re-trim in case the cut landed on a dash or
  // dot.
  if (slug.length > MAX_LENGTH) {
    slug = slug
      .slice(0, MAX_LENGTH)
      .replace(/[.\-\s]+$/, '');
  }

  if (!slug) return FALLBACK;
  if (RESERVED.test(slug)) return `${FALLBACK}-${slug}`;

  return slug;
}
