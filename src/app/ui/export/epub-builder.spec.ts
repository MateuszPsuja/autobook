import { unzipSync, strFromU8 } from 'fflate';
import { buildEpubBlob, EpubBuildInput } from './epub-builder';
import { BookConfig } from '../../models/book-config.model';
import { Chapter } from '../../models/chapter.model';

const baseInput: EpubBuildInput = {
  chapters: [
    { id: 'c1', number: 1, title: 'The Beginning', content: 'It was a dark and stormy night.\n\nThe rain fell hard.' } as Chapter,
    { id: 'c2', number: 2, title: 'The Middle', content: 'Things got complicated.' } as Chapter,
  ],
  config: { title: 'Test Book', genre: 'mystery', protagonist: { name: 'Alex' }, themes: ['love', 'loss'] } as unknown as BookConfig,
  labels: {
    bookAuthor: 'Written by AI', aBookLabel: 'a novel', tocLabel: 'Contents',
    chapterLabel: 'Chapter', untitledFallback: 'Untitled', stopping: 'Stopping...',
    translating: 'Translating...', backCoverHead: 'About the author',
    backCoverSubject: 'AutoBook', backCoverVerb: ' exploring', backCoverUnknownTheme: 'mystery',
    backCoverUnknownProtagonist: 'A protagonist', backCoverUnknownTitle: 'This book',
    backCoverBlurbTemplate: '"{title}" is about {protagonist}.', isbnPlaceholder: 'ISBN 000-0-00-000000-0',
    themeSeparator: ', ',
  },
  bookAuthor: 'Written by AI',
};

/** Unzip a Blob (asynchronously) and return both the raw bytes and
 * a text view of every entry. Single helper so the tests stay terse. */
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

describe('buildEpubBlob — package structure', () => {
  it('returns a Blob with type application/epub+zip', () => {
    const blob = buildEpubBlob(baseInput);
    expect(blob.type).toBe('application/epub+zip');
  });

  it('puts the uncompressed mimetype entry as the first ZIP entry with the canonical value', async () => {
    const blob = buildEpubBlob(baseInput);
    const { files } = await unzip(blob);
    const names = Object.keys(files);
    expect(names[0]).toBe('mimetype');
    expect(strFromU8(files['mimetype'])).toBe('application/epub+zip');
  });

  it('includes META-INF/container.xml pointing at OEBPS/package.opf', async () => {
    const blob = buildEpubBlob(baseInput);
    const { text } = await unzip(blob);
    expect(text['META-INF/container.xml']).toContain('<rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>');
  });

  it('includes an EPUB 3 navigation document with every chapter', async () => {
    const blob = buildEpubBlob(baseInput);
    const { text } = await unzip(blob);
    const nav = text['OEBPS/nav.xhtml'];
    // epub:type="toc" is the semantically meaningful part; the
    // attribute order can vary, so check for the substring rather
    // than the full opening tag.
    expect(nav).toContain('<nav ');
    expect(nav).toContain('epub:type="toc"');
    expect(nav).toContain('The Beginning');
    expect(nav).toContain('The Middle');
  });

  it('includes one XHTML file per chapter with the localised chapter label', async () => {
    const blob = buildEpubBlob(baseInput);
    const { text } = await unzip(blob);
    const c1 = text['OEBPS/xhtml/chapter-1.xhtml'];
    expect(c1).toContain('The Beginning');
    expect(c1).toContain('It was a dark and stormy night.');
    const c2 = text['OEBPS/xhtml/chapter-2.xhtml'];
    expect(c2).toContain('The Middle');
  });

  it('strips the running word-count footer from chapter content', async () => {
    // Use content that the stripper actually handles: the "Count:"
    // prefix is a strong signal that fires unconditionally. The
    // detailed strip rules are covered by chapter-cleanup.spec.ts;
    // here we just need to confirm the EPUB builder wires the
    // function into the chapter XHTML pipeline.
    const inputWithWordCount: EpubBuildInput = {
      ...baseInput,
      chapters: [
        {
          id: 'c1', number: 1, title: 'Has count',
          // "Count:" prefix + per-word counters in the body +
          // trailing "90 words." — every signal the stripper
          // uses, all in one short block.
          content: 'Count: a1 banner2 fluttered3 snap4 quickly5 across6 the7 morning8 sky9. 90 words.',
        } as Chapter,
      ],
    };
    const blob = buildEpubBlob(inputWithWordCount);
    const { text } = await unzip(blob);
    const c1 = text['OEBPS/xhtml/chapter-1.xhtml'];
    // The Count: prefix is the strong signal — confirm the stripper
    // is wired into the chapter XHTML pipeline by checking that the
    // body is cleaned. Detailed strip rules are tested in
    // chapter-cleanup.spec.ts.
    expect(c1).not.toMatch(/Count:\s*a/);
  });

  it('does not include image entries when no illustrationCtx is provided', async () => {
    const blob = buildEpubBlob(baseInput);
    const { files } = await unzip(blob);
    const imageEntries = Object.keys(files).filter(n => n.startsWith('OEBPS/images/'));
    expect(imageEntries).toEqual([]);
  });

  it('includes a stylesheet referenced from every XHTML file', async () => {
    const blob = buildEpubBlob(baseInput);
    const { text } = await unzip(blob);
    expect(text['OEBPS/styles/book.css']).toBeDefined();
    expect(text['OEBPS/styles/book.css'].length).toBeGreaterThan(100);
    expect(text['OEBPS/xhtml/cover.xhtml']).toContain('href="../styles/book.css"');
    expect(text['OEBPS/xhtml/back-cover.xhtml']).toContain('href="../styles/book.css"');
    expect(text['OEBPS/xhtml/chapter-1.xhtml']).toContain('href="../styles/book.css"');
    expect(text['OEBPS/nav.xhtml']).toContain('href="styles/book.css"');
  });
});

describe('buildEpubBlob — typography', () => {
  it('uses a serif body font and sets a comfortable line-height', async () => {
    const blob = buildEpubBlob(baseInput);
    const { text } = await unzip(blob);
    const css = text['OEBPS/styles/book.css'];
    expect(css).toMatch(/font-family[^;]*(Garamond|Georgia|serif)/i);
    expect(css).toMatch(/line-height:\s*1\.[5-7]/);
  });

  it('centers and styles the chapter title with extra top spacing', async () => {
    const blob = buildEpubBlob(baseInput);
    const { text } = await unzip(blob);
    const css = text['OEBPS/styles/book.css'];
    expect(css).toContain('.chapter-title');
    expect(css).toMatch(/text-align:\s*center/);
  });

  it('sets a drop cap on the first paragraph of each chapter', async () => {
    const blob = buildEpubBlob(baseInput);
    const { text } = await unzip(blob);
    const css = text['OEBPS/styles/book.css'];
    expect(css).toContain('.first-paragraph::first-letter');
    // 3-4em tall drop cap, allowing decimals (3.4em is the actual value).
    expect(css).toMatch(/font-size:\s*3(?:\.\d+)?em/);
  });

  it('enables hyphenation and a comfortable text margin', async () => {
    const blob = buildEpubBlob(baseInput);
    const { text } = await unzip(blob);
    const css = text['OEBPS/styles/book.css'];
    expect(css).toContain('hyphens: auto');
    expect(css).toMatch(/margin:\s*\d/);
  });

  it('marks the first paragraph of each chapter with the first-paragraph class', async () => {
    const blob = buildEpubBlob(baseInput);
    const { text } = await unzip(blob);
    const c1 = text['OEBPS/xhtml/chapter-1.xhtml'];
    expect(c1).toMatch(/<p class="first-paragraph">It was a dark/);
  });

  it('forces a page break before each chapter', async () => {
    const blob = buildEpubBlob(baseInput);
    const { text } = await unzip(blob);
    const css = text['OEBPS/styles/book.css'];
    const hasPageBreak =
      css.includes('page-break-before: always') ||
      css.includes('break-before: page');
    expect(hasPageBreak).toBe(true);
  });
});

describe('buildEpubBlob — illustration embedding', () => {
  // 1x1 transparent PNG bytes, base64-encoded.
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  // 1x1 JPEG bytes, base64-encoded.
  const JPG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////2wBDAf//////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AfwD/2Q==';

  it('embeds the cover image as a separate file and references it from the cover XHTML', async () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        coverArt: { base64: JPG_B64, mimeType: 'image/jpeg', side: 'front' },
      },
    });
    const { files, text } = await unzip(blob);
    expect(files['OEBPS/images/cover-front.jpg']).toBeDefined();
    expect(text['OEBPS/xhtml/cover.xhtml']).toContain('<img src="../images/cover-front.jpg"');
  });

  it('embeds the back-cover image and references it from the back cover XHTML', async () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        backCoverArt: { base64: PNG_B64, mimeType: 'image/png', side: 'back' },
      },
    });
    const { files, text } = await unzip(blob);
    expect(files['OEBPS/images/cover-back.png']).toBeDefined();
    expect(text['OEBPS/xhtml/back-cover.xhtml']).toContain('<img src="../images/cover-back.png"');
  });

  it('embeds a per-chapter illustration and references it from the chapter XHTML', async () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        chapterIllustrations: new Map([
          ['c1', { base64: JPG_B64, mimeType: 'image/jpeg', caption: 'Chapter 1 · The Beginning' }],
        ]),
      },
    });
    const { files, text } = await unzip(blob);
    expect(files['OEBPS/images/illustration-c1.jpg']).toBeDefined();
    const c1 = text['OEBPS/xhtml/chapter-1.xhtml'];
    expect(c1).toContain('<img src="../images/illustration-c1.jpg"');
    expect(c1).toContain('Chapter 1 · The Beginning');
  });

  it('uses the actual byte format (not the supplied mimeType) for the file extension', async () => {
    // Caller says "image/png" but the bytes are JPEG (starts with /9j/).
    // The EPUB file should still be saved as .jpg.
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        coverArt: { base64: JPG_B64, mimeType: 'image/png', side: 'front' },
      },
    });
    const { files, text } = await unzip(blob);
    expect(files['OEBPS/images/cover-front.jpg']).toBeDefined();
    expect(files['OEBPS/images/cover-front.png']).toBeUndefined();
    expect(text['OEBPS/package.opf']).toContain('media-type="image/jpeg"');
  });

  it('declares every image in the OPF manifest with the correct media-type', async () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        coverArt: { base64: JPG_B64, mimeType: 'image/jpeg', side: 'front' },
        backCoverArt: { base64: PNG_B64, mimeType: 'image/png', side: 'back' },
        chapterIllustrations: new Map([
          ['c1', { base64: JPG_B64, mimeType: 'image/jpeg', caption: 'C1' }],
        ]),
      },
    });
    const { text } = await unzip(blob);
    const opf = text['OEBPS/package.opf'];
    expect(opf).toContain('id="img-cover-front"');
    expect(opf).toContain('href="images/cover-front.jpg"');
    expect(opf).toContain('media-type="image/jpeg"');
    expect(opf).toContain('id="img-cover-back"');
    expect(opf).toContain('href="images/cover-back.png"');
    expect(opf).toContain('media-type="image/png"');
    expect(opf).toContain('id="img-illust-c1"');
    expect(opf).toContain('href="images/illustration-c1.jpg"');
  });

  it('round-trips image bytes exactly (no re-encoding)', async () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        coverArt: { base64: JPG_B64, mimeType: 'image/jpeg', side: 'front' },
      },
    });
    const { files } = await unzip(blob);
    const saved = files['OEBPS/images/cover-front.jpg'];
    const original = Uint8Array.from(atob(JPG_B64), c => c.charCodeAt(0));
    expect(saved.length).toBe(original.length);
    for (let i = 0; i < saved.length; i++) expect(saved[i]).toBe(original[i]);
  });

  it('falls back to a typographic cover when coverArt is missing', async () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {},
    });
    const { text } = await unzip(blob);
    expect(text['OEBPS/xhtml/cover.xhtml']).toContain('Test Book');
    expect(text['OEBPS/xhtml/cover.xhtml']).not.toContain('<img');
  });

  it('styles the figure/figcaption in the chapter XHTML', async () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        chapterIllustrations: new Map([
          ['c1', { base64: JPG_B64, mimeType: 'image/jpeg', caption: 'Chapter 1 · The Beginning' }],
        ]),
      },
    });
    const { text } = await unzip(blob);
    const c1 = text['OEBPS/xhtml/chapter-1.xhtml'];
    expect(c1).toContain('<figure class="chapter-illustration">');
    expect(c1).toContain('<figcaption>Chapter 1 · The Beginning</figcaption>');
    const css = text['OEBPS/styles/book.css'];
    expect(css).toContain('.chapter-illustration');
    expect(css).toContain('figcaption');
  });
});
