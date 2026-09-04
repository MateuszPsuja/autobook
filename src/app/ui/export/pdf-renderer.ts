import { Chapter } from '../../models/chapter.model';
import { BookStateService } from '../../book/state/book-state.service';
import { stripRunningWordCount } from '../../shared/utils/chapter-cleanup';
import { ChapterIllustration, BookCoverArt, IllustrationStyle } from '../../core/providers/illustration.types';
import { buildCoverPage, buildBackCoverPage, buildBackCoverBlurb } from './pdf-cover';
import { ExportLanguage, getExportLabels, ExportLabels } from '../../i18n/export-labels';

/**
 * Build a properly composed book PDF document definition.
 *
 * Design notes:
 * - Page size: 6" × 9" (US trade paperback). 432 × 648 pt.
 * - Fonts: pdfmake's default VFS includes Roboto in 4 variants
 *   (Regular, Italic, Medium, MediumItalic). We use them all for a
 *   proper typographic hierarchy without bundling extra TTF files.
 * - Margins: top/bottom 72pt, inner 72pt, outer 48pt. Mirror layout is
 *   not natively supported by pdfmake so we approximate via header
 *   alignment (verso/recto).
 * - First line: title page has no header/footer and starts the body
 *   on the second page.
 */

// ---- Page geometry --------------------------------------------------------
const PAGE_WIDTH = 432;    // 6"
const PAGE_HEIGHT = 648;   // 9"
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 72;
const MARGIN_INNER = 72;
const MARGIN_OUTER = 48;

// ---- Typography -----------------------------------------------------------
const BODY_FONT = 'Roboto';
const DISPLAY_FONT = 'Roboto';
const BODY_SIZE = 11;
const BODY_LEADING = 1.4;

// ---- Public types ---------------------------------------------------------
export interface PdfExportOptions {
  includeTitles: boolean;
  includeTOC: boolean;
  includeCharacters: boolean;
  includeIllustrations: boolean;
  illustrationStyle: IllustrationStyle;
}

export interface PdfExportContext {
  state: ReturnType<BookStateService['getState']>;
  /**
   * Target language for the export. Drives the localised labels
   * (TOC, "Chapter", …) and the author byline. The chapter bodies
   * themselves are translated upstream by the export component, so
   * by the time the renderer sees them they are already in
   * `language`.
   */
  language: ExportLanguage;
  chapterIllustrations?: Map<string, ChapterIllustration>;
  coverArt?: BookCoverArt;
  backCoverArt?: BookCoverArt;
}

type DocContent = any;
type TDocumentDefinitions = any;

// ---- Markdown / scene-break cleanup --------------------------------------
function cleanText(text: string): string {
  if (!text) return '';
  let result = text;
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  result = result.replace(/<[^>]+>/g, '');
  return result.trim();
}

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'sceneBreak' };

/** A line that consists of only ornaments is treated as a scene break. */
function isSceneBreak(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (t.length > 12) return false;
  return /^[\*\-_~·•◦※\*\s]+$/.test(t) || /^[—–-]{1,4}$/.test(t);
}

function parseContent(content: string): Block[] {
  const cleaned = stripRunningWordCount(cleanText(content));
  // First collapse 3+ blank lines into a single break, then split on
  // either 2+ newlines or single \r\n.
  const normalized = cleaned
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  const raw = normalized.split(/\n\n+/);
  const blocks: Block[] = [];
  for (const part of raw) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // A single line of only ornament characters becomes a scene break.
    if (!trimmed.includes('\n') && isSceneBreak(trimmed)) {
      blocks.push({ type: 'sceneBreak' });
      continue;
    }
    // Multiple short lines that are all scene-break marks collapse to one.
    const lines = trimmed.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 0 && lines.every(isSceneBreak)) {
      blocks.push({ type: 'sceneBreak' });
      continue;
    }
    blocks.push({ type: 'paragraph', text: trimmed.replace(/\n+/g, ' ') });
  }
  return blocks;
}

// ---- Title page -----------------------------------------------------------
function buildTitlePage(args: {
  bookTitle: string;
  bookSubtitle: string | null;
  bookAuthor: string;
  genre: string;
  aBookLabel: string;
}): DocContent[] {
  const { bookTitle, bookSubtitle, bookAuthor, genre, aBookLabel } = args;
  return [
    // Top decorative rule
    {
      canvas: [
        {
          type: 'line',
          x1: MARGIN_INNER,
          y1: 0,
          x2: PAGE_WIDTH - MARGIN_OUTER,
          y2: 0,
          lineWidth: 0.5,
          lineColor: '#888',
        },
      ],
      margin: [0, 200, 0, 0],
    },
    // Optional genre label, small caps
    ...(genre
      ? [
          {
            text: genre.toUpperCase(),
            style: 'eyebrow',
            margin: [0, 6, 0, 0],
          } as DocContent,
        ]
      : []),
    // Title
    {
      text: bookTitle.toUpperCase(),
      style: 'bookTitle',
    },
    // Decorative dot
    {
      text: '\u00A0',
      style: 'titleSpacer',
    },
    // Subtitle (themes)
    ...(bookSubtitle
      ? [
          {
            text: bookSubtitle,
            style: 'bookSubtitle',
          } as DocContent,
        ]
      : []),
    // Tag: "a novel"
    {
      text: aBookLabel,
      style: 'aNovel',
    },
    // Push author to bottom
    { text: '', pageBreak: 'after' },

    // Author / colophon (separate page, can stay clean)
    {
      text: '',
      margin: [0, 240, 0, 0],
    },
    {
      canvas: [
        {
          type: 'line',
          x1: 80,
          y1: 0,
          x2: PAGE_WIDTH - 80,
          y2: 0,
          lineWidth: 0.4,
          lineColor: '#888',
        },
      ],
      margin: [0, 0, 0, 16],
    },
    {
      text: bookAuthor.toUpperCase(),
      style: 'bookAuthor',
    },
    {
      text: '',
      pageBreak: 'after',
    },
  ];
}

// ---- TOC ------------------------------------------------------------------
function buildToc(args: {
  chapters: Chapter[];
  tocLabel: string;
  chapterLabel: string;
}): DocContent[] {
  const { chapters, tocLabel, chapterLabel } = args;
  const out: DocContent[] = [
    { text: tocLabel.toUpperCase(), style: 'tocTitle' },
    { text: '', margin: [0, 0, 0, 8] },
    {
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          x2: PAGE_WIDTH - MARGIN_INNER - MARGIN_OUTER,
          y2: 0,
          lineWidth: 0.4,
          lineColor: '#999',
        },
      ],
      margin: [0, 0, 0, 16],
    },
  ];

  for (const chapter of chapters) {
    out.push({
      // 3-column layout: eyebrow (auto) | title (`*` — takes the
      // remaining width) | page number (auto). Previously the
      // eyebrow and title were bundled into a single `text: [...]`
      // array inside one column, so the column sized to the
      // eyebrow's width and the title had to wrap inside that
      // narrow column. Polish chapter titles (longer words, more
      // diacritics, often 3-4× the character count of their
      // English equivalents) break onto two lines as a result.
      // Splitting into explicit columns gives the title the full
      // available width, and a long title can still wrap to a
      // second line without dragging the page number down with it.
      columns: [
        {
          text: `${chapterLabel} ${chapter.number}`,
          style: 'tocEyebrow',
          width: 'auto',
        },
        {
          text: chapter.title,
          style: 'tocTitle2',
          width: '*',
        },
        {
          text: '',
          pageReference: `ch-${chapter.id}`,
          style: 'tocNumber',
          width: 'auto',
        },
      ],
      columnGap: 6,
      margin: [0, 6, 0, 6],
    });
  }

  out.push({ text: '', pageBreak: 'after' });
  return out;
}

// ---- Chapter --------------------------------------------------------------
function buildChapter(args: {
  chapter: Chapter;
  index: number;
  total: number;
  options: PdfExportOptions;
  labels: {
    chapterLabel: string;
  };
  chapterIllustrations?: Map<string, ChapterIllustration>;
}): DocContent[] {
  const { chapter, index, total, options, labels } = args;
  const blocks = parseContent(chapter.content);
  const out: DocContent[] = [];

  // Page break before each chapter.
  out.push({
    text: '',
    pageBreak: 'before',
  });

  // Chapter eyebrow: "CHAPTER  I" etc. The first real text node carries
  // the `id` so the TOC's `pageReference` can resolve. (pdfmake ignores
  // `id` on an empty text node because no line is built for it.)
  if (options.includeTitles) {
    const numRoman = toRoman(chapter.number);
    out.push({
      text: `${labels.chapterLabel.toUpperCase()}  ${numRoman}`,
      style: 'chapterEyebrow',
      id: `ch-${chapter.id}`,
    });

    out.push({
      text: chapter.title,
      style: 'chapterTitle',
    });

    out.push({
      text: '\u00B7  \u00B7  \u00B7',  // · middle-dot ornament
      style: 'chapterOrnament',
    });
  } else {
    // includeTitles is off — anchor the id on a marker line at the start
    // of the chapter so the TOC still resolves. The marker uses the
    // localised "Chapter" word so the anchor text matches the
    // language of the rest of the export.
    out.push({
      text: `${labels.chapterLabel} ${chapter.number}`,
      style: 'bodyNoIndent',
      id: `ch-${chapter.id}`,
      margin: [0, 0, 0, 0],
    });
  }

  // Chapter illustration (if present). Larger and more prominent than
  // the previous design — closer to full content width so it acts as
  // a real visual plate at the top of the chapter rather than a
  // small inline image. Caption sits underneath in italic gray.
  //
  // When an illustration is present, the chapter "plate" (eyebrow,
  // title, ornament, image, caption) is given its own page via
  // `pageBreak: 'after'` on the caption. The body text starts on a
  // fresh page, so the title and illustration are never split off
  // from each other by an awkward page break mid-plate. Chapters
  // without an illustration behave as before — title and body share
  // the first page.
  const illustration = args.chapterIllustrations?.get(chapter.id);
  if (illustration) {
    out.push({
      image: `data:${illustration.mimeType};base64,${illustration.base64}`,
      width: 360,
      alignment: 'center',
      margin: [0, 18, 0, 6],
    });
    if (illustration.caption) {
      out.push({
        text: illustration.caption,
        style: 'illustrationCaption',
        pageBreak: 'after',
      });
    } else {
      // No caption — push the body to a new page anyway so the
      // illustration stays on its own plate page.
      out.push({ text: '', pageBreak: 'after' });
    }
  }

  // Body — first paragraph with drop cap, rest with first-line indent.
  blocks.forEach((block, i) => {
    if (block.type === 'sceneBreak') {
      out.push({
        text: '\u2022   \u2022   \u2022',  // bullet ornaments
        style: 'sceneBreak',
      });
      return;
    }
    const isFirst = i === 0;
    if (isFirst && options.includeTitles) {
      out.push(buildDropCapParagraph(block.text));
    } else {
      out.push({
        text: block.text,
        style: 'bodyParagraph',
      });
    }
  });

  return out;
}

function buildDropCapParagraph(text: string): DocContent {
  // Find the first letter/whitespace. If the text starts with a quote,
  // skip past it to find the actual cap.
  const match = text.match(/^(\s*(?:["'\u201C\u2018]?))(\S)(.*)$/s);
  if (!match) {
    return { text, style: 'bodyParagraph' };
  }
  const [, leading, firstChar, rest] = match;
  // The drop cap column is roughly 2.5 character widths of body text wide.
  return {
    columns: [
      {
        width: 36,
        text: firstChar.toUpperCase(),
        fontSize: 44,
        bold: false,
        font: DISPLAY_FONT,
        lineHeight: 0.9,
        margin: [0, 4, 0, 0],
        alignment: 'left',
      },
      {
        text: leading + rest,
        style: 'bodyNoIndent',
        alignment: 'justify',
      },
    ],
    columnGap: 6,
    margin: [0, 0, 0, 0],
  };
}

function toRoman(n: number): string {
  const numerals: Array<[number, string]> = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  if (n <= 0) return String(n);
  let result = '';
  let remaining = n;
  for (const [value, symbol] of numerals) {
    while (remaining >= value) {
      result += symbol;
      remaining -= value;
    }
  }
  return result;
}

// ---- Public entrypoint ----------------------------------------------------
export function buildPdfDocument(
  chapters: Chapter[],
  options: PdfExportOptions,
  context: PdfExportContext,
): TDocumentDefinitions {
  const labels = getExportLabels(context.language);
  const config = context.state.config;
  const bookTitle = (config?.title || '').trim() || labels.untitledFallback;
  // The on-page byline (cover, back cover, title page) is the same
  // string used for the PDF `info.author` metadata — every book
  // shipped from AutoBook is an AI-generated work, so the visible
  // byline and the file metadata stay in sync. The protagonist name
  // is the story's main character, not the author, and is no longer
  // used as the byline.
  const bookAuthor = labels.bookAuthor;
  const bookSubtitle = (config?.themes && config.themes.length)
    ? config.themes.slice(0, 3).join('  \u00B7  ')
    : null;
  const genre = (config?.genre || '').trim();

  // ---- Content list -------------------------------------------------------
  const content: DocContent[] = [];

  // Front cover (when illustrations are enabled) — typographic layout
  // with an optional inset image. Replaces the old full-bleed design,
  // which pdfmake 0.2.7 was rendering as a solid black rectangle
  // regardless of the actual base64 payload. The image is in the
  // normal flow now, so it always renders correctly when the API
  // returns one.
  if (context.coverArt) {
    content.push(
      ...buildCoverPage(context.coverArt, { bookTitle, bookAuthor, genre, labels }),
    );
  } else {
    // No cover image — fall back to the original title page (which is
    // already a typographic layout that doesn't need an image).
    content.push(
      ...buildTitlePage({
        bookTitle,
        bookSubtitle,
        bookAuthor,
        genre,
        aBookLabel: labels.aBookLabel,
      }),
    );
  }

  if (options.includeTOC) {
    content.push(
      ...buildToc({ chapters, tocLabel: labels.tocLabel, chapterLabel: labels.chapterLabel }),
    );
  }

  chapters.forEach((chapter, index) => {
    content.push(
      ...buildChapter({
        chapter,
        index,
        total: chapters.length,
        options,
        labels: {
          chapterLabel: labels.chapterLabel,
        },
        chapterIllustrations: context.chapterIllustrations,
      }),
    );
  });

  // Back cover (when illustrations are enabled) — typographic layout
  // with an optional small decorative image. The page break is on the
  // first element of `buildBackCoverPage`'s output, which is the
  // reliable pattern with pdfmake 0.2.7.
  if (context.backCoverArt) {
    const { blurb, authorBio } = buildBackCoverBlurb(config ?? {} as any, context.language, labels);
    content.push(
      ...buildBackCoverPage(context.backCoverArt, {
        blurb,
        authorBio,
        bookAuthor,
        isbnPlaceholder: labels.isbnPlaceholder
      }),
    );
  }

  // ---- Styles -------------------------------------------------------------
  const styles = {
    bookTitle: {
      font: DISPLAY_FONT,
      fontSize: 30,
      bold: true,
      alignment: 'center',
      characterSpacing: 2,
      margin: [0, 28, 0, 0],
    },
    titleSpacer: {
      font: BODY_FONT,
      fontSize: 4,
      margin: [0, 0, 0, 0],
    },
    bookSubtitle: {
      font: BODY_FONT,
      fontSize: 13,
      italics: true,
      alignment: 'center',
      color: '#555',
      margin: [0, 14, 0, 0],
    },
    aNovel: {
      font: BODY_FONT,
      fontSize: 11,
      italics: true,
      alignment: 'center',
      color: '#777',
      characterSpacing: 1,
      margin: [0, 28, 0, 0],
    },
    bookAuthor: {
      font: BODY_FONT,
      fontSize: 12,
      bold: true,
      alignment: 'center',
      characterSpacing: 3,
      margin: [0, 0, 0, 0],
    },
    eyebrow: {
      font: BODY_FONT,
      fontSize: 9,
      alignment: 'center',
      characterSpacing: 4,
      color: '#777',
      margin: [0, 6, 0, 0],
    },
    chapterEyebrow: {
      font: BODY_FONT,
      fontSize: 11,
      alignment: 'center',
      characterSpacing: 8,
      color: '#666',
      margin: [0, 56, 0, 10],
    },
    chapterTitle: {
      font: DISPLAY_FONT,
      fontSize: 30,
      bold: true,
      alignment: 'center',
      margin: [0, 0, 0, 6],
    },
    chapterOrnament: {
      font: BODY_FONT,
      fontSize: 12,
      alignment: 'center',
      characterSpacing: 6,
      color: '#888',
      margin: [0, 2, 0, 22],
    },
    sceneBreak: {
      font: BODY_FONT,
      fontSize: 14,
      alignment: 'center',
      characterSpacing: 6,
      color: '#999',
      margin: [0, 18, 0, 18],
    },
    bodyNoIndent: {
      font: BODY_FONT,
      fontSize: BODY_SIZE,
      lineHeight: BODY_LEADING,
    },
    bodyParagraph: {
      font: BODY_FONT,
      fontSize: BODY_SIZE,
      lineHeight: BODY_LEADING,
      alignment: 'justify',
      firstLineIndent: 18,
    },
    tocTitle: {
      font: DISPLAY_FONT,
      fontSize: 16,
      bold: true,
      alignment: 'center',
      characterSpacing: 4,
      margin: [0, 60, 0, 0],
    },
    tocTitle2: {
      font: BODY_FONT,
      fontSize: 11,
      italics: true,
    },
    tocEyebrow: {
      font: BODY_FONT,
      fontSize: 10,
      characterSpacing: 2,
      color: '#666',
    },
    tocNumber: {
      font: BODY_FONT,
      fontSize: 11,
      alignment: 'right',
    },
    headerText: {
      font: BODY_FONT,
      fontSize: 8,
      color: '#777',
      characterSpacing: 2,
    },
    pageNumber: {
      font: BODY_FONT,
      fontSize: 9,
      color: '#333',
      alignment: 'center',
    },
    illustrationCaption: {
      font: BODY_FONT,
      fontSize: 9,
      italics: true,
      alignment: 'center',
      color: '#666',
      margin: [0, 0, 0, 18],
    },
    coverEyebrow: {
      font: BODY_FONT,
      fontSize: 10,
      characterSpacing: 5,
      color: '#666',
      alignment: 'center',
    },
    coverTitle: {
      font: DISPLAY_FONT,
      // 30pt (down from 32) so a 2-line title still fits inside the
      // 480pt cover-page content area alongside the image, "a novel"
      // tag, author byline, and the top/bottom rules. See
      // buildCoverPage's CONTENT_AREA_HEIGHT budget.
      fontSize: 30,
      bold: true,
      characterSpacing: 3,
      color: '#111',
      alignment: 'center',
      lineHeight: 1.15,
    },
    coverAuthor: {
      font: BODY_FONT,
      fontSize: 11,
      characterSpacing: 3,
      color: '#333',
      alignment: 'center',
    },
    coverBlurb: {
      font: BODY_FONT,
      fontSize: 11,
      color: '#222',
      lineHeight: 1.5,
      alignment: 'center',
      italics: true,
    },
    coverAuthorBio: {
      font: BODY_FONT,
      fontSize: 10,
      color: '#444',
      lineHeight: 1.4,
      alignment: 'center',
    },
    coverIsbn: {
      font: BODY_FONT,
      fontSize: 8,
      color: '#888',
      alignment: 'center',
      characterSpacing: 2,
    },
  };

  // ---- Header / footer ----------------------------------------------------
  // With cover art: the front cover is a single page, so only page 1
  // gets the "no header/footer" treatment; the running header and page
  // number start on page 2.
  // Without cover art: the renderer falls back to buildTitlePage,
  // which produces TWO front-matter pages — the title page and the
  // author colophon. Both are still front matter, so neither gets a
  // running header; the body / chapters / back cover start on page 3.
  // The skip count is captured in a closure so the header and footer
  // functions agree.
  const skipHeaderPages = context.coverArt ? 1 : 2;

  const header = (currentPage: number, _pageCount: number): DocContent | null => {
    if (currentPage <= skipHeaderPages) return null; // front matter
    const isVerso = currentPage % 2 === 0;
    return {
      columns: [
        {
          text: bookTitle.toUpperCase(),
          style: 'headerText',
          alignment: isVerso ? 'right' : 'left',
        },
      ],
      margin: [MARGIN_INNER, 18, MARGIN_OUTER, 0],
    };
  };

  const footer = (currentPage: number, _pageCount: number): DocContent | null => {
    if (currentPage <= skipHeaderPages) return null;
    return {
      // Body pages are numbered 1, 2, 3, ... starting after the
      // front matter. Subtract `skipHeaderPages` so the first body
      // page always shows "1" regardless of whether the cover is
      // 1 or 2 pages.
      text: String(currentPage - skipHeaderPages),
      style: 'pageNumber',
      margin: [MARGIN_INNER, 0, MARGIN_OUTER, 24],
    };
  };

  return {
    pageSize: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    pageMargins: [MARGIN_INNER, MARGIN_TOP + 12, MARGIN_OUTER, MARGIN_BOTTOM + 12],
    content,
    styles,
    header,
    footer,
    // PDF metadata. pdfmake passes this to the underlying PDF
    // document (see printer.js: `if (docDefinition.info) ...`), so
    // the author / title show up in the file's "Properties" dialog
    // and in downstream tools (Calibre, Adobe Reader, etc.). The
    // author is hard-coded to "Written by artificial intelligence"
    // because every book shipped from AutoBook is an AI-generated
    // work. The visible on-page byline (cover, back cover, title
    // page) uses the same string so the file metadata and the
    // rendered content stay in sync.
    info: {
      title: bookTitle,
      author: 'Written by artificial intelligence',
      creator: 'AutoBook',
    },
    defaultStyle: {
      font: BODY_FONT,
      fontSize: BODY_SIZE,
      lineHeight: BODY_LEADING,
    },
  };
}
