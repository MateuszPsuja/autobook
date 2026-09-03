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
// Cover image is generated at 2:3 (portrait, like a real book cover).
// At 60% of the page height that's a 390pt-tall image — width is
// 390 * 2/3 = 260pt, which sits comfortably in the 312pt content
// width with breathing room on both sides.
const COVER_IMAGE_HEIGHT = Math.round(PAGE_HEIGHT * 0.60); // 389pt ≈ 390
// Back cover image is the same portrait 2:3 shape, sized to 35% of
// the page height.
const BACK_COVER_IMAGE_HEIGHT = Math.round(PAGE_HEIGHT * 0.35); // 227pt

/**
 * Build the front cover page. Pure typographic design with an
 * optional image inset. Always renders correctly regardless of
 * whether the image generation succeeded.
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
    margin: [0, 24, 0, 0],
  });

  // Optional genre eyebrow
  if (eyebrow) {
    out.push({
      text: eyebrow.toUpperCase(),
      style: 'coverEyebrow',
      margin: [0, 18, 0, 0],
    });
  }

  // Book title — large, centered
  out.push({
    text: bookTitle.toUpperCase(),
    style: 'coverTitle',
    margin: [0, 12, 0, 0],
  });

  // Decorative dot under title
  out.push({
    text: '\u00A0',
    style: 'titleSpacer',
  });

  // Optional image (centered, 2:3 portrait at 60% of page height)
  if (hasImage) {
    out.push({
      image: `data:${art.mimeType};base64,${art.base64}`,
      height: COVER_IMAGE_HEIGHT,
      alignment: 'center',
      margin: [0, 24, 0, 8],
    });
  }

  // "a novel" tag
  out.push({
    text: ctx.isPolish ? 'powieść' : 'a novel',
    style: 'aNovel',
    margin: [0, 24, 0, 0],
  });

  // Author name — bottom of the same page. A large top margin pushes
  // it down; pdfmake doesn't have a native "push to page bottom"
  // without absolutePosition, and we're avoiding that because of the
  // rendering issues it caused on the cover image.
  out.push({
    text: bookAuthor.toUpperCase(),
    style: 'bookAuthor',
    margin: [0, 96, 0, 0],
  });

  // Bottom decorative rule to frame the cover
  out.push({
    canvas: [{
      type: 'line',
      x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0,
      lineWidth: 0.5, lineColor: '#888',
    }],
    margin: [0, 16, 0, 0],
  });

  return out;
}

/**
 * Build the back cover page. Typographic, with the blurb in the
 * upper portion and the author bio in the lower portion. An optional
 * small image can sit in the middle as a decorative emblem.
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
    margin: [0, 60, 0, 0],
  });

  // Decorative image in the middle, 2:3 portrait at 35% of page height
  if (hasImage) {
    out.push({
      image: `data:${art.mimeType};base64,${art.base64}`,
      height: BACK_COVER_IMAGE_HEIGHT,
      alignment: 'center',
      margin: [0, 32, 0, 32],
    });
  }

  // Author bio in the lower portion
  out.push({
    text: authorBio,
    style: 'coverAuthorBio',
    margin: [0, 24, 0, 24],
  });

  // Thin rule near the bottom
  out.push({
    canvas: [{
      type: 'line',
      x1: 40, y1: 0, x2: CONTENT_WIDTH - 40, y2: 0,
      lineWidth: 0.4, lineColor: '#888',
    }],
    margin: [0, 16, 0, 12],
  });

  // Author byline
  out.push({
    text: bookAuthor.toUpperCase(),
    style: 'bookAuthor',
    margin: [0, 0, 0, 8],
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

  const background = (config.protagonist?.background || '').trim();
  const age = config.protagonist?.age;
  let authorBio: string;
  if (background) {
    const head = isPolish ? 'O autorze' : 'About the author';
    authorBio = `${head}: ${config.protagonist?.name || ''}${age ? `, ${age}` : ''}, ${background}`;
  } else {
    const storyteller = isPolish ? 'Opowiadacz eksplorujący' : 'A storyteller exploring';
    authorBio = `${storytellerSafe(isPolish)} ${themePart}.`;
  }
  if (authorBio.length > 200) {
    authorBio = authorBio.slice(0, 199).trimEnd() + '\u2026';
  }

  return { blurb, authorBio };
}

function storytellerSafe(isPolish: boolean): string {
  return isPolish ? 'Opowiadacz eksplorujący' : 'A storyteller exploring';
}
