import { Chapter } from '../../models/chapter.model';
import { BookStateService } from '../../book/state/book-state.service';
import { stripRunningWordCount } from '../../shared/utils/chapter-cleanup';

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
  includeCritiques: boolean;
  includeCharacters: boolean;
}

export interface PdfExportContext {
  state: ReturnType<BookStateService['getState']>;
  isPolish: boolean;
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
      columns: [
        {
          text: [
            {
              text: `${chapterLabel} ${chapter.number}`,
              style: 'tocEyebrow',
            },
            {
              text: '   ',
              style: 'tocEyebrow',
            },
            {
              text: chapter.title,
              style: 'tocTitle2',
            },
          ],
        },
        { text: '', width: '*' },
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
  isPolish: boolean;
  options: PdfExportOptions;
  labels: {
    chapterLabel: string;
    critiqueLabel: string;
    overallScoreLabel: string;
    feedbackLabel: string;
  };
}): DocContent[] {
  const { chapter, index, total, isPolish, options, labels } = args;
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
      text: '\u2733  \u2733  \u2733',  // ✳ asterism
      style: 'chapterOrnament',
    });
  } else {
    // includeTitles is off — anchor the id on a marker line at the start
    // of the chapter so the TOC still resolves.
    out.push({
      text: `Chapter ${chapter.number}`,
      style: 'bodyNoIndent',
      id: `ch-${chapter.id}`,
      margin: [0, 0, 0, 0],
    });
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

  // Critique block, if requested.
  if (options.includeCritiques && chapter.critique) {
    out.push({
      text: '',
      pageBreak: 'before',
    });
    out.push({
      text: labels.critiqueLabel.toUpperCase(),
      style: 'critiqueHeading',
    });
    out.push({
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          x2: 60,
          y2: 0,
          lineWidth: 0.6,
          lineColor: '#666',
        },
      ],
      margin: [0, 0, 0, 8],
    });
    out.push({
      text: [
        {
          text: `${labels.overallScoreLabel}:  `,
          style: 'critiqueLabel',
        },
        {
          text: `${chapter.critique.overallScore} / 10`,
          style: 'critiqueValue',
        },
      ],
      margin: [0, 0, 0, 4],
    });
    if (chapter.critique.feedback) {
      out.push({
        text: [
          { text: `${labels.feedbackLabel}:  `, style: 'critiqueLabel' },
          { text: chapter.critique.feedback, style: 'critiqueBody' },
        ],
      });
    }
  }

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
  const isPolish = context.isPolish;
  const config = context.state.config;
  const bookTitle = (config?.title || '').trim() ||
    (isPolish ? 'Bez tytułu' : 'Untitled');
  const bookAuthor = (config?.protagonist?.name || '').trim() ||
    'AutoBook';
  const bookSubtitle = (config?.themes && config.themes.length)
    ? config.themes.slice(0, 3).join('  \u00B7  ')
    : null;
  const genre = (config?.genre || '').trim();

  // Labels
  const tocLabel = isPolish ? 'Spis Treści' : 'Table of Contents';
  const chapterLabel = isPolish ? 'Rozdział' : 'Chapter';
  const critiqueLabel = isPolish ? 'Raport krytyka' : 'Critique Report';
  const overallScoreLabel = isPolish ? 'Ocena ogólna' : 'Overall score';
  const feedbackLabel = isPolish ? 'Uwagi' : 'Feedback';
  const aBookLabel = isPolish ? 'powieść' : 'a novel';

  // ---- Content list -------------------------------------------------------
  const content: DocContent[] = [];
  content.push(
    ...buildTitlePage({
      bookTitle,
      bookSubtitle,
      bookAuthor,
      genre,
      aBookLabel,
    }),
  );

  if (options.includeTOC) {
    content.push(
      ...buildToc({ chapters, tocLabel, chapterLabel }),
    );
  }

  chapters.forEach((chapter, index) => {
    content.push(
      ...buildChapter({
        chapter,
        index,
        total: chapters.length,
        isPolish,
        options,
        labels: { chapterLabel, critiqueLabel, overallScoreLabel, feedbackLabel },
      }),
    );
  });

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
      fontSize: 10,
      alignment: 'center',
      characterSpacing: 6,
      color: '#666',
      margin: [0, 110, 0, 8],
    },
    chapterTitle: {
      font: DISPLAY_FONT,
      fontSize: 22,
      bold: true,
      alignment: 'center',
      margin: [0, 0, 0, 8],
    },
    chapterOrnament: {
      font: BODY_FONT,
      fontSize: 12,
      alignment: 'center',
      characterSpacing: 4,
      color: '#888',
      margin: [0, 4, 0, 28],
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
    critiqueHeading: {
      font: BODY_FONT,
      fontSize: 10,
      characterSpacing: 4,
      color: '#555',
      margin: [0, 0, 0, 4],
    },
    critiqueLabel: {
      font: BODY_FONT,
      fontSize: 10,
      characterSpacing: 2,
      color: '#555',
    },
    critiqueValue: {
      font: BODY_FONT,
      fontSize: 11,
      bold: true,
    },
    critiqueBody: {
      font: BODY_FONT,
      fontSize: 10,
      italics: true,
      color: '#444',
      lineHeight: 1.35,
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
  };

  // ---- Header / footer ----------------------------------------------------
  const header = (currentPage: number, _pageCount: number): DocContent | null => {
    if (currentPage <= 2) return null; // title + author page: no header
    // Alternate verso/recto: even (verso, left page) on right; odd on left.
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
    if (currentPage <= 2) return null;
    return {
      text: String(currentPage - 2),  // skip title + author pages in count
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
    defaultStyle: {
      font: BODY_FONT,
      fontSize: BODY_SIZE,
      lineHeight: BODY_LEADING,
    },
  };
}
