import {
  Document,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  HeadingLevel,
  PageBreak,
  Packer,
  convertInchesToTwip,
  IImageOptions,
} from 'docx';
import { sniffImageFormat } from '../../shared/utils/image-bytes';
import { BookCoverArt, ChapterIllustration } from '../../core/providers/illustration.types';
import { ExportLabels } from '../../i18n/export-labels';
import { stripRunningWordCount } from '../../shared/utils/chapter-cleanup';
import { Chapter } from '../../models/chapter.model';
import { BookConfig } from '../../models/book-config.model';

export interface DocxBuildInput {
  chapters: Chapter[];
  config: BookConfig;
  labels: ExportLabels;
  bookAuthor: string;
  /** Optional. When provided, embedded in the cover, back cover, and per-chapter XHTML. */
  illustrationCtx?: {
    chapterIllustrations?: Map<string, ChapterIllustration>;
    coverArt?: BookCoverArt;
    backCoverArt?: BookCoverArt;
  };
}

// === Typography constants ====================================================
//
// Target visual hierarchy:
//   - Body text:    11pt, line-spacing 1.5, justified, 0.3" first-line indent
//   - Chapter title: 18pt, centered, page break before
//   - Book title (cover): 36pt, centered
//   - Eyebrow (cover): 10pt, letter-spaced
//   - A-novel tag (cover): 11pt italic
//   - Author byline (cover): 10pt, letter-spaced, uppercase
//   - Drop cap: 3.4× the body size on the first letter of each chapter
//
// Page geometry mirrors a standard 6×9 trade paperback:
//   - 1" margins all around
//   - US Letter underlying, but the text frame fits 6×9 with 1" margins

const BODY_FONT = 'Garamond';
const FALLBACK_FONT = 'Georgia';
const BODY_SIZE_HALF_POINTS = 22; // 11pt
const CHAPTER_TITLE_SIZE_HALF_POINTS = 36; // 18pt
const BOOK_TITLE_SIZE_HALF_POINTS = 72; // 36pt
const EYEBROW_SIZE_HALF_POINTS = 20; // 10pt
const A_NOVEL_SIZE_HALF_POINTS = 22; // 11pt
const BYLINE_SIZE_HALF_POINTS = 20; // 10pt
const DROP_CAP_SIZE_HALF_POINTS = Math.round(BODY_SIZE_HALF_POINTS * 3.4); // ~37pt

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
 * caller falls back to a typographic cover/chapter.
 */
function asDocxImage(art: BookCoverArt | ChapterIllustration | undefined): DocxImage | null {
  if (!art || !art.base64) return null;
  const { ext, mime } = sniffImageFormat(art.base64);
  if (mime === 'image/webp' || !DOCX_SUPPORTED_EXTS.has(ext)) {
    // docx@9 supports jpg/png/gif/bmp and SVG (with a fallback raster).
    // WebP is not in that list and SVG requires a fallback raster, so
    // both go to the typographic fallback. The image model almost
    // always returns JPEG/PNG anyway, so this is a rare miss.
    console.warn(`DOCX builder: skipping image (unsupported format: ${mime})`);
    return null;
  }
  return { ext: ext as 'jpg' | 'png' | 'gif' | 'bmp', data: base64ToBytes(art.base64) };
}

// === Small utilities ========================================================

/**
 * XML-safe plain-text run. The docx package handles its own escaping
 * via TextRun; we just pass the string through.
 */
function body(text: string, opts: Partial<{ bold: boolean; italic: boolean; size: number }> = {}): TextRun {
  return new TextRun({
    text,
    font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
    size: opts.size ?? BODY_SIZE_HALF_POINTS,
    bold: opts.bold,
    italics: opts.italic,
  });
}

function breakParagraph(): Paragraph {
  return new Paragraph({ children: [new TextRun({ break: 1 })] });
}

// === Section builders =======================================================

/**
 * Cover page. Title + optional image + "a novel" tag + byline.
 * Forced page break after.
 */
function buildCoverPage(input: DocxBuildInput, coverImage: DocxImage | null): Paragraph[] {
  const { config, labels, bookAuthor } = input;
  const title = (config?.title || '').trim() || labels.untitledFallback;
  const genre = (config?.genre || '').trim();
  const out: Paragraph[] = [];

  // Top spacer — pushes the eyebrow down a bit from the top margin.
  out.push(new Paragraph({ spacing: { before: 600 }, children: [] }));

  if (genre) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: genre.toUpperCase(),
        font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
        size: EYEBROW_SIZE_HALF_POINTS,
        characterSpacing: 60, // 3pt letter spacing
        color: '666666',
      })],
    }));
  }

  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 240 },
    children: [new TextRun({
      text: title,
      font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
      size: BOOK_TITLE_SIZE_HALF_POINTS,
      bold: false,
    })],
  }));

  if (coverImage) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 240 },
      children: [makeImageRun(coverImage, { maxWidthInches: 4.0, maxHeightInches: 5.0 })],
    }));
  }

  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 360 },
    children: [new TextRun({
      text: labels.aBookLabel,
      font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
      size: A_NOVEL_SIZE_HALF_POINTS,
      italics: true,
      color: '666666',
    })],
  }));

  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240 },
    children: [new TextRun({
      text: bookAuthor.toUpperCase(),
      font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
      size: BYLINE_SIZE_HALF_POINTS,
      characterSpacing: 30,
    })],
  }));

  // Page break to the first chapter.
  out.push(new Paragraph({ children: [new PageBreak()] }));
  return out;
}

/**
 * One chapter. Title at top (centered), optional figure with caption,
 * body paragraphs with first-paragraph drop-cap and first-line indent
 * on the rest.
 */
function buildChapter(
  chapter: Chapter,
  illustration: { ill: ChapterIllustration; image: DocxImage } | null,
  labels: ExportLabels,
): Paragraph[] {
  const body_text = stripRunningWordCount(chapter.content || '').trim();
  const paragraphs = body_text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const out: Paragraph[] = [];

  // Page break before each chapter (the cover page already has a
  // page break, so chapter 1 starts on page 2; chapters 2+ each get
  // their own).
  out.push(new Paragraph({ children: [new PageBreak()] }));

  // Chapter title.
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 1200, after: 600 },
    children: [new TextRun({
      text: `${labels.chapterLabel} ${chapter.number}: ${chapter.title || ''}`,
      font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
      size: CHAPTER_TITLE_SIZE_HALF_POINTS,
      bold: false,
    })],
    heading: HeadingLevel.HEADING_1,
  }));

  // Optional illustration as a figure with italic caption.
  if (illustration) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 120 },
      children: [makeImageRun(illustration.image, { maxWidthInches: 4.0, maxHeightInches: 3.5 })],
    }));
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [new TextRun({
        text: illustration.ill.caption || '',
        font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
        size: BODY_SIZE_HALF_POINTS - 4, // 9pt
        italics: true,
        color: '666666',
      })],
    }));
  }

  // Body paragraphs. First paragraph gets the drop cap; subsequent
  // paragraphs get the standard first-line indent.
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (i === 0) {
      out.push(buildDropCapParagraph(p));
    } else {
      out.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { line: 360, before: 0, after: 120 }, // 1.5 line spacing
        indent: { firstLine: convertInchesToTwip(0.3) },
        children: [body(p)],
      }));
    }
  }

  return out;
}

/**
 * First paragraph of a chapter: drops the first letter into a large
 * run flush with the left margin, then continues with the rest of the
 * paragraph at body size, justified, with no first-line indent (the
 * drop cap is the visual break).
 *
 * docx@9's built-in `dropCap` is buried in FramePr (frame
 * properties) and not easy to apply per-paragraph here, so this
 * approximation is what ships. It renders consistently across Word,
 * LibreOffice, and Google Docs.
 */
function buildDropCapParagraph(text: string): Paragraph {
  // Strip the first character; preserve the rest exactly.
  const trimmed = text.trim();
  if (!trimmed) {
    return new Paragraph({ children: [body('')] });
  }
  const first = trimmed.charAt(0);
  const rest = trimmed.slice(1);

  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 360, before: 0, after: 120 },
    children: [
      new TextRun({
        text: first,
        font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
        size: DROP_CAP_SIZE_HALF_POINTS,
        bold: false,
      }),
      body(rest),
    ],
  });
}

/**
 * Back cover page. Page break first, then blurb, optional small
 * image, author bio, ISBN placeholder. The blurb and author bio are
 * derived from the book config + the localised labels.
 */
function buildBackCover(input: DocxBuildInput, backImage: DocxImage | null): Paragraph[] {
  const { config, labels, bookAuthor } = input;
  const themes = (config?.themes || []).slice(0, 3).filter(Boolean);
  const themePart = themes.length ? themes.join(labels.themeSeparator) : labels.backCoverUnknownTheme;
  const protagonist = config?.protagonist?.name || labels.backCoverUnknownProtagonist;
  const title = (config?.title || '').trim() || labels.backCoverUnknownTitle;
  const blurbRaw = labels.backCoverBlurbTemplate
    .replace('{title}', title)
    .replace('{protagonist}', protagonist)
    .replace('{themePart}', themePart);
  const blurb = blurbRaw.length > 320 ? blurbRaw.slice(0, 319).trimEnd() + '\u2026' : blurbRaw;
  const authorBio = themes.length
    ? `${labels.backCoverHead}: ${labels.backCoverSubject}${labels.backCoverVerb} ${themePart}.`
    : `${labels.backCoverHead}: ${labels.backCoverSubject}.`;
  const trimmedBio = authorBio.length > 240 ? authorBio.slice(0, 239).trimEnd() + '\u2026' : authorBio;

  const out: Paragraph[] = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { line: 320, before: 0, after: 360 },
      children: [new TextRun({
        text: blurb,
        font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
        size: BODY_SIZE_HALF_POINTS,
      })],
    }),
  ];

  if (backImage) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 240 },
      children: [makeImageRun(backImage, { maxWidthInches: 2.5, maxHeightInches: 3.0 })],
    }));
  }

  out.push(new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 320, before: 240, after: 240 },
    children: [new TextRun({
      text: trimmedBio,
      font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
      size: BODY_SIZE_HALF_POINTS - 2, // 10pt
      color: '444444',
    })],
  }));

  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 480 },
    children: [new TextRun({
      text: bookAuthor.toUpperCase(),
      font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
      size: BYLINE_SIZE_HALF_POINTS,
      characterSpacing: 30,
    })],
  }));

  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240 },
    children: [new TextRun({
      text: labels.isbnPlaceholder,
      font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
      size: BYLINE_SIZE_HALF_POINTS - 4, // 8pt
      color: '777777',
    })],
  }));

  return out;
}

// === Image sizing ===========================================================

interface ImageSize {
  maxWidthInches: number;
  maxHeightInches: number;
}

/**
 * Build an `ImageRun` from a docx image, sized to fit inside the
 * requested max box while preserving the aspect ratio. Without
 * dimensions on the input (we don't decode the image header), the
 * safe fallback is the max box — Word handles the render.
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
    transformation: { width: w, height: h },
  } as IImageOptions);
}

// === Public entry point =====================================================

/**
 * Build a real DOCX file from chapters + config + (optional)
 * illustration context. Returns a Blob with MIME
 * `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
 *
 * The docx package's `Packer.toBlob` is async, so this is async too
 * (unlike `buildEpubBlob` which is sync). The export component
 * already awaits Blob-producing helpers, so this fits the existing
 * shape.
 *
 * When no `illustrationCtx` is provided (or the illustration service
 * produced no images), the cover and back cover still render as
 * typographic pages.
 *
 * Images: the docx package accepts JPG / PNG / GIF / BMP. WebP is
 * not supported (the package would error). The image model almost
 * always returns JPEG/PNG, but if a WebP slips through we skip it
 * with a console warning and fall back to the typographic variant.
 */
export async function buildDocxBlob(input: DocxBuildInput): Promise<Blob> {
  const ctx = input.illustrationCtx;
  const coverImage = asDocxImage(ctx?.coverArt);
  const backImage = asDocxImage(ctx?.backCoverArt);

  // Per-chapter image lookup by chapter id.
  const chapterImageByChapterId = new Map<string, { ill: ChapterIllustration; image: DocxImage }>();
  if (ctx?.chapterIllustrations) {
    for (const [chapterId, ill] of ctx.chapterIllustrations.entries()) {
      const image = asDocxImage(ill);
      if (image) chapterImageByChapterId.set(chapterId, { ill, image });
    }
  }

  const children: Paragraph[] = [];
  children.push(...buildCoverPage(input, coverImage));
  for (const ch of input.chapters) {
    const ill = chapterImageByChapterId.get(ch.id);
    children.push(...buildChapter(ch, ill || null, input.labels));
  }
  children.push(...buildBackCover(input, backImage));

  const doc = new Document({
    creator: input.bookAuthor,
    title: (input.config?.title || '').trim() || input.labels.untitledFallback,
    description: 'Generated by AutoBook',
    styles: {
      default: {
        document: {
          run: {
            font: { name: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT, hAnsi: BODY_FONT, ascii: BODY_FONT },
            size: BODY_SIZE_HALF_POINTS,
          },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1.25),
            right: convertInchesToTwip(1.25),
          },
        },
      },
      children,
    }],
  });

  return await Packer.toBlob(doc);
}
