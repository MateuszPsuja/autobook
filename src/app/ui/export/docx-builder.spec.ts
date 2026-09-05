import { unzipSync, strFromU8 } from 'fflate';
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
    chapterLabel: 'Chapter', untitledFallback: 'Untitled', stopping: 'Stopping...',
    translating: 'Translating...', backCoverHead: 'About the author',
    backCoverSubject: 'AutoBook', backCoverVerb: ' exploring', backCoverUnknownTheme: 'mystery',
    backCoverUnknownProtagonist: 'A protagonist', backCoverUnknownTitle: 'This book',
    backCoverBlurbTemplate: '"{title}" is about {protagonist}.', isbnPlaceholder: 'ISBN 000-0-00-000000-0',
    themeSeparator: ', ',
  },
  bookAuthor: 'Written by AI',
};

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

  it('embeds the book title and "a novel" tag in word/document.xml', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).toContain('Test Book');
    expect(doc).toContain('a novel');
  });

  it('embeds every chapter with the localised chapter label', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).toContain('The Beginning');
    expect(doc).toContain('The Middle');
    // First letter is split off for the drop cap, so look for the
    // post-drop-cap portion of the body text.
    expect(doc).toContain('t was a dark and stormy night.');
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

  it('sets first-line indent on body paragraphs (except the first)', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // Look for w:ind with w:firstLine (the indent in twips).
    expect(doc).toMatch(/<w:ind[^>]*w:firstLine=/);
  });

  it('drops the first letter of the first paragraph at a larger size (drop cap)', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // Find the run that contains just the first letter "I" and
    // assert it has the drop-cap font size. Body is 22 half-points
    // (11pt); drop cap is 22 × 3.4 ≈ 75 half-points (~37pt).
    // The run is split off as its own <w:r>…</w:r> element.
    const runWithI = doc.match(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>I<\/w:t>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/);
    expect(runWithI).not.toBeNull();
    expect(runWithI![0]).toMatch(/<w:sz w:val="75"\/>/);
  });

  it('centers the chapter title', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // The chapter title run should be inside a paragraph with center alignment.
    expect(doc).toContain('w:val="center"');
  });

  it('forces a page break between chapters', async () => {
    const blob = await buildDocxBlob(baseInput);
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // PageBreak renders as <w:br w:type="page"/> in OOXML.
    const pageBreakCount = (doc.match(/<w:br w:type="page"\/>/g) || []).length;
    // Cover (1) + each chapter (1) + back cover (1) = N+2.
    expect(pageBreakCount).toBe(baseInput.chapters.length + 2);
  });
});

describe('buildDocxBlob — illustration embedding', () => {
  // 1x1 transparent PNG bytes, base64-encoded.
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  // 1x1 JPEG bytes, base64-encoded.
  const JPG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////2wBDAf//////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AfwD/2Q==';

  it('embeds the cover image as a media file and references it from document.xml', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      illustrationCtx: {
        coverArt: { base64: JPG_B64, mimeType: 'image/jpeg', side: 'front' },
      },
    });
    const { files, text } = await unzip(blob);
    const media = Object.keys(files).filter(n => n.startsWith('word/media/'));
    expect(media.length).toBeGreaterThan(0);
    expect(media.some(n => n.endsWith('.jpg'))).toBe(true);
    const doc = text['word/document.xml'];
    // The document references the image via a relationship; the
    // rId will be in the document.xml somewhere. We can assert
    // that document.xml has at least one <w:drawing> element.
    expect(doc).toMatch(/<w:drawing>/);
  });

  it('embeds the back-cover image and renders the blurb', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      illustrationCtx: {
        backCoverArt: { base64: PNG_B64, mimeType: 'image/png', side: 'back' },
      },
    });
    const { files, text } = await unzip(blob);
    const media = Object.keys(files).filter(n => n.startsWith('word/media/'));
    expect(media.some(n => n.endsWith('.png'))).toBe(true);
    const doc = text['word/document.xml'];
    expect(doc).toContain('Test Book');
    expect(doc).toContain('About the author');
  });

  it('embeds a per-chapter illustration and renders the caption', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      illustrationCtx: {
        chapterIllustrations: new Map([
          ['c1', { base64: JPG_B64, mimeType: 'image/jpeg', caption: 'Chapter 1 · The Beginning' }],
        ]),
      },
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    expect(doc).toContain('Chapter 1 · The Beginning');
    expect(doc).toMatch(/<w:drawing>/);
  });

  it('round-trips image bytes exactly (no re-encoding)', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      illustrationCtx: {
        coverArt: { base64: JPG_B64, mimeType: 'image/jpeg', side: 'front' },
      },
    });
    const { files } = await unzip(blob);
    const mediaKeys = Object.keys(files).filter(n => n.startsWith('word/media/'));
    expect(mediaKeys.length).toBeGreaterThan(0);
    // Find the embedded jpg and check bytes.
    const jpgKey = mediaKeys.find(n => n.endsWith('.jpg'));
    expect(jpgKey).toBeDefined();
    const saved = files[jpgKey!];
    const original = Uint8Array.from(atob(JPG_B64), c => c.charCodeAt(0));
    expect(saved.length).toBe(original.length);
    for (let i = 0; i < saved.length; i++) expect(saved[i]).toBe(original[i]);
  });

  it('falls back to a typographic cover when coverArt is missing', async () => {
    const blob = await buildDocxBlob({
      ...baseInput,
      illustrationCtx: {},
    });
    const { text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // The cover still renders the title and "a novel" tag.
    expect(doc).toContain('Test Book');
    expect(doc).toContain('a novel');
    // No drawings in the cover region.
    const drawingCount = (doc.match(/<w:drawing>/g) || []).length;
    expect(drawingCount).toBe(0);
  });

  it('skips WebP images with a typographic fallback', async () => {
    // WebP magic bytes (RIFF....WEBP), base64-encoded.
    const WEBP_B64 = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJZQCdAEO/gbsAAA=';
    const blob = await buildDocxBlob({
      ...baseInput,
      illustrationCtx: {
        coverArt: { base64: WEBP_B64, mimeType: 'image/webp' as any, side: 'front' },
      },
    });
    const { files, text } = await unzip(blob);
    const doc = text['word/document.xml'];
    // Typographic cover still renders.
    expect(doc).toContain('Test Book');
    // No image media in the package (WebP was skipped).
    const mediaKeys = Object.keys(files).filter(n => n.startsWith('word/media/'));
    expect(mediaKeys.length).toBe(0);
  });
});
