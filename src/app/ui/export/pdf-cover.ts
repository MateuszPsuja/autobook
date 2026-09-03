import { BookConfig } from '../../models/book-config.model';
import { BookCoverArt } from '../../core/providers/illustration.types';

type DocContent = any;
type TDocumentDefinitions = any;

// Match the page geometry and inner margins from pdf-renderer.ts. The
// content here sits within the page margins, not full-bleed — that's
// intentional. Earlier designs used `absolutePosition: { x: 0, y: 0 }`
// to fill the page, but pdfmake 0.2.7 has been observed to render those
// images as a black rectangle regardless of the actual base64 payload
// (chapter illustrations on the same page render correctly, so the
// issue is specific to the full-bleed + image + absolutePosition
// combination). A typographic cover with the image in the normal flow
// is the reliable path.
const PAGE_WIDTH = 432;
const PAGE_HEIGHT = 648;
const MARGIN_INNER = 72;
const MARGIN_OUTER = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_INNER - MARGIN_OUTER; // 312pt
// Available height for cover/back cover content: page height minus
// the top and bottom page margins. The renderer sets
// pageMargins[1] = MARGIN_TOP + 12 and pageMargins[3] = MARGIN_BOTTOM + 12,
// and MARGIN_TOP = MARGIN_BOTTOM = 72, so the content area is
// 648 - 84 - 84 = 480pt. Every cover/back cover layout has to fit
// inside this box on a single page; otherwise the second page
// carries the orphaned author / rule and the cover ends up spread
// across two pages.
const CONTENT_AREA_HEIGHT = 480;
// Cover and back cover images are generated at 3:4 portrait (a
// common book-cover ratio). We pass `aspectRatio: '3:4'` to the
// image model and ALSO tell pdfmake to `fit` the image into a
// fixed box. The fit is the safety net: even if the model returns
// a different ratio than 3:4 (which has been observed in
// practice), the image still renders at a sensible size inside
// the cover layout instead of overflowing the page or being
// cropped to a thin strip. The aspect ratio request is the
// preferred path; the fit is the fallback.
const COVER_FIT: [number, number] = [210, 280]; // max width × max height, pt
// Back cover image is smaller because the back cover also has a
// multi-line blurb and author bio that need vertical room.
const BACK_COVER_FIT: [number, number] = [150, 200]; // max width × max height, pt

/**
 * Build the front cover page. Pure typographic design with an
 * optional image inset. Always renders correctly regardless of
 * whether the image generation succeeded.
 *
 * Layout budget — must fit inside CONTENT_AREA_HEIGHT (480pt) on a
 * single page. Sizing is now:
 *   - top rule + genre + title (1 line) + spacer  ≈  60pt
 *   - image (`fit: [210, 280]`, 3:4 portrait)    ≈ 280pt max
 *   - image margins + "a novel" + author + rule ≈  80pt
 *   - 2-line title allowance                    ≈  36pt
 *   - safety margin                             ≈  24pt
 * The total is ~480pt, so a 2-line title still fits.
 */
export function buildCoverPage(
  art: BookCoverArt,
  ctx: { bookTitle: string; bookAuthor: string; genre: string; isPolish: boolean }
): TDocumentDefinitions['content'] {
  const { bookTitle, bookAuthor, genre } = ctx;
  const eyebrow = (genre || '').trim();
  const hasImage = !!(art.base64 && art.base64.length > 0);

  const out: DocContent[] = [];

  // Top decorative rule
  out.push({
    canvas: [{
      type: 'line',
      x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0,
      lineWidth: 0.5, lineColor: '#888',
    }],
    margin: [0, 8, 0, 0],
  });

  // Optional genre eyebrow
  if (eyebrow) {
    out.push({
      text: eyebrow.toUpperCase(),
      style: 'coverEyebrow',
      margin: [0, 10, 0, 0],
    });
  }

  // Book title — large, centered
  out.push({
    text: bookTitle.toUpperCase(),
    style: 'coverTitle',
    margin: [0, 6, 0, 0],
  });

  // Decorative dot under title
  out.push({
    text: '\u00A0',
    style: 'titleSpacer',
  });

  // Optional image (centered, 3:4 portrait). The `fit` directive
  // tells pdfmake to scale the image to fit inside the box while
  // preserving the aspect ratio — a safety net for cases where
  // the model returns an image at a different ratio than the one
  // we requested.
  if (hasImage) {
    out.push({
      image: `data:${art.mimeType};base64,${art.base64}`,
      fit: COVER_FIT,
      alignment: 'center',
      margin: [0, 16, 0, 12],
    });
  }

  // "a novel" tag
  out.push({
    text: ctx.isPolish ? 'powieść' : 'a novel',
    style: 'aNovel',
    margin: [0, 16, 0, 0],
  });

  // Author name — same page, close to the bottom rule. The previous
  // 96pt top margin pushed the author off the page; 24pt gives the
  // visual separation we need without overflow.
  out.push({
    text: bookAuthor.toUpperCase(),
    style: 'bookAuthor',
    margin: [0, 24, 0, 0],
  });

  // Bottom decorative rule to frame the cover
  out.push({
    canvas: [{
      type: 'line',
      x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0,
      lineWidth: 0.5, lineColor: '#888',
    }],
    margin: [0, 10, 0, 0],
  });

  return out;
}

/**
 * Build the back cover page. Typographic, with the blurb in the
 * upper portion and the author bio in the lower portion. An optional
 * small image can sit in the middle as a decorative emblem.
 *
 * Layout budget — must fit inside CONTENT_AREA_HEIGHT (480pt) on a
 * single page. Sizing is now:
 *   - blurb top margin + blurb text (≤ 4 lines)   ≈  90pt
 *   - decorative image (`fit: [150, 200]`, 3:4)  ≈ 200pt max
 *   - image margins + author bio + rule + byline  ≈  95pt
 *   - ISBN placeholder                            ≈  12pt
 *   - breathing room                               ≈  83pt
 * Total ≈ 480pt for the worst-case blurb / bio length.
 */
export function buildBackCoverPage(
  art: BookCoverArt,
  ctx: { blurb: string; authorBio: string; bookAuthor: string }
): TDocumentDefinitions['content'] {
  const { blurb, authorBio, bookAuthor } = ctx;
  const hasImage = !!(art.base64 && art.base64.length > 0);

  const out: DocContent[] = [];

  // The page break is on the blurb itself, not a separate empty text
  // node. The previous code had `{ text: '', pageBreak: 'before' }`
  // followed by the blurb, which pdfmake was rendering as an extra
  // blank page between the last chapter's critique and the back
  // cover. Putting the break on a real content element eliminates the
  // phantom page so the back cover is reliably the last page.
  out.push({
    text: blurb,
    style: 'coverBlurb',
    pageBreak: 'before',
    margin: [0, 32, 0, 0],
  });

  // Decorative image in the middle, 3:4 portrait. The `fit`
  // directive tells pdfmake to scale the image to fit inside the
  // box while preserving the aspect ratio — safety net for when
  // the model returns a different ratio than the one requested.
  if (hasImage) {
    out.push({
      image: `data:${art.mimeType};base64,${art.base64}`,
      fit: BACK_COVER_FIT,
      alignment: 'center',
      margin: [0, 20, 0, 20],
    });
  }

  // Author bio in the lower portion
  out.push({
    text: authorBio,
    style: 'coverAuthorBio',
    margin: [0, 16, 0, 16],
  });

  // Thin rule near the bottom
  out.push({
    canvas: [{
      type: 'line',
      x1: 40, y1: 0, x2: CONTENT_WIDTH - 40, y2: 0,
      lineWidth: 0.4, lineColor: '#888',
    }],
    margin: [0, 12, 0, 8],
  });

  // Author byline
  out.push({
    text: bookAuthor.toUpperCase(),
    style: 'bookAuthor',
    margin: [0, 0, 0, 6],
  });

  // ISBN placeholder
  out.push({
    text: 'ISBN 000-0-00-000000-0',
    style: 'coverIsbn',
  });

  return out;
}

/**
 * Derive a short back-cover blurb and a one-line author bio from the
 * book config. No LLM call — this is a deterministic summary so the
 * output is stable across re-exports. The text is hand-tuned to read
 * like back-cover copy in either Polish or English, with hard caps to
 * keep the cover page visually balanced.
 */
export function buildBackCoverBlurb(
  config: BookConfig,
  isPolish: boolean
): { blurb: string; authorBio: string } {
  const themes = (config.themes || []).slice(0, 3).filter(Boolean);
  const themePart = themes.length
    ? themes.join(isPolish ? ', ' : ', ')
    : (isPolish ? 'tajemnicą' : 'mystery');

  const protagonist = config.protagonist?.name || (isPolish ? 'Bohater' : 'A protagonist');
  const blurbRaw = isPolish
    ? `„${config.title || 'Ta książka'}" to opowieść o ${protagonist}, w której ${themePart} łączą się z niespodziewanymi zwrotami akcji. Pełna napięcia historia, która zostaje w pamięci.`
    : `"${config.title || 'This book'}" is a story about ${protagonist}, where ${themePart} collide with unexpected turns. A page-turner that stays with you.`;

  const blurb = blurbRaw.length > 280 ? blurbRaw.slice(0, 279).trimEnd() + '\u2026' : blurbRaw;

  // Author bio: every AutoBook is generated by AI, so the bio on the
  // back cover describes AutoBook rather than the protagonist's name
  // / age / background. The protagonist is a story character, not the
  // author, so we don't use `config.protagonist` here. The themes
  // (if any) are still woven in so the bio reflects what the book is
  // actually about.
  const head = isPolish ? 'O autorze' : 'About the author';
  const subject = isPolish
    ? 'AutoBook — asystent do opowiadania historii napędzany sztuczną inteligencją'
    : 'AutoBook, an AI-powered storytelling assistant';
  let authorBio: string;
  if (themes.length) {
    const verb = isPolish
      ? ' eksplorujący tematy takie jak'
      : ' exploring themes such as';
    authorBio = `${head}: ${subject}${verb} ${themePart}.`;
  } else {
    authorBio = `${head}: ${subject}.`;
  }
  if (authorBio.length > 200) {
    authorBio = authorBio.slice(0, 199).trimEnd() + '\u2026';
  }

  return { blurb, authorBio };
}
