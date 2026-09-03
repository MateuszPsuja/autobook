import { buildPdfDocument, PdfExportOptions } from './pdf-renderer';
import { buildCoverPage, buildBackCoverPage, buildBackCoverBlurb } from './pdf-cover';
import { Chapter } from '../../models/chapter.model';

describe('buildPdfDocument', () => {
  const baseOptions: PdfExportOptions = {
    includeTitles: true,
    includeTOC: true,
    includeCritiques: false,
    includeCharacters: false,
    includeIllustrations: false,
    illustrationStyle: 'auto',
  };

  const chapterA: Chapter = {
    id: 'a',
    number: 1,
    title: 'The Beginning',
    content: 'First paragraph of the story.\n\nSecond paragraph here.',
    wordCount: 8,
    status: 'approved',
    createdAt: new Date(),
    revisions: [],
  };

  const chapterB: Chapter = {
    id: 'b',
    number: 2,
    title: 'The Journey',
    content: 'He set out at dawn.\n\n* * *\n\nA new scene begins here.',
    wordCount: 12,
    status: 'approved',
    createdAt: new Date(),
    revisions: [],
  };

  const chapterWithCritique: Chapter = {
    ...chapterA,
    id: 'c',
    number: 3,
    title: 'The Trial',
    critique: {
      overallScore: 8,
      feedback: 'Strong pacing.',
      mustFix: [],
      suggestions: [],
      prose: 0,
      pacing: 0,
      dialogue: 0,
    } as any,
  };

  const baseState = {
    config: {
      title: 'A Test Book',
      genre: 'Fantasy',
      themes: ['Courage', 'Loss'],
      protagonist: { name: 'Hero' },
    },
  } as any;

  it('builds a doc with title page, TOC, and chapters', () => {
    const doc = buildPdfDocument([chapterA, chapterB], baseOptions, {
      state: baseState,
      isPolish: false,
    });

    expect(doc.pageSize).toEqual({ width: 432, height: 648 });
    expect(doc.pageMargins).toEqual([72, 84, 48, 84]);
    expect(typeof doc.header).toBe('function');
    expect(typeof doc.footer).toBe('function');
    expect(doc.content.length).toBeGreaterThan(0);
    expect(doc.styles.bookTitle).toBeTruthy();
    expect(doc.styles.bodyParagraph).toBeTruthy();
  });

  it('uses Polish labels when isPolish is true', () => {
    const doc = buildPdfDocument([chapterA], baseOptions, {
      state: baseState,
      isPolish: true,
    });
    const flat = JSON.stringify(doc);
    expect(flat).toContain('SPIS TREŚCI');
    expect(flat).toContain('ROZDZIAŁ');
  });

  it('marks each chapter with an id for the TOC pageReference to resolve', () => {
    const doc = buildPdfDocument([chapterA, chapterB], baseOptions, {
      state: baseState,
      isPolish: false,
    });
    const flat = JSON.stringify(doc);
    // The chapter id is on a real text node (the eyebrow), not an empty
    // placeholder — pdfmake ignores ids on empty text since no line is
    // built for them.
    expect(flat).toContain('"id":"ch-a"');
    expect(flat).toContain('"id":"ch-b"');
    expect(flat).toContain('"pageReference":"ch-a"');
    expect(flat).toContain('"pageReference":"ch-b"');
  });

  describe('every chapter makes it into the PDF', () => {
    // Regression guard: previously a chapter could be silently absent
    // from the rendered PDF if the renderer skipped it for any reason.
    // These tests verify the count and presence of every chapter's
    // id, title, and body in the generated document definition.
    const makeChapter = (id: string, number: number, title: string, content: string): Chapter => ({
      id,
      number,
      title,
      content,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      status: 'approved',
      createdAt: new Date(),
      revisions: [],
    });

    it('renders an id anchor and pageReference for every chapter', () => {
      const chapters = [
        makeChapter('1', 1, 'First', 'The story begins here.'),
        makeChapter('2', 2, 'Second', 'The story continues here.'),
        makeChapter('3', 3, 'Third', 'The story ends here.'),
      ];
      const doc = buildPdfDocument(chapters, baseOptions, {
        state: baseState,
        isPolish: false,
      });
      const flat = JSON.stringify(doc);
      for (const ch of chapters) {
        expect(flat).toContain(`"id":"ch-${ch.id}"`);
        expect(flat).toContain(`"pageReference":"ch-${ch.id}"`);
      }
    });

    it('renders every chapter title and body in the document', () => {
      const chapters = [
        makeChapter('1', 1, 'First', 'The story begins here with unique alpha-marker.'),
        makeChapter('2', 2, 'Second', 'The story continues with unique beta-marker here.'),
        makeChapter('3', 3, 'Third', 'The story ends with unique gamma-marker content.'),
      ];
      const doc = buildPdfDocument(chapters, baseOptions, {
        state: baseState,
        isPolish: false,
      });
      const flat = JSON.stringify(doc);
      for (const ch of chapters) {
        expect(flat).toContain(ch.title);
        // Each body has a unique marker phrase that only appears in
        // that chapter — guarantees no chapter's prose was dropped.
        const marker = ch.content.match(/unique (\w+)-marker/)?.[1];
        expect(marker).toBeTruthy();
        expect(flat).toContain(`${marker}-marker`);
      }
    });

    it('uses middle dots (U+00B7) — not asterism (U+2733) — for the chapter ornament', () => {
      // The asterism (U+2733) lives in the Dingbats block; the Roboto
      // font that pdfmake bundles is a subset and does not include it,
      // so the glyph silently disappears in the rendered PDF. The
      // middle dot (U+00B7) is in basic Latin-1 Supplement, every
      // font has it, and it renders the same way the design intends.
      const chapters = [makeChapter('1', 1, 'First', 'Body.')];
      const doc = buildPdfDocument(chapters, baseOptions, {
        state: baseState,
        isPolish: false,
      });
      const flat = JSON.stringify(doc);
      // Three middle dots (with spaces) for the chapter ornament
      expect(flat).toContain('·  ·  ·');
      // And no asterism anywhere in the document content
      expect(flat).not.toContain('✳');
    });

    it('renders a TOC entry for every chapter', () => {
      const chapters = [
        makeChapter('1', 1, 'First', 'Body one.'),
        makeChapter('2', 2, 'Second', 'Body two.'),
        makeChapter('3', 3, 'Third', 'Body three.'),
        makeChapter('4', 4, 'Fourth', 'Body four.'),
      ];
      const doc = buildPdfDocument(chapters, baseOptions, {
        state: baseState,
        isPolish: false,
      });
      const flat = JSON.stringify(doc);
      const tocPageRefCount = (flat.match(/"pageReference":"ch-/g) || []).length;
      const chapterIdCount = (flat.match(/"id":"ch-/g) || []).length;
      // 4 TOC entries (4 pageReferences) and 4 chapter ids — they
      // should match the chapter count exactly.
      expect(tocPageRefCount).toBe(chapters.length);
      expect(chapterIdCount).toBe(chapters.length);
    });

    it('gives the chapter title its own column (width: *) so Polish titles do not break on a narrow sibling', () => {
      // Regression for the "Polish chapter titles broken to two lines"
      // bug. The eyebrow + title used to be one inline `text: [...]`
      // run in a single column, so the column sized to the eyebrow
      // and the title had to wrap inside that narrow band. Splitting
      // into three columns (eyebrow auto, title *, page-number auto)
      // gives the title the full remaining width.
      const chapters = [
        makeChapter('1', 1, 'Pierwszy krok ku przeznaczeniu, gdzie wszystko się zaczyna', 'Body one.'),
      ];
      const doc = buildPdfDocument(chapters, baseOptions, {
        state: baseState,
        isPolish: true,
      });
      const flat = JSON.stringify(doc);
      // The TOC entry block is the one with `pageReference` set
      // alongside a text payload — match that block and inspect its
      // columns. Look for the marker string that only appears in
      // the title column.
      const tocEntryMatch = flat.match(/\{"columns":\[\{[^]*?"Rozdział 1"[\s\S]*?"pageReference":"ch-1"[\s\S]*?\}\]/);
      expect(tocEntryMatch).not.toBeNull();
      const tocEntry = tocEntryMatch![0];
      // The title-bearing column should have width "*" so it claims
      // the remaining space and Polish titles fit on a single line.
      expect(tocEntry).toContain('"width":"*"');
      // The eyebrow column should be width "auto" so it doesn't
      // bloat — only "Rozdział N" lives there.
      expect(tocEntry).toContain('"text":"Rozdział 1"');
    });

    it('preserves chapter order', () => {
      const chapters = [
        makeChapter('1', 1, 'Alpha', 'alpha body'),
        makeChapter('2', 2, 'Bravo', 'bravo body'),
        makeChapter('3', 3, 'Charlie', 'charlie body'),
      ];
      const doc = buildPdfDocument(chapters, baseOptions, {
        state: baseState,
        isPolish: false,
      });
      const flat = JSON.stringify(doc);
      // Find the position of each title in the flattened content; they
      // should appear in chapter order.
      const positions = chapters.map(ch => ({
        title: ch.title,
        content: ch.content,
        pos: flat.indexOf(ch.title),
      }));
      expect(positions[0].pos).toBeLessThan(positions[1].pos);
      expect(positions[1].pos).toBeLessThan(positions[2].pos);
    });
  });

  it('still anchors the chapter id when includeTitles is false', () => {
    const doc = buildPdfDocument([chapterA], { ...baseOptions, includeTitles: false }, {
      state: baseState,
      isPolish: false,
    });
    const flat = JSON.stringify(doc);
    expect(flat).toContain('"id":"ch-a"');
    expect(flat).toContain('"pageReference":"ch-a"');
  });

  it('uses roman numerals for chapter eyebrows', () => {
    const doc = buildPdfDocument([chapterA, chapterB], baseOptions, {
      state: baseState,
      isPolish: false,
    });
    const flat = JSON.stringify(doc);
    expect(flat).toContain('CHAPTER  I');
    expect(flat).toContain('CHAPTER  II');
  });

  it('omits the header and footer on the first two pages (title + author)', () => {
    const doc = buildPdfDocument([chapterA], baseOptions, {
      state: baseState,
      isPolish: false,
    });
    expect(doc.header!(1, 1)).toBeNull();
    expect(doc.header!(2, 1)).toBeNull();
    expect(doc.footer!(1, 1)).toBeNull();
    expect(doc.footer!(2, 1)).toBeNull();
    // but not on page 3
    const header = doc.header!(3, 1);
    expect(header).not.toBeNull();
    const footer = doc.footer!(3, 1);
    expect(footer).not.toBeNull();
  });

  it('alternates header alignment by page parity', () => {
    const doc = buildPdfDocument([chapterA], baseOptions, {
      state: baseState,
      isPolish: false,
    });
    // page 3 is odd → left
    const h3 = doc.header!(3, 1) as any;
    expect(h3.columns[0].alignment).toBe('left');
    // page 4 is even → right (verso)
    const h4 = doc.header!(4, 1) as any;
    expect(h4.columns[0].alignment).toBe('right');
  });

  it('detects scene-break lines and renders them as ornaments', () => {
    const doc = buildPdfDocument([chapterB], baseOptions, {
      state: baseState,
      isPolish: false,
    });
    const flat = JSON.stringify(doc);
    expect(flat).toContain('"sceneBreak"');
  });

  it('builds a drop-cap column for the first paragraph of a chapter', () => {
    const doc = buildPdfDocument([chapterA], baseOptions, {
      state: baseState,
      isPolish: false,
    });
    const flat = JSON.stringify(doc);
    // The first letter of "First paragraph..." is "F"
    expect(flat).toMatch(/"text":"F"/);
  });

  it('skips the TOC when includeTOC is false', () => {
    const doc = buildPdfDocument([chapterA], { ...baseOptions, includeTOC: false }, {
      state: baseState,
      isPolish: false,
    });
    const flat = JSON.stringify(doc);
    expect(flat).not.toContain('TABLE OF CONTENTS');
  });

  it('appends a critique section when includeCritiques is true', () => {
    const doc = buildPdfDocument([chapterWithCritique], { ...baseOptions, includeCritiques: true }, {
      state: baseState,
      isPolish: false,
    });
    const flat = JSON.stringify(doc);
    expect(flat).toContain('CRITIQUE REPORT');
    expect(flat).toContain('Strong pacing.');
  });

  it('falls back to sensible defaults when config is missing', () => {
    const doc = buildPdfDocument([chapterA], baseOptions, {
      state: { config: { title: '', themes: [], protagonist: { name: '' } } } as any,
      isPolish: false,
    });
    const flat = JSON.stringify(doc);
    expect(flat).toContain('UNTITLED');
    expect(flat).toContain('AUTOBOOK');
  });

  describe('PDF metadata (info field)', () => {
    // pdfmake passes docDefinition.info to the underlying PDF
    // (printer.js: `if (docDefinition.info) ...`) so the author /
    // title show up in the file's Properties dialog and in
    // downstream tools (Calibre, Adobe Reader, etc.). We hard-code
    // the author to "Written by artificial intelligence" because
    // every book shipped from AutoBook is an AI-generated work;
    // the in-cover byline is a separate concept and is rendered as
    // page content.
    it('sets info.author to "Written by artificial intelligence"', () => {
      const doc = buildPdfDocument([chapterA], baseOptions, {
        state: baseState,
        isPolish: false,
      });
      expect((doc as any).info).toBeTruthy();
      expect((doc as any).info.author).toBe('Written by artificial intelligence');
    });

    it('sets info.title to the book title', () => {
      const doc = buildPdfDocument([chapterA], baseOptions, {
        state: baseState,
        isPolish: false,
      });
      expect((doc as any).info.title).toBe('A Test Book');
    });

    it('falls back to the localised "Untitled" when config title is missing', () => {
      const doc = buildPdfDocument([chapterA], baseOptions, {
        state: { config: { title: '', themes: [], protagonist: { name: '' } } } as any,
        isPolish: false,
      });
      expect((doc as any).info.title).toBe('Untitled');
    });
  });

  describe('cover and back cover fit on a single page', () => {
    // Regression guard: the front cover and back cover are the most
    // visually exposed pages of the exported PDF, and a layout that
    // overflows by even a few points spills the author byline, the
    // bottom rule, the bio, the rule, or the ISBN onto a second
    // page — splitting the cover across two pages. The cheapest
    // proxy we have at the doc-definition level is: the cover /
    // back-cover content block must NOT include an explicit
    // `pageBreak` directive. pdfmake only inserts a page break when
    // content cannot fit on the current page, but adding an
    // explicit `pageBreak: 'after'` (or starting with
    // `pageBreak: 'before'`) is what would split a single-page
    // layout into two. The back cover's first element does carry
    // `pageBreak: 'before'` (to land it as the final page of the
    // book), so we check that the *cover* content block — the one
    // before any chapter id — has no page break, and that the
    // *back cover* content (everything after the last chapter id)
    // is the only place `pageBreak: 'before'` appears.
    const coverArt = {
      base64: 'iVBORw0KGgo=',
      mimeType: 'image/png',
    } as any;
    const backCoverArt = {
      base64: 'iVBORw0KGgo=',
      mimeType: 'image/png',
    } as any;

    it('front cover content has no page-break directive', () => {
      // Use buildCoverPage directly so the assertion is scoped to
      // *just* the cover content. The TOC ends with a
      // `pageBreak: 'after'` to start the chapter on a new page,
      // and each chapter starts with a `pageBreak: 'before'` — both
      // are expected and out of scope here. We're verifying the
      // cover itself is a single, uninterrupted page.
      const cover = buildCoverPage(coverArt, {
        bookTitle: 'A Test Book',
        bookAuthor: 'Hero',
        genre: 'Fantasy',
        isPolish: false,
      });
      const flat = JSON.stringify(cover);
      expect(flat).not.toMatch(/"pageBreak"\s*:/);
    });

    it('back cover content has no trailing page-break directive', () => {
      // The back cover is the trailing run of elements after the
      // last chapter id anchor. The blurb at the top of the back
      // cover legitimately carries `pageBreak: 'before'` to make
      // sure the back cover is a new page, but nothing in the back
      // cover should ask for a page break *after* itself — that
      // would split the back cover across two pages.
      const backCover = buildBackCoverPage(backCoverArt, {
        blurb: 'A gripping tale.',
        authorBio: 'About the author: a storyteller.',
        bookAuthor: 'Hero',
      });
      const flat = JSON.stringify(backCover);
      // Back cover starts with pageBreak: 'before' on the blurb
      expect(flat).toMatch(/"pageBreak"\s*:\s*"before"/);
      // But no pageBreak: 'after' anywhere in the back cover
      expect(flat).not.toMatch(/"pageBreak"\s*:\s*"after"/);
    });

    it('front cover fits within the 480pt content area budget', () => {
      // Sanity-check the layout budget documented in pdf-cover.ts.
      // We can't render the PDF from the spec, but we can sum up
      // every fixed height and margin in buildCoverPage's output
      // and confirm it's under 480pt for the typical 1-line title.
      const cover = buildCoverPage(coverArt, {
        bookTitle: 'A Test Book',
        bookAuthor: 'Hero',
        genre: 'Fantasy',
        isPolish: false,
      });
      const totalMargin = cover.reduce((sum: number, el: any) => {
        const m = el.margin || [0, 0, 0, 0];
        return sum + (m[1] || 0) + (m[3] || 0);
      }, 0);
      // title 30pt × 1.15 ≈ 34.5pt, genre 10pt, "a novel" 11pt,
      // author 12pt, titleSpacer 4pt, image `fit: [210, 280]`
      // (the worst case is the box height: 280pt for a 3:4 image
      // rendered inside a 210×280 box — pdfmake scales to fit).
      const totalContent = 34.5 + 10 + 11 + 12 + 4 + 280;
      // Add a small safety buffer for the canvas rules' sub-pixel
      // height and any rounding pdfmake applies.
      expect(totalMargin + totalContent).toBeLessThan(480);
    });

    it('back cover fits within the 480pt content area budget', () => {
      // Same approach as the front-cover budget test. A 4-line
      // blurb + 2-line author bio is the realistic worst case for
      // the typical 280-char blurb and 200-char bio caps in
      // buildBackCoverBlurb.
      const { blurb, authorBio } = buildBackCoverBlurb(
        {
          title: 'A Test Book',
          themes: ['Courage', 'Loss'],
          protagonist: { name: 'Hero', background: 'a wandering scholar' },
        } as any,
        false
      );
      const backCover = buildBackCoverPage(backCoverArt, {
        blurb,
        authorBio,
        bookAuthor: 'Hero',
      });
      const totalMargin = backCover.reduce((sum: number, el: any) => {
        const m = el.margin || [0, 0, 0, 0];
        return sum + (m[1] || 0) + (m[3] || 0);
      }, 0);
      // blurb 4 lines × 11pt × 1.5 = 66pt, author bio 2 lines × 10pt
      // × 1.4 = 28pt, author byline 12pt, ISBN 8pt, image 181pt
      const totalContent = 66 + 28 + 12 + 8 + 181;
      expect(totalMargin + totalContent).toBeLessThan(480);
    });
  });

  describe('defensive cleanup for running word-count corruption', () => {
    // The model in some setups outputs the per-word counter inline, e.g.
    //   "Count: A1 banner2 fluttered3 ... snap91. 91 words. ECHOES OF TOMORROW 10"
    // The PDF renderer should strip this and render the actual prose.
    const corrupted: Chapter = {
      ...chapterA,
      id: 'corrupt',
      number: 10,
      title: 'The Decree',
      content: 'Count: A1 banner2 fluttered3 from4 a5 lamppost,6 its7 parchment8 torn9 at10 the11 edges,12 the13 ink14 still15 dark16 despite17 the18 drizzle.19 "By20 decree21 of22 the23 Council24 of25 Equals,26 House27 of28 Echo29 is30 hereby31 stripped32 of33 title,34 lands,35 and36 lineage.37 All38 former39 nobles40 shall41 register42 at43 the44 Equality45 Hall."46 River47 breath48 caught.49 91 words. ECHOES OF TOMORROW 10',
    };

    it('strips the "Count:" prefix', () => {
      const doc = buildPdfDocument([corrupted], { ...baseOptions, includeTOC: false }, {
        state: baseState,
        isPolish: false,
      });
      const flat = JSON.stringify(doc);
      // The text should not contain "Count:" as a leading prefix
      expect(flat).not.toMatch(/"Count:\s*A/);
    });

    it('strips per-word digit counters', () => {
      const doc = buildPdfDocument([corrupted], { ...baseOptions, includeTOC: false }, {
        state: baseState,
        isPolish: false,
      });
      const flat = JSON.stringify(doc);
      // No leftover "banner2" or "fluttered3" etc.
      expect(flat).not.toContain('banner2');
      expect(flat).not.toContain('fluttered3');
      expect(flat).not.toContain('parchment8');
      // But the actual words should still be there
      expect(flat).toContain('banner');
      expect(flat).toContain('fluttered');
    });

    it('strips the trailing "N words." summary', () => {
      const doc = buildPdfDocument([corrupted], { ...baseOptions, includeTOC: false }, {
        state: baseState,
        isPolish: false,
      });
      const flat = JSON.stringify(doc);
      expect(flat).not.toMatch(/\b91\s*words?\b/);
    });

    it('strips the trailing book title + chapter number', () => {
      const doc = buildPdfDocument([corrupted], { ...baseOptions, includeTOC: false }, {
        state: baseState,
        isPolish: false,
      });
      const flat = JSON.stringify(doc);
      // "ECHOES OF TOMORROW 10" should not appear at the end of the body
      expect(flat).not.toMatch(/ECHOES OF TOMORROW 10/);
    });

    it('leaves normal prose untouched', () => {
      const cleanChapter: Chapter = {
        ...chapterA,
        id: 'clean',
        content: 'On page 42 of the book, he read about the Battle of 1812. The new iPhone 15 launched last year. Room 101 was empty.',
      };
      const doc = buildPdfDocument([cleanChapter], { ...baseOptions, includeTOC: false }, {
        state: baseState,
        isPolish: false,
      });
      const flat = JSON.stringify(doc);
      // The legitimate numbers stay.
      expect(flat).toContain('page 42');
      expect(flat).toContain('iPhone 15');
      expect(flat).toContain('Room 101');
      expect(flat).toContain('Battle of 1812');
    });
  });
});
