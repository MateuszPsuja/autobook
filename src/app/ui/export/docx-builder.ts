import {
  Document,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  HeadingLevel,
  PageBreak,
  PageNumber,
  PageOrientation,
  Footer,
  Bookmark,
  InternalHyperlink,
  FileChild,
  Packer,
  convertMillimetersToTwip,
  IImageOptions,
} from 'docx';
import { sniffImageFormat, sniffImageSize } from '../../shared/utils/image-bytes';
import { ChapterIllustration } from '../../core/providers/illustration.types';
import { ExportLabels } from '../../i18n/export-labels';
import { normalizeProse } from '../../shared/utils/chapter-cleanup';
import { Chapter } from '../../models/chapter.model';
import { BookConfig } from '../../models/book-config.model';

export interface DocxBuildInput {
  chapters: Chapter[];
  config: BookConfig;
  labels: ExportLabels;
  bookAuthor: string;
  /** Export toggles. `includeTitles` controls whether chapter-title
   *  paragraphs are emitted at all (the contents list then has nothing
   *  to list); `includeTOC` controls whether the contents page is
   *  rendered. */
  options: {
    includeTitles: boolean;
    includeTOC: boolean;
  };
  /** Target export language as an ISO 639-1 code (`'en'`, `'pl'`, …).
   *  Drives the document's `w:lang` so Word proofing matches the
   *  language the book is actually written in rather than the UI
   *  locale. Defaults to `'en'`. */
  language?: string;
  /** Optional approved prologue. Rendered as its own section with a
   *  page break before, using `labels.prologueLabel`. */
  prologue?: Chapter | null;
  /** Optional approved epilogue. Rendered after the last numbered
   *  chapter, with `labels.epilogueLabel`. */
  epilogue?: Chapter | null;
  /** Optional per-chapter illustrations, keyed by chapter id. Cover
   *  and back-cover art is not part of the DOCX output. */
  illustrationCtx?: {
    chapterIllustrations?: Map<string, ChapterIllustration>;
  };
}

// === Page geometry and typography ============================================
//
// A4 (210 × 297 mm) with a 25 mm margin on all four sides. A4 was
// chosen for the multi-language export: it is the paper the target
// locales actually print on, and a section left at Word's default
// would render at whichever paper the reader's locale uses.
//
//   - Body text:      11pt, 1.2 line spacing, justified, 5 mm
//                     first-line indent on every paragraph after the
//                     first, no space between paragraphs (continuous
//                     book setting)
//   - Chapter title:  18pt, centred, page break before, carries
//                     HeadingLevel.HEADING_1 so the navigation pane and
//                     outline show every chapter
//   - Book title:     32pt, centred on the title page
//   - Byline:         12pt, centred, letter-spaced
//   - Page numbers:   12pt, centred in the footer, suppressed on the
//                     title page via `titlePage`
//
// There is deliberately no Word TOC *field* anywhere in this builder.
// The previous version shipped one with `w:dirty="true"` plus
// `features.updateFields`, and the cached entries it wrote were styled
// `TOC1` — a style `docx` never defines. Any viewer that re-resolved
// the field rebuilt the contents from the document and listed every
// paragraph in the book, so the export read as two copies of the same
// novel. The contents page below is plain paragraphs with internal
// hyperlinks, so there is nothing for a viewer to mis-collect.

const PAGE_WIDTH_MM = 210; // A4
const PAGE_HEIGHT_MM = 297;
const MARGIN_MM = 25;
const FOOTER_MM = 12;

const BODY_FONT = 'Garamond';
const FALLBACK_FONT = 'Georgia';
const BODY_SIZE_HALF_POINTS = 22; // 11pt
const BODY_LINE = 288; // 1.2 × 240
const INDENT_FIRST_LINE = convertMillimetersToTwip(5); // 283 twips
const CHAPTER_TITLE_SIZE_HALF_POINTS = 36; // 18pt
const BOOK_TITLE_SIZE_HALF_POINTS = 64; // 32pt
const BYLINE_SIZE_HALF_POINTS = 24; // 12pt

/** Scene-break ornament rendered where the author marked a break. */
const SCENE_BREAK_TEXT = '* * *';

/**
 * Map an `ExportLanguage` code onto the BCP-47 tag Word expects in
 * `<w:lang w:val="…">`. Without this the document inherits the reader's
 * UI locale and a translated book is flagged as misspelled from the
 * first word. Unknown codes fall back to `en-US`.
 */
const BCP47_BY_LANGUAGE: Record<string, string> = {
  en: 'en-US',
  pl: 'pl-PL',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-PT',
  nl: 'nl-NL',
  ru: 'ru-RU',
  uk: 'uk-UA',
  cs: 'cs-CZ',
};

function bcp47(language?: string): string {
  if (!language) return 'en-US';
  return BCP47_BY_LANGUAGE[language] ?? 'en-US';
}

// === Images ==================================================================

/**
 * Decoded + sniffed image, ready to embed via docx's `ImageRun`.
 * `data` is a Uint8Array (browser-native, no Buffer dependency). The
 * docx package also accepts Buffer / ArrayBuffer / string, but
 * Uint8Array is the cleanest path from a base64-decoded payload.
 */
interface DocxImage {
  /** "jpg" | "png" | "gif" | "bmp" — only formats the docx package supports. */
  ext: 'jpg' | 'png' | 'gif' | 'bmp';
  data: Uint8Array;
  /** Width/height in pixels, when known. Used to size the ImageRun. */
  width?: number;
  height?: number;
}

const DOCX_SUPPORTED_EXTS = new Set(['jpg', 'png', 'gif', 'bmp']);

/**
 * Decode a base64 string to bytes. The image payloads from `minimax`
 * are clean base64 (no whitespace) per the existing
 * `minimax-image.service.ts` code, so we don't need a tolerant parser.
 */
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/**
 * Build a docx-compatible image from a base64 payload. Returns `null`
 * when the actual byte format is one the docx package can't embed
 * (WebP, SVG, or anything else not in DOCX_SUPPORTED_EXTS) — the
 * caller simply renders the section without an image.
 */
function asDocxImage(ill: ChapterIllustration | undefined): DocxImage | null {
  if (!ill || !ill.base64) return null;
  const { ext, mime } = sniffImageFormat(ill.base64);
  if (mime === 'image/webp' || !DOCX_SUPPORTED_EXTS.has(ext)) {
    // docx@9 supports jpg/png/gif/bmp and SVG (with a fallback raster).
    // WebP is not in that list and SVG requires a fallback raster, so
    // both are dropped. The image model almost always returns JPEG/PNG
    // anyway, so this is a rare miss.
    console.warn(`DOCX builder: skipping image (unsupported format: ${mime})`);
    return null;
  }
  const data = base64ToBytes(ill.base64);
  // Natural dimensions drive the aspect-ratio fit below. Formats we
  // don't decode simply come back null and the image fills the box.
  const size = sniffImageSize(data, ext as 'jpg' | 'png');
  return {
    ext: ext as 'jpg' | 'png' | 'gif' | 'bmp',
    data,
    width: size?.width,
    height: size?.height,
  };
}

interface ImageSize {
  maxWidthInches: number;
  maxHeightInches: number;
}

/**
 * docx's `ImageRun.transformation` is in **pixels at 96 DPI**, not
 * inches — it multiplies by 9525 EMU per pixel to build the DrawingML
 * extent. Passing inches straight through therefore renders a 5"
 * image as 5 px ≈ 0.05" wide, which is why illustrations used to come
 * out as an invisible speck.
 */
const PIXELS_PER_INCH = 96;

/**
 * Build an `ImageRun` from a docx image, scaled to fit inside the
 * requested max box while preserving the aspect ratio. When the natural
 * dimensions could not be read from the header, the image fills the
 * whole box and Word scales it on render.
 */
function makeImageRun(image: DocxImage, size: ImageSize): ImageRun {
  const { width, height, data, ext } = image;
  let w = size.maxWidthInches;
  let h = size.maxHeightInches;
  if (width && height && width > 0 && height > 0) {
    const aspect = width / height;
    if (w / h > aspect) {
      w = h * aspect;
    } else {
      h = w / aspect;
    }
  }
  return new ImageRun({
    data,
    type: ext,
    transformation: {
      width: Math.round(w * PIXELS_PER_INCH),
      height: Math.round(h * PIXELS_PER_INCH),
    },
  } as IImageOptions);
}

// === Small utilities ========================================================

/** The serif run used for body text and contents entries. */
function serifFont() {
  return { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT };
}

/**
 * XML-safe plain-text run. The docx package handles its own escaping
 * via TextRun; we just pass the string through.
 */
function body(text: string, opts: Partial<{ bold: boolean; italic: boolean; size: number }> = {}): TextRun {
  return new TextRun({
    text,
    font: serifFont(),
    size: opts.size ?? BODY_SIZE_HALF_POINTS,
    bold: opts.bold,
    italics: opts.italic,
  });
}

// === Sections ================================================================

/**
 * One rendered unit of the book: a chapter, the prologue or the
 * epilogue, together with the heading text it is listed under and the
 * bookmark the contents list links to.
 *
 * Built once, in reading order, and then consumed by both the contents
 * page and the body. The previous builder walked `chapters` twice —
 * once to collect contents entries, once to render — so the two lists
 * were free to disagree.
 */
interface Section {
  chapter: Chapter;
  heading: string;
  /** Valid Word bookmark name: starts with a letter, no spaces. */
  bookmarkId: string;
}

/** The heading text a chapter renders under, in either language. */
function chapterHeading(chapter: Chapter, labels: ExportLabels): string {
  return `${labels.chapterLabel} ${chapter.number}: ${chapter.title || ''}`;
}

/**
 * Flatten prologue + chapters + epilogue into one deduped section list.
 *
 * A chapter list carrying the same chapter twice — a book regenerated
 * without the state being reset, or a chapter handed in twice by the
 * caller — would otherwise render its text twice with two page breaks,
 * which reads as two books in one file. Dedupe keys on `chapter.id`,
 * falling back to the chapter number for id-less fixtures.
 */
function buildSections(input: DocxBuildInput): Section[] {
  const { labels, prologue, epilogue } = input;
  const sections: Section[] = [];
  const seenChapters = new Set<string>();
  const seenBookmarks = new Set<string>();

  const add = (chapter: Chapter, heading: string, preferredId: string): void => {
    const key = chapter.id || `#${chapter.number}`;
    if (seenChapters.has(key)) return;
    seenChapters.add(key);

    // Two chapters can legitimately share a number (a regenerated
    // fixture, a hand-imported book). Bookmark names have to stay
    // unique or the contents links all point at the first match.
    let bookmarkId = preferredId;
    let suffix = 2;
    while (seenBookmarks.has(bookmarkId)) bookmarkId = `${preferredId}_${suffix++}`;
    seenBookmarks.add(bookmarkId);

    sections.push({ chapter, heading, bookmarkId });
  };

  if (prologue) add(prologue, labels.prologueLabel, 'prologue');
  for (const chapter of input.chapters ?? []) {
    add(chapter, chapterHeading(chapter, labels), `chapter_${chapter.number}`);
  }
  if (epilogue) add(epilogue, labels.epilogueLabel, 'epilogue');
  return sections;
}

/**
 * Title page: title and byline only, then a page break. No genre
 * eyebrow, no "a novel" tag, no cover image — the front matter is one
 * page that names the book.
 */
function buildTitlePage(input: DocxBuildInput): Paragraph[] {
  const { config, labels, bookAuthor } = input;
  const title = (config?.title || '').trim() || labels.untitledFallback;
  return [
    // Top spacer — pushes the title down toward the optical centre.
    new Paragraph({ spacing: { before: 2400 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 480 },
      children: [new TextRun({
        text: title,
        font: serifFont(),
        size: BOOK_TITLE_SIZE_HALF_POINTS,
        bold: false,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240 },
      children: [new TextRun({
        text: (bookAuthor || '').trim(),
        font: serifFont(),
        size: BYLINE_SIZE_HALF_POINTS,
        characterSpacing: 30,
        color: '555555',
      })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

/**
 * Contents page. Plain paragraphs, one clickable internal hyperlink per
 * section, no field and no page numbers — nothing a viewer can
 * re-resolve into something other than what is written here.
 *
 * The heading is deliberately *not* a Heading 1 paragraph: it must not
 * appear in Word's own navigation outline or it would list itself.
 * Entries carry no page numbers because those are only knowable after
 * layout; navigating is via the links and the navigation pane.
 */
function buildContents(input: DocxBuildInput, sections: Section[]): Paragraph[] {
  const out: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 480 },
      children: [new TextRun({
        text: input.labels.tocLabel,
        font: serifFont(),
        size: CHAPTER_TITLE_SIZE_HALF_POINTS,
        bold: false,
      })],
    }),
  ];
  for (const section of sections) {
    out.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 60, after: 60 },
      children: [
        new InternalHyperlink({
          anchor: section.bookmarkId,
          children: [body(section.heading)],
        }),
      ],
    }));
  }
  return out;
}

/**
 * One section. Page break, optional bookmarked heading, optional
 * illustration, then continuous body prose.
 *
 * Body text arrives from `normalizeProse`, which has already collapsed
 * the model's hard wraps into whole paragraphs. That matters: a raw
 * `\n` would reach `<w:t xml:space="preserve">` and Word would break
 * the line at the *model's* wrap column instead of the text frame's,
 * leaving a ragged, unjustified stack of 3–4 line blocks.
 */
function buildSection(
  section: Section,
  illustration: DocxImage | null,
  includeTitle: boolean,
): Paragraph[] {
  const out: Paragraph[] = [
    // The title page already emitted a break, so section 1 starts on
    // page 2 and every later section starts on its own page.
    new Paragraph({ children: [new PageBreak()] }),
  ];

  if (includeTitle) {
    // Real Heading 1 so Word's navigation pane and outline list every
    // chapter. That means Word's built-in Heading 1 style supplies an
    // accent-blue `w:color` unless the run overrides it explicitly.
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 480 },
      heading: HeadingLevel.HEADING_1,
      children: [new Bookmark({
        id: section.bookmarkId,
        children: [new TextRun({
          text: section.heading,
          font: serifFont(),
          size: CHAPTER_TITLE_SIZE_HALF_POINTS,
          bold: false,
          color: '000000',
        })],
      })],
    }));
  }

  if (illustration) {
    // Centred under the heading, no caption: the illustration service
    // builds every caption as "Chapter N · <title>", which is the
    // heading printed directly above it in a smaller font.
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 360 },
      children: [makeImageRun(illustration, { maxWidthInches: 5.0, maxHeightInches: 3.5 })],
    }));
  }

  // Continuous prose: no space after any paragraph, so the only visual
  // separation is the first-line indent. The opening paragraph of the
  // section sits flush with the margin.
  let paragraphIndex = 0;
  for (const block of normalizeProse(section.chapter.content || '')) {
    if (block.type === 'sceneBreak') {
      out.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 360, after: 360 },
        children: [body(SCENE_BREAK_TEXT)],
      }));
      continue;
    }
    out.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { line: BODY_LINE, before: 0, after: 0 },
      indent: paragraphIndex === 0 ? undefined : { firstLine: INDENT_FIRST_LINE },
      widowControl: true,
      children: [body(block.text)],
    }));
    paragraphIndex++;
  }

  return out;
}

// === Public entry point =====================================================

/**
 * Build a real DOCX file from chapters + config + (optional)
 * per-chapter illustrations. Returns a Blob with MIME
 * `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
 *
 * The output is text-first: a title page, an optional contents list,
 * the sections as continuous formatted prose, and at most one
 * illustration per section. There is no field of any kind in the
 * document body, so no viewer can re-render it into a second copy of
 * the book.
 *
 * The docx package's `Packer.toBlob` is async, so this is async too
 * (unlike `buildEpubBlob` which is sync). The export component
 * already awaits Blob-producing helpers, so this fits the existing
 * shape.
 *
 * Images: the docx package accepts JPG / PNG / GIF / BMP. WebP is
 * not supported (the package would error). The image model almost
 * always returns JPEG/PNG, but if a WebP slips through we skip it
 * with a console warning and render the section without art.
 */
export async function buildDocxBlob(input: DocxBuildInput): Promise<Blob> {
  const includeTitle = input.options?.includeTitles ?? true;
  const sections = buildSections(input);

  // Per-chapter image lookup by chapter id. Undecodable formats are
  // dropped here rather than at render time.
  const imageByChapterId = new Map<string, DocxImage>();
  for (const [chapterId, ill] of (input.illustrationCtx?.chapterIllustrations ?? new Map()).entries()) {
    const image = asDocxImage(ill);
    if (image) imageByChapterId.set(chapterId, image);
  }

  const children: FileChild[] = [...buildTitlePage(input)];
  // The contents list mirrors exactly the headings that get rendered,
  // so a book with titles switched off has nothing to list and no
  // contents page — the same rule the PDF exporter follows.
  if (includeTitle && input.options?.includeTOC && sections.length > 0) {
    children.push(...buildContents(input, sections));
  }
  for (const section of sections) {
    children.push(...buildSection(section, imageByChapterId.get(section.chapter.id) ?? null, includeTitle));
  }

  const doc = new Document({
    creator: input.bookAuthor,
    title: (input.config?.title || '').trim() || input.labels.untitledFallback,
    description: 'Generated by AutoBook',
    styles: {
      // docx emits Heading1..Heading6 as `basedOn="Normal"` but never
      // defines `Normal` itself, leaving every built-in style with a
      // dangling base. Word substitutes its own Normal; Pages and
      // LibreOffice do not, and a document with no real base paragraph
      // style mis-resolves outline levels. Defining it explicitly —
      // deliberately with no `w:outlineLvl` — anchors the chain and
      // keeps body paragraphs out of the navigation outline.
      paragraphStyles: [{ id: 'Normal', name: 'Normal' }],
      default: {
        document: {
          run: {
            font: serifFont(),
            size: BODY_SIZE_HALF_POINTS,
            // Without an explicit language Word proofing follows the
            // reader's UI locale and flags the whole book as misspelled.
            language: { value: bcp47(input.language) },
          },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: convertMillimetersToTwip(PAGE_WIDTH_MM),
            height: convertMillimetersToTwip(PAGE_HEIGHT_MM),
            orientation: PageOrientation.PORTRAIT,
          },
          margin: {
            top: convertMillimetersToTwip(MARGIN_MM),
            bottom: convertMillimetersToTwip(MARGIN_MM),
            left: convertMillimetersToTwip(MARGIN_MM),
            right: convertMillimetersToTwip(MARGIN_MM),
            footer: convertMillimetersToTwip(FOOTER_MM),
          },
        },
        // Suppresses the footer on the title page, so numbering starts
        // on the front matter instead of page 1 being the title page.
        titlePage: true,
      },
      footers: {
        // An empty *paragraph* rather than an empty footer part: the
        // title page renders identically either way, but a `<w:ftr/>`
        // with no block-level children at all makes Word complain
        // about the document.
        first: new Footer({ children: [new Paragraph({ children: [] })] }),
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
              children: [PageNumber.CURRENT],
              font: serifFont(),
              size: BYLINE_SIZE_HALF_POINTS,
            })],
          })],
        }),
      },
      children,
    }],
  });

  return await Packer.toBlob(doc);
}