import { unzipSync, strFromU8 } from 'fflate';
import { convertMillimetersToTwip } from 'docx';
import { buildDocxBlob, DocxBuildInput } from './docx-builder';
import { BookConfig } from '../../models/book-config.model';
import { Chapter } from '../../models/chapter.model';

const baseInput: DocxBuildInput = {
  chapters: [
    { id: 'c1', number: 1, title: 'The Beginning', content: 'It was a dark and stormy night.\n\nThe rain fell hard.' } as Chapter,
    { id: 'c2', number: 2, title: 'The Middle', content: 'Things got complicated.' } as Chapter,
  ],
  config: { title: 'Test Book', genre: 'mystery', protagonist: { name: 'Alex' }, themes: ['love', 'loss'] } as unknown as BookConfig,
  labels: {
    bookAuthor: 'Written by AI', aBookLabel: 'a novel', tocLabel: 'Contents',
    chapterLabel: 'Chapter', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue',
    untitledFallback: 'Untitled', stopping: 'Stopping...',
    translating: 'Translating...', backCoverHead: 'About the author',
    backCoverSubject: 'AutoBook', backCoverVerb: ' exploring', backCoverUnknownTheme: 'mystery',
    backCoverUnknownProtagonist: 'A protagonist', backCoverUnknownTitle: 'This book',
    backCoverBlurbTemplate: '"{title}" is about {protagonist}.', isbnPlaceholder: 'ISBN 000-0-00-000000-0',
    themeSeparator: ', ',
  },
  bookAuthor: 'Written by AI',
  options: { includeTitles: true, includeTOC: false },
};

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Resolve the entities docx emits so titles can be matched literally. */
function unescapeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function unzip(blob: Blob): Promise<{
  files: Record<string, Uint8Array>;
  text: Record<string, string>;
}> {
  const buf = await blob.arrayBuffer();
  const files = unzipSync(new Uint8Array(buf));
  const text: Record<string, string> = {};
  for (const name of Object.keys(files)) {
    text[name] = strFromU8(files[name]);
  }
  return { files, text };
}

/** Count non-overlapping occurrences of a literal in a string. */
function countOf(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/**
 * Embedded image files. `unzipSync` reports bare directory entries
 * (`word/media/`) alongside the files, so a prefix test alone counts
 * the folder itself.
 */
function mediaFileNames(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files).filter(n => /^word\/media\/.+/.test(n));
}

/** The paragraph element that contains `needle`, XML included. */
function paragraphContaining(doc: string, needle: string): string {
  const match = doc.match(new RegExp(
    `<w:p>(?:(?!</w:p>)[\\s\\S])*?${escapeRegExp(needle)}(?:(?!</w:p>)[\\s\\S])*?</w:p>`,
  ));
  expect(match).withContext(`no paragraph contains ${needle}`).not.toBeNull();
  return match![0];
}

/** A short multi-chapter book used by the structural specs. */
const threeChapters = [
  { id: 'c1', number: 1, title: "The Soldier's Return", content: 'SENTINEL-ONE-FIRST body paragraph here.' },
  { id: 'c2', number: 2, title: 'Ash and Ember', content: 'SENTINEL-TWO-SECOND body paragraph here.' },
  { id: 'c3', number: 3, title: 'The Long Road', content: 'SENTINEL-THREE-THIRD body paragraph here.' },
] as unknown as Chapter[];

// ===========================================================================
// Anti-duplication guards.
//
// The bug this rewrite exists to kill: a Word TOC field shipped with
// `w:dirty="true"` and `features.updateFields`, so any viewer that
// re-resolved it rebuilt the contents from the document and the book
// rendered twice. These specs pin the properties that make that
// impossible, rather than the pixel layout.
// ===========================================================================

describe('buildDocxBlob — no duplicate rendering', () => {
  it('renders every chapter body exactly once', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    const doc = unescapeXml(text['word/document.xml']);
    for (const sentinel of ['SENTINEL-ONE-FIRST', 'SENTINEL-TWO-SECOND', 'SENTINEL-THREE-THIRD']) {
      expect(countOf(doc, sentinel)).withContext(sentinel).toBe(1);
    }
  });

  it('emits no field instruction in the document body', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    expect(text['word/document.xml']).not.toContain('<w:instrText');
    expect(text['word/document.xml']).not.toContain('TOC \\h');
  });

  it('keeps the page-number field as the only field in the package', async () => {
    // A `PAGE` field cannot over-collect anything, so it is safe to
    // keep. Anything else — a TOC, an INDEX, a STYLEREF — would put
    // field-update semantics back into the file.
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    const instructions: string[] = [];
    for (const name of Object.keys(text)) {
      for (const m of text[name].matchAll(/<w:instrText[^>]*>([^<]*)<\/w:instrText>/g)) {
        instructions.push(m[1]);
      }
    }
    expect(instructions.length).toBeGreaterThan(0);
    for (const instruction of instructions) {
      expect(instruction.trim()).withContext(instruction).toBe('PAGE');
    }
  });

  it('does not ask the reader to update fields on open', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    expect(text['word/settings.xml']).not.toContain('<w:updateFields');
  });

  it('never marks a field dirty', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    for (const name of Object.keys(text)) {
      expect(text[name]).withContext(name).not.toContain('w:dirty');
    }
  });

  it('never references a TOC1 style the package does not define', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).not.toContain('TOC1');
    expect(text['word/styles.xml']).not.toContain('TOC1');
  });

  it('emits exactly one body and one section properties block', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect((doc.match(/<w:body>/g) || []).length).toBe(1);
    expect((doc.match(/<\/w:body>/g) || []).length).toBe(1);
    expect((doc.match(/<w:sectPr/g) || []).length).toBe(1);
  });

  it('renders each heading exactly twice with a contents page, once without', async () => {
    const withToc = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const withoutToc = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: false },
    });
    const withDoc = unescapeXml((await unzip(withToc)).text['word/document.xml']);
    const withoutDoc = unescapeXml((await unzip(withoutToc)).text['word/document.xml']);

    for (const heading of ["Chapter 1: The Soldier's Return", 'Chapter 2: Ash and Ember', 'Chapter 3: The Long Road']) {
      expect(countOf(withDoc, heading)).withContext(`${heading} (with contents)`).toBe(2);
      expect(countOf(withoutDoc, heading)).withContext(`${heading} (no contents)`).toBe(1);
    }
  });

  it('points every contents link at a bookmark that exists', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    const doc = unescapeXml(text['word/document.xml']);
    const anchors = (doc.match(/<w:hyperlink[^>]*w:anchor="([^"]+)"/g) || [])
      .map(h => /w:anchor="([^"]+)"/.exec(h)![1]);
    expect(anchors.length).toBe(3);
    for (const anchor of anchors) {
      expect(doc).withContext(anchor).toContain(`<w:bookmarkStart w:name="${anchor}" `);
    }
  });

  it('uses one page break per section plus one for the title page', async () => {
    const withToc = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const withoutToc = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: false },
    });
    const withDoc = (await unzip(withToc)).text['word/document.xml'];
    const withoutDoc = (await unzip(withoutToc)).text['word/document.xml'];
    // The contents page shares the title page's break, so it adds none
    // of its own — a trailing break would leave a blank page before
    // chapter 1.
    expect((withDoc.match(/<w:br w:type="page"\/>/g) || []).length).toBe(threeChapters.length + 1);
    expect((withoutDoc.match(/<w:br w:type="page"\/>/g) || []).length).toBe(threeChapters.length + 1);
  });

  it('counts prologue and epilogue toward the page-break chain', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      prologue: { id: 'p1', number: 0, title: 'Beginnings', content: 'Prologue body.' } as Chapter,
      epilogue: { id: 'e1', number: 99, title: 'Endings', content: 'Epilogue body.' } as Chapter,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect((doc.match(/<w:br w:type="page"\/>/g) || []).length).toBe(threeChapters.length + 3);
  });

  it('renders a repeated chapter once, not twice', async () => {
    const duplicated: Chapter[] = [threeChapters[0], threeChapters[1], threeChapters[0], threeChapters[2]];
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: duplicated,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    const doc = unescapeXml(text['word/document.xml']);
    expect(countOf(doc, 'SENTINEL-ONE-FIRST')).toBe(1);
    expect(countOf(doc, "Chapter 1: The Soldier's Return")).toBe(2);
    // The rest of the book is untouched.
    expect(doc).toContain('Chapter 2: Ash and Ember');
    expect(doc).toContain('Chapter 3: The Long Road');
  });
});

// ===========================================================================

describe('buildDocxBlob — package structure', () => {
  it('returns a Blob with the DOCX MIME type', async () => {
    const blob = await buildDocxBlob(baseInput);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('produces a real ZIP (first 4 bytes are PK\\x03\\x04)', async () => {
    const blob = await buildDocxBlob(baseInput);
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  it('contains the standard DOCX OOXML entry points', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { files } = await unzip(blob);
    expect(files['[Content_Types].xml']).toBeDefined();
    expect(files['_rels/.rels']).toBeDefined();
    expect(files['word/document.xml']).toBeDefined();
  });

  it('puts the title and the byline on the title page', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).toContain('>Test Book<');
    expect(doc).toContain('>Written by AI<');
  });

  it('falls back to the untitled label when the config has no title', async () => {
    const blob = await buildDocxBlob({ ...baseInput, config: { title: '   ' } as unknown as BookConfig });
    const { text } = await unzip(blob);
    expect(text['word/document.xml']).toContain('>Untitled<');
  });

  it('emits no blurb, no author bio and no ISBN', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = unescapeXml(text['word/document.xml']);
    expect(doc).not.toContain('ISBN');
    expect(doc).not.toContain('About the author');
    expect(doc).not.toContain('a novel');
    expect(doc).not.toContain('MYSTERY');
  });

  it('embeds every chapter with the localised chapter label', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).toContain('It was a dark and stormy night.');
    expect(doc).toContain('Chapter 1: The Beginning');
    expect(doc).toContain('Chapter 2: The Middle');
  });

  it('strips the running word-count footer from chapter content', async () => {
    const inputWithCount: DocxBuildInput = {
      ...baseInput,
      chapters: [{
        id: 'c1', number: 1, title: 'Has count',
        content: 'Count: a1 banner2 fluttered3 snap4 quickly5 across6 the7 morning8 sky9. 90 words.',
      } as Chapter],
    };
    const blob = await buildDocxBlob(inputWithCount);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // Strip rules are tested in chapter-cleanup.spec.ts; here we
    // just need to confirm the function is wired in.
    expect(doc).not.toMatch(/Count:\s*a/);
  });
});

describe('buildDocxBlob — typography', () => {
  it('uses a serif body font', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).toMatch(/<w:rFonts[^>]*w:ascii="Garamond"/);
  });

  it('justifies body paragraphs', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // The body has at least one <w:jc w:val="both"/> element
    // (both = justified in OOXML).
    expect(doc).toContain('w:val="both"');
  });

  it('sets zero space after body paragraphs (continuous prose)', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // A web-style 6pt gap after every paragraph made the book read as
    // a stack of short blocks; the body is now flush and only the
    // first-line indent separates paragraphs.
    const p = paragraphContaining(doc, 'The rain fell hard.');
    expect(p).toMatch(/<w:spacing[^>]*w:after="0"/);
  });

  it('uses 1.2 line spacing and keeps widow/orphan control on body text', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    const p = paragraphContaining(doc, 'The rain fell hard.');
    expect(p).toMatch(/<w:spacing[^>]*w:line="288"/);
    expect(p).toContain('<w:widowControl/>');
    expect(p).toContain('<w:jc w:val="both"/>');
  });

  it('indents every body paragraph except the opening one', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    const indent = `<w:ind w:firstLine="${convertMillimetersToTwip(5)}"`;
    // Chapter 1 has two paragraphs (the second is indented); chapter 2
    // has one and so none — exactly one in this fixture.
    expect((doc.match(new RegExp(escapeRegExp(indent), 'g')) || []).length).toBe(1);

    const opening = paragraphContaining(doc, 'It was a dark and stormy night.');
    expect(opening).not.toContain('w:firstLine');
  });

  it('does not emit a drop-cap run on the first letter', async () => {
    // The old builder inflated the first character of every chapter to
    // ~37pt inline, which reads as a typo rather than a drop cap. The
    // shipping layout uses a plain first paragraph instead.
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).not.toContain('<w:sz w:val="75"/>');
    // No run contains a lone "I" any more — the opening word is whole.
    expect(doc).toContain('>It was a dark and stormy night.<');
  });

  it('centers the chapter title', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    const heading = paragraphContaining(doc, 'Chapter 1: The Beginning');
    expect(heading).toContain('<w:jc w:val="center"/>');
  });

  it('overrides the Heading 1 colour so the title is not accent blue', async () => {
    // docx's built-in Heading1 style is accent blue 2E74B5, so a chapter
    // title that keeps the outline level has to override it on the run.
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    const heading = paragraphContaining(doc, 'Chapter 1: The Beginning');
    expect(heading).toContain('<w:color w:val="000000"/>');
    expect(heading).not.toContain('2E74B5');
  });

  it('marks chapters as Heading 1 so the navigation pane lists them', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    const headings = doc.match(/<w:pStyle w:val="Heading1"\/>/g) || [];
    expect(headings.length).toBe(threeChapters.length);
  });

  it('gives no body paragraph an outline level', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    expect((text['word/document.xml'].match(/<w:outlineLvl/g) || []).length).toBe(0);
  });

  it('defines the Normal base style the heading styles inherit from', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const styles = text['word/styles.xml'];
    expect(styles).toMatch(/<w:style w:type="paragraph" w:styleId="Normal">/);
    // Crucially without an outline level, which is what keeps body
    // paragraphs out of the navigation outline.
    const normal = styles.match(/<w:style w:type="paragraph" w:styleId="Normal">[\s\S]*?<\/w:style>/);
    expect(normal![0]).not.toContain('outlineLvl');
  });
});

describe('buildDocxBlob — page geometry', () => {
  it('declares an explicit A4 page size', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // Asserted through the conversion helper rather than a literal so
    // the expectation tracks the call site instead of drifting from it.
    const w = convertMillimetersToTwip(210);
    const h = convertMillimetersToTwip(297);
    expect(doc).toContain(`<w:pgSz w:w="${w}" w:h="${h}" w:orient="portrait"/>`);
  });

  it('uses a 25 mm margin on all four sides', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    const margins = doc.match(/<w:pgMar[^>]*\/>/);
    expect(margins).not.toBeNull();
    const m = convertMillimetersToTwip(25);
    expect(margins![0]).toMatch(new RegExp(`w:top="${m}"`));
    expect(margins![0]).toMatch(new RegExp(`w:bottom="${m}"`));
    expect(margins![0]).toMatch(new RegExp(`w:left="${m}"`));
    expect(margins![0]).toMatch(new RegExp(`w:right="${m}"`));
    const f = convertMillimetersToTwip(12);
    expect(margins![0]).toMatch(new RegExp(`w:footer="${f}"`));
  });

  it('suppresses the footer on the title page', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    expect(text['word/document.xml']).toContain('<w:titlePg/>');
  });

  it('numbers pages with a centered PAGE field in the default footer', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { files, text } = await unzip(blob);
    const footerNames = Object.keys(files).filter(n => /^word\/footer\d*\.xml$/.test(n));
    expect(footerNames.length).toBeGreaterThan(0);
    const withPageNumber = footerNames.filter(n => text[n].includes('PAGE'));
    expect(withPageNumber.length).toBe(1);
    expect(text[withPageNumber[0]]).toContain('w:val="center"');
  });

  it('ships an empty first-page footer built from a paragraph', async () => {
    // A <w:ftr/> with no block-level children at all makes Word
    // complain about the document, so the "empty" footer still carries
    // one empty paragraph.
    const blob = await buildDocxBlob(baseInput);
    const { files, text } = await unzip(blob);
    const emptyFooters = Object.keys(files)
      .filter(n => /^word\/footer\d*\.xml$/.test(n))
      .filter(n => !text[n].includes('PAGE'));
    expect(emptyFooters.length).toBe(1);
    expect(text[emptyFooters[0]]).toContain('<w:p');
  });
});

describe('buildDocxBlob — language', () => {
  it('defaults to en-US proofing', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    expect(text['word/styles.xml']).toContain('<w:lang w:val="en-US"/>');
  });

  it('maps the export language onto a BCP-47 tag', async () => {
    const blob = await buildDocxBlob({ ...baseInput, language: 'pl' });
    const { text } = await unzip(blob);
    expect(text['word/styles.xml']).toContain('<w:lang w:val="pl-PL"/>');
  });

  it('falls back to en-US for an unknown language', async () => {
    const blob = await buildDocxBlob({ ...baseInput, language: 'xx' });
    const { text } = await unzip(blob);
    expect(text['word/styles.xml']).toContain('<w:lang w:val="en-US"/>');
  });
});

describe('buildDocxBlob — prose normalization', () => {
  const wrapped = 'line one\nline two\n\nline three';

  it('collapses the model hard wraps into whole paragraphs', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: [{ id: 'c1', number: 1, title: 'Wrapped', content: wrapped } as Chapter],
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // One <w:t> holds the whole collapsed paragraph…
    expect(doc).toContain('>line one line two<');
    // …and no run carries a raw newline. A raw \n inside <w:t> is what
    // made Word break the line at the model's wrap column.
    const runs = doc.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || [];
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run).not.toContain('\n');
  });

  it('normalizes CRLF content before rendering', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: [{ id: 'c1', number: 1, title: 'Crlf', content: 'alpha\r\nbeta\r\n\r\ngamma' } as Chapter],
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).toContain('>alpha beta<');
    expect(doc).toContain('>gamma<');
  });

  it('renders a scene break as a centered ornament paragraph', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: [{
        id: 'c1', number: 1, title: 'Scenes',
        content: 'The door closed.\n\n* * *\n\nThe street was empty.',
      } as Chapter],
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    const sceneBreak = paragraphContaining(doc, '* * *');
    expect(sceneBreak).toContain('<w:jc w:val="center"/>');
  });

  it('does not fold a scene break into the surrounding prose', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: [{
        id: 'c1', number: 1, title: 'Scenes',
        content: 'The door closed.\n\n* * *\n\nThe street was empty.',
      } as Chapter],
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).toContain('>The door closed.<');
    expect(doc).toContain('>The street was empty.<');
    expect(doc).not.toContain('closed. * * *');
  });
});

describe('buildDocxBlob — export options', () => {
  it('omits the contents page when includeTOC is off', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: false },
    });
    const { text } = await unzip(blob);
    expect(text['word/document.xml']).not.toContain('>Contents<');
  });

  it('omits the contents page when includeTitles is off', async () => {
    // Nothing is styled as Heading 1, so there is nothing to list.
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: false, includeTOC: true },
    });
    const { text } = await unzip(blob);
    expect(text['word/document.xml']).not.toContain('>Contents<');
    expect(text['word/document.xml']).not.toContain('w:anchor=');
  });

  it('drops chapter titles but keeps the page breaks when includeTitles is off', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: false, includeTOC: false },
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).not.toContain('Chapter 1: The Beginning');
    expect(doc).not.toContain('Heading1');
    // Body text still renders.
    expect(doc).toContain('SENTINEL-ONE-FIRST');
    expect((doc.match(/<w:br w:type="page"\/>/g) || []).length).toBe(threeChapters.length + 1);
  });

  it('keeps the contents heading out of the outline', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    const doc = unescapeXml(text['word/document.xml']);
    const tocTitle = paragraphContaining(doc, 'Contents');
    expect(tocTitle).not.toContain('Heading1');
  });

  it('lists prologue and epilogue alongside the chapters', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: threeChapters,
      prologue: { id: 'p1', number: 0, title: 'Beginnings', content: 'Prologue body.' } as Chapter,
      epilogue: { id: 'e1', number: 99, title: 'Endings', content: 'Epilogue body.' } as Chapter,
      options: { includeTitles: true, includeTOC: true },
    });
    const { text } = await unzip(blob);
    const doc = unescapeXml(text['word/document.xml']);
    expect(countOf(doc, '>Prologue<')).toBe(2);
    expect(countOf(doc, '>Epilogue<')).toBe(2);
    const anchors = (doc.match(/<w:hyperlink[^>]*w:anchor="([^"]+)"/g) || [])
      .map(h => /w:anchor="([^"]+)"/.exec(h)![1]);
    expect(anchors).toEqual(['prologue', 'chapter_1', 'chapter_2', 'chapter_3', 'epilogue']);
  });
});

describe('buildDocxBlob — illustration embedding', () => {
  // 1x1 transparent PNG bytes, base64-encoded.
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  // 1x1 JPEG bytes, base64-encoded.
  const JPG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////2wBDAf//////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AfwD/2Q==';

  // Re-header the 1x1 PNG above to a given size. Offsets 16..24 of a
  // PNG are the IHDR width/height (signature 8 + chunk length 4 +
  // "IHDR" 4). The CRC goes stale, which nothing in the DOCX pipeline
  // checks — the point is only to exercise header parsing.
  function makePng(width: number, height: number): string {
    const bytes = Uint8Array.from(atob(PNG_B64), c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  function withIllustrations(map: Map<string, any>): DocxBuildInput {
    return { ...baseInput, illustrationCtx: { chapterIllustrations: map } };
  }

  it('embeds a per-chapter illustration as a media file referenced from document.xml', async () => {
    const blob = await buildDocxBlob(withIllustrations(new Map([
      ['c1', { base64: JPG_B64, mimeType: 'image/jpeg', caption: 'Chapter 1 · The Beginning' }],
    ])));
    const { files, text } = await unzip(blob);
    const media = mediaFileNames(files);
    expect(media.length).toBe(1);
    expect(media.some(n => n.endsWith('.jpg'))).toBe(true);
    expect(text['word/document.xml']).toMatch(/<w:drawing>/);
  });

  it('round-trips image bytes exactly (no re-encoding)', async () => {
    const blob = await buildDocxBlob(withIllustrations(new Map([
      ['c1', { base64: JPG_B64, mimeType: 'image/jpeg', caption: 'Chapter 1 · The Beginning' }],
    ])));
    const { files } = await unzip(blob);
    const jpgKey = mediaFileNames(files).find(n => n.endsWith('.jpg'));
    expect(jpgKey).toBeDefined();
    const saved = files[jpgKey!];
    const original = Uint8Array.from(atob(JPG_B64), c => c.charCodeAt(0));
    expect(saved.length).toBe(original.length);
    for (let i = 0; i < saved.length; i++) expect(saved[i]).toBe(original[i]);
  });

  it('sizes the image in 96-DPI pixels, not inches', async () => {
    // docx builds the DrawingML extent as `width * 9525` EMU, so the
    // transformation unit is pixels. Passing inches rendered every
    // illustration as a ~0.03" speck.
    const blob = await buildDocxBlob(withIllustrations(new Map([
      ['c1', { base64: PNG_B64, mimeType: 'image/png', caption: 'Chapter 1 · The Beginning' }],
    ])));
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    const extent = doc.match(/<wp:extent[^>]*\/>/);
    expect(extent).not.toBeNull();
    const cx = Number(/cx="(\d+)"/.exec(extent![0])![1]);
    // The chapter box is 5.0 x 3.5 inches; a 1x1 PNG is limited by
    // height, so it stays square at 3.5" → 336 px → 336 * 9525 EMU.
    expect(cx).toBe(3.5 * 96 * 9525);
    expect(cx).toBeGreaterThan(2 * 914400); // wider than 2 inches
  });

  it('preserves a non-square image aspect ratio inside the max box', async () => {
    // A 4x1 PNG is wider than the 5.0x3.5 chapter box, so it is limited
    // by width and keeps its 4:1 shape (1.25" tall, not stretched).
    const blob = await buildDocxBlob(withIllustrations(new Map([
      ['c1', { base64: makePng(4, 1), mimeType: 'image/png', caption: 'Chapter 1 · The Beginning' }],
    ])));
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    const extent = doc.match(/<wp:extent[^>]*\/>/);
    expect(extent).not.toBeNull();
    const cx = Number(/cx="(\d+)"/.exec(extent![0])![1]);
    const cy = Number(/cy="(\d+)"/.exec(extent![0])![1]);
    expect(cx).toBe(5 * 96 * 9525);
    expect(cy).toBe(Math.round(1.25 * 96) * 9525);
  });

  it('emits no caption paragraph under the illustration', async () => {
    // The illustration service builds every caption as
    // "Chapter N · <title>", the same string as the heading directly
    // above the figure. Printing both makes the page read as a
    // duplicated title.
    const blob = await buildDocxBlob(withIllustrations(new Map([
      ['c1', { base64: JPG_B64, mimeType: 'image/jpeg', caption: 'Chapter 1 · The Beginning' }],
    ])));
    const { text } = await unzip(blob);
    const doc = unescapeXml(text['word/document.xml']);
    expect(doc).not.toContain('Chapter 1 · The Beginning');
    // The heading itself is still there, exactly once.
    expect(doc).toContain('Chapter 1: The Beginning');
    expect(countOf(doc, 'Chapter 1')).toBe(1);
  });

  it('renders prologue and epilogue illustrations', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      chapters: [],
      prologue: { id: 'p1', number: 0, title: 'Prologue', content: 'Prologue body.' } as Chapter,
      epilogue: { id: 'e1', number: 0, title: 'Epilogue', content: 'Epilogue body.' } as Chapter,
      illustrationCtx: {
        chapterIllustrations: new Map([
          ['p1', { base64: JPG_B64, mimeType: 'image/jpeg', caption: 'Prologue' }],
          ['e1', { base64: PNG_B64, mimeType: 'image/png', caption: 'Epilogue' }],
        ]),
      },
      options: { includeTitles: true, includeTOC: false },
    });
    const { files, text } = await unzip(blob);
    const media = mediaFileNames(files);
    expect(media.length).toBe(2);
    expect((text['word/document.xml'].match(/<w:drawing>/g) || []).length).toBe(2);
  });

  it('skips WebP images and still renders the chapter text', async () => {
    // WebP magic bytes (RIFF....WEBP), base64-encoded.
    const WEBP_B64 = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJZQCdAEO/gbsAAA=';
    const blob = await buildDocxBlob(withIllustrations(new Map([
      ['c1', { base64: WEBP_B64, mimeType: 'image/webp' as any, caption: 'Chapter 1' }],
    ])));
    const { files, text } = await unzip(blob);
    const media = mediaFileNames(files);
    expect(media.length).toBe(0);
    expect(text['word/document.xml']).toContain('It was a dark and stormy night.');
  });

  it('renders no drawing at all when no illustration context is supplied', async () => {
    const blob = await buildDocxBlob({ ...baseInput, illustrationCtx: {} });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect((doc.match(/<w:drawing>/g) || []).length).toBe(0);
    expect(doc).toContain('Test Book');
  });
});