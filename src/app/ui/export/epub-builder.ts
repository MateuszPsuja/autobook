import { zipSync, strToU8 } from 'fflate';
import { sniffImageFormat } from '../../shared/utils/image-bytes';
import { BookCoverArt, ChapterIllustration } from '../../core/providers/illustration.types';
import { ExportLabels } from '../../i18n/export-labels';
import { stripRunningWordCount } from '../../shared/utils/chapter-cleanup';
import { Chapter } from '../../models/chapter.model';
import { BookConfig } from '../../models/book-config.model';

export interface EpubBuildInput {
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

const COVER_XHTML_PATH = 'OEBPS/xhtml/cover.xhtml';
const BACK_COVER_XHTML_PATH = 'OEBPS/xhtml/back-cover.xhtml';
const NAV_XHTML_PATH = 'OEBPS/nav.xhtml';
const OPF_PATH = 'OEBPS/package.opf';
const CONTAINER_PATH = 'META-INF/container.xml';
const STYLESHEET_PATH = 'OEBPS/styles/book.css';

/**
 * Decode a base64 string to bytes. The image payloads from
 * `minimax` are clean base64 (no whitespace) per the existing
 * `minimax-image.service.ts` code, so we don't need a tolerant
 * parser.
 */
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/**
 * XML-escape a string for safe inclusion in an XHTML element body
 * or attribute value.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Stable UUID generator. Falls back when `crypto.randomUUID` is
 * unavailable (older browsers / some test runners).
 */
function uuidv4(): string {
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// === Stylesheet =============================================================

/**
 * The single shared stylesheet for the whole package. Reference
 * goals (in priority order):
 *   1. Reads as a real book on day one — serif body, comfortable
 *      leading, page-breaks between chapters, drop caps.
 *   2. Looks consistent across mainstream readers (Apple Books,
 *      Calibre, Kobo, Readium). We use a system serif stack
 *      (Garamond → Iowan Old Style → Charter → Georgia → serif)
 *      so we don't need to embed a font and don't fight the
 *      reader's default font fallback when a glyph is missing.
 *   3. Print-style margins without going full-`@page` (which not
 *      every reader respects anyway).
 *
 * v1 does NOT embed a custom font. If the user wants the same
 * "house font" on every reader — Android, Kobo, low-end
 * e-ink — that's a follow-up: drop a SIL OFL TTF in
 * OEBPS/fonts/, declare in the OPF, and add an @font-face
 * block here.
 */
const STYLESHEET = `/* AutoBook EPUB — typographic stylesheet
 * Targets mainstream EPUB 3 readers (Apple Books, Calibre, Kobo,
 * Readium). Uses a system serif stack so the book reads naturally
 * on any device without a bundled font.
 */

@namespace epub "http://www.idpf.org/2007/ops";

body {
  font-family: "Iowan Old Style", "Apple Garamond", Garamond, "EB Garamond",
               Charter, Georgia, "Times New Roman", serif;
  font-size: 1.05em;
  line-height: 1.6;
  margin: 1.2em 1.6em;
  text-align: justify;
  hyphens: auto;
  -webkit-hyphens: auto;
  -epub-hyphens: auto;
  widows: 2;
  orphans: 2;
}

/* === Cover page === */
section.cover {
  text-align: center;
  page-break-after: always;
  margin-top: 4em;
}
section.cover .eyebrow {
  font-size: 0.85em;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  margin: 0 0 1.2em 0;
  color: #555;
}
section.cover .book-title {
  font-size: 2.4em;
  line-height: 1.2;
  margin: 0.4em 0 0.6em 0;
  font-weight: normal;
  letter-spacing: 0.02em;
  text-transform: none;
  page-break-before: avoid;
  page-break-after: avoid;
}
section.cover .cover-image {
  margin: 1.4em auto;
  max-width: 80%;
  max-height: 60vh;
}
section.cover .cover-image img {
  max-width: 100%;
  max-height: 100%;
  display: block;
  margin: 0 auto;
  box-shadow: 0 2px 12px rgba(0,0,0,0.12);
}
section.cover .a-novel {
  font-style: italic;
  font-size: 0.95em;
  color: #666;
  margin: 1.2em 0 0.4em 0;
  letter-spacing: 0.08em;
}
section.cover .byline {
  font-size: 0.95em;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #333;
  margin: 0.6em 0 0 0;
}

/* === Chapter pages === */
section.chapter {
  page-break-before: always;
}
h1.chapter-title {
  font-size: 1.6em;
  font-weight: normal;
  text-align: center;
  margin: 2em 0 1.4em 0;
  letter-spacing: 0.04em;
  page-break-before: avoid;
  page-break-after: avoid;
}

section.chapter p {
  margin: 0 0 0.6em 0;
  text-indent: 1.2em;
}
/* First paragraph of each chapter: no indent (the chapter title
 * already provides the visual break). The drop cap hooks onto
 * this class so the cap sits flush with the chapter body. */
section.chapter p.first-paragraph {
  text-indent: 0;
}
section.chapter p.first-paragraph::first-letter {
  font-size: 3.4em;
  font-weight: normal;
  float: left;
  line-height: 0.9;
  margin: 0.08em 0.12em 0 0;
  padding: 0;
  color: #222;
}

/* === Chapter illustration === */
figure.chapter-illustration {
  margin: 0 auto 1.4em auto;
  text-align: center;
  page-break-inside: avoid;
}
figure.chapter-illustration img {
  max-width: 90%;
  max-height: 50vh;
  display: block;
  margin: 0 auto;
  box-shadow: 0 1px 8px rgba(0,0,0,0.08);
}
figure.chapter-illustration figcaption {
  font-size: 0.85em;
  font-style: italic;
  color: #666;
  margin: 0.6em 1em 0 1em;
}

/* === Back cover === */
section.back-cover {
  page-break-before: always;
  margin: 3em 1.6em 1em 1.6em;
}
section.back-cover .blurb {
  font-size: 1em;
  line-height: 1.6;
  margin: 0 0 1.4em 0;
  text-align: justify;
}
section.back-cover .back-cover-image {
  text-align: center;
  margin: 1.2em 0;
}
section.back-cover .back-cover-image img {
  max-width: 60%;
  max-height: 30vh;
  display: inline-block;
  box-shadow: 0 1px 8px rgba(0,0,0,0.08);
}
section.back-cover .author-bio {
  font-size: 0.9em;
  line-height: 1.55;
  color: #444;
  margin: 1.4em 0 0.4em 0;
  text-align: justify;
}
section.back-cover .byline {
  font-size: 0.85em;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #333;
  margin: 0.6em 0 0.2em 0;
}
section.back-cover .isbn {
  font-size: 0.8em;
  color: #777;
  margin: 0.4em 0 0 0;
  letter-spacing: 0.04em;
}

/* === Navigation / TOC === */
nav#toc {
  page-break-after: always;
}
nav#toc h1 {
  font-size: 1.4em;
  text-align: center;
  margin: 2em 0 1.2em 0;
  font-weight: normal;
  letter-spacing: 0.04em;
}
nav#toc ol {
  list-style: none;
  padding: 0;
  margin: 0 auto;
  max-width: 32em;
}
nav#toc li {
  margin: 0.5em 0;
  font-size: 1em;
}
nav#toc a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px dotted #aaa;
}
`;

// === XHTML builders ==========================================================

/**
 * Build the front cover XHTML. When `coverEntry` is provided,
 * embeds the image at the top of the cover. When absent, renders
 * a pure typographic cover (title + author + a novel tag).
 */
function buildCoverXhtml(input: EpubBuildInput, coverEntry: ImageEntry | null): string {
  const { config, labels, bookAuthor } = input;
  const title = (config?.title || '').trim() || labels.untitledFallback;
  const genre = (config?.genre || '').trim();
  const imgFile = coverEntry ? coverEntry.href.split('/').pop()! : null;
  const figure = imgFile
    ? `<figure class="cover-image"><img src="../images/${imgFile}" alt="${escapeXml(title)}"/></figure>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body>
<section class="cover" epub:type="cover">
  ${genre ? `<p class="eyebrow">${escapeXml(genre.toUpperCase())}</p>` : ''}
  <h1 class="book-title">${escapeXml(title)}</h1>
  ${figure}
  <p class="a-novel">${escapeXml(labels.aBookLabel)}</p>
  <p class="byline">${escapeXml(bookAuthor)}</p>
</section>
</body>
</html>`;
}

/**
 * Build the back cover XHTML. Blurb first (mirrors pdf-cover.ts
 * layout), then a small image if present, then the author bio and
 * ISBN placeholder.
 */
function buildBackCoverXhtml(input: EpubBuildInput, blurb: string, backEntry: ImageEntry | null): string {
  const { config, labels, bookAuthor } = input;
  const themes = (config?.themes || []).slice(0, 3).filter(Boolean);
  const themePart = themes.length ? themes.join(labels.themeSeparator) : labels.backCoverUnknownTheme;
  const authorBio = themes.length
    ? `${labels.backCoverHead}: ${labels.backCoverSubject}${labels.backCoverVerb} ${themePart}.`
    : `${labels.backCoverHead}: ${labels.backCoverSubject}.`;
  const trimmedBio = authorBio.length > 200 ? authorBio.slice(0, 199).trimEnd() + '\u2026' : authorBio;
  const imgFile = backEntry ? backEntry.href.split('/').pop()! : null;
  const figure = imgFile
    ? `<div class="back-cover-image"><img src="../images/${imgFile}" alt=""/></div>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <title>${escapeXml(labels.backCoverHead)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body>
<section class="back-cover">
  <p class="blurb">${escapeXml(blurb)}</p>
  ${figure}
  <p class="author-bio">${escapeXml(trimmedBio)}</p>
  <p class="byline">${escapeXml(bookAuthor)}</p>
  <p class="isbn">${escapeXml(labels.isbnPlaceholder)}</p>
</section>
</body>
</html>`;
}

/**
 * Build one chapter XHTML. Splits the content on blank lines into
 * paragraphs; the first paragraph carries the `first-paragraph`
 * class so the stylesheet can drop-cap it. The illustration, if
 * present, is rendered as a `<figure>` above the body with the
 * caption as `<figcaption>`.
 */
function buildChapterXhtml(
  chapter: Chapter,
  illustration: { ill: ChapterIllustration; entry: ImageEntry } | null,
  labels: ExportLabels,
): string {
  const body = stripRunningWordCount(chapter.content || '').trim();
  const paragraphs = body.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const titleHtml = `<h1 class="chapter-title">${escapeXml(`${labels.chapterLabel} ${chapter.number}: ${chapter.title || ''}`)}</h1>`;
  let figure = '';
  if (illustration) {
    const fileName = illustration.entry.href.split('/').pop()!;
    const caption = illustration.ill.caption || '';
    figure = `<figure class="chapter-illustration"><img src="../images/${fileName}" alt="${escapeXml(caption)}"/><figcaption>${escapeXml(caption)}</figcaption></figure>`;
  }
  const paragraphHtml = paragraphs
    .map((p, i) => `<p${i === 0 ? ' class="first-paragraph"' : ''}>${escapeXml(p)}</p>`)
    .join('\n  ');
  const fullTitle = `${labels.chapterLabel} ${chapter.number}: ${chapter.title || ''}`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <title>${escapeXml(fullTitle)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body>
<section class="chapter" id="chapter-${chapter.number}">
  ${titleHtml}
  ${figure}
  ${paragraphHtml}
</section>
</body>
</html>`;
}

/**
 * Build the EPUB 3 navigation document. Lists every chapter.
 */
function buildNavXhtml(input: EpubBuildInput): string {
  const { chapters, labels } = input;
  const items = chapters
    .map(ch => `<li><a href="xhtml/chapter-${ch.number}.xhtml">${escapeXml(`${labels.chapterLabel} ${ch.number}: ${ch.title || ''}`)}</a></li>`)
    .join('\n      ');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <title>${escapeXml(labels.tocLabel)}</title>
  <link rel="stylesheet" type="text/css" href="styles/book.css"/>
</head>
<body>
<nav epub:type="toc" id="toc">
  <h1>${escapeXml(labels.tocLabel)}</h1>
  <ol>
      ${items}
  </ol>
</nav>
</body>
</html>`;
}

// === OPF / container ========================================================

interface ImageEntry {
  id: string;
  href: string;
  mediaType: string;
  path: string;
  bytes: Uint8Array;
}

interface OpfImageEntry {
  id: string;
  href: string;
  mediaType: string;
}

function buildOpf(input: EpubBuildInput, imageEntries: OpfImageEntry[]): string {
  const { chapters, config, labels, bookAuthor } = input;
  const title = (config?.title || '').trim() || labels.untitledFallback;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const manifestItems: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="cover" href="xhtml/cover.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="back-cover" href="xhtml/back-cover.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="styles" href="styles/book.css" media-type="text/css"/>`,
  ];
  for (const ch of chapters) {
    manifestItems.push(`<item id="chapter-${ch.number}" href="xhtml/chapter-${ch.number}.xhtml" media-type="application/xhtml+xml"/>`);
  }
  for (const img of imageEntries) {
    const isCover = img.id === 'img-cover-front';
    const props = isCover ? ' properties="cover-image"' : '';
    manifestItems.push(`<item id="${img.id}" href="${img.href}" media-type="${img.mediaType}"${props}/>`);
  }

  const spineItems: string[] = [
    `<itemref idref="cover"/>`,
    ...chapters.map(ch => `<itemref idref="chapter-${ch.number}"/>`),
    `<itemref idref="back-cover"/>`,
  ];

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuidv4()}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(bookAuthor)}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
}

function buildContainerXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${OPF_PATH}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function buildBlurb(input: EpubBuildInput): string {
  const { config, labels } = input;
  const themes = (config?.themes || []).slice(0, 3).filter(Boolean);
  const themePart = themes.length ? themes.join(labels.themeSeparator) : labels.backCoverUnknownTheme;
  const protagonist = config?.protagonist?.name || labels.backCoverUnknownProtagonist;
  const title = (config?.title || '').trim() || labels.backCoverUnknownTitle;
  const raw = labels.backCoverBlurbTemplate
    .replace('{title}', title)
    .replace('{protagonist}', protagonist)
    .replace('{themePart}', themePart);
  return raw.length > 280 ? raw.slice(0, 279).trimEnd() + '\u2026' : raw;
}

// === Public entry point =====================================================

/**
 * Build a real EPUB 3 file from chapters + config + (optional)
 * illustration context. Returns a Blob with MIME
 * `application/epub+zip`.
 *
 * When no `illustrationCtx` is provided (or the illustration service
 * produced no images), the cover and back cover are still rendered
 * as typographic pages — no `<img>` tags, no image files in the
 * package.
 *
 * Image file extensions and media-types are derived from the actual
 * byte format of the payload (via `sniffImageFormat`), not from the
 * `mimeType` field on the illustration object. The image service
 * sometimes labels WebP/GIF as `image/jpeg`/`image/png` for
 * pdfmake compatibility — this builder ignores that label and uses
 * the real format.
 */
export function buildEpubBlob(input: EpubBuildInput): Blob {
  const ctx = input.illustrationCtx;
  const coverArt = ctx?.coverArt;
  const backCoverArt = ctx?.backCoverArt;
  const chapterIlls = ctx?.chapterIllustrations;

  // Decode each image to bytes + sniff the real format. Build
  // a single ordered list of image entries for the OPF manifest
  // AND a by-chapter-id lookup for the chapter XHTML.
  const allImages: ImageEntry[] = [];
  let coverEntry: ImageEntry | null = null;
  let backEntry: ImageEntry | null = null;
  if (coverArt && coverArt.base64) {
    const { ext, mime } = sniffImageFormat(coverArt.base64);
    coverEntry = {
      id: 'img-cover-front',
      href: `images/cover-front.${ext}`,
      mediaType: mime,
      path: `OEBPS/images/cover-front.${ext}`,
      bytes: base64ToBytes(coverArt.base64),
    };
    allImages.push(coverEntry);
  }
  if (backCoverArt && backCoverArt.base64) {
    const { ext, mime } = sniffImageFormat(backCoverArt.base64);
    backEntry = {
      id: 'img-cover-back',
      href: `images/cover-back.${ext}`,
      mediaType: mime,
      path: `OEBPS/images/cover-back.${ext}`,
      bytes: base64ToBytes(backCoverArt.base64),
    };
    allImages.push(backEntry);
  }
  const chapterImageByChapterId = new Map<string, { ill: ChapterIllustration; entry: ImageEntry }>();
  if (chapterIlls) {
    for (const [chapterId, ill] of chapterIlls.entries()) {
      if (!ill || !ill.base64) continue;
      const { ext, mime } = sniffImageFormat(ill.base64);
      const safeId = chapterId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const entry: ImageEntry = {
        id: `img-illust-${safeId}`,
        href: `images/illustration-${safeId}.${ext}`,
        mediaType: mime,
        path: `OEBPS/images/illustration-${safeId}.${ext}`,
        bytes: base64ToBytes(ill.base64),
      };
      allImages.push(entry);
      chapterImageByChapterId.set(chapterId, { ill, entry });
    }
  }

  // Build per-chapter XHTML. Loop is over `input.chapters` to
  // preserve order and to skip chapters that don't exist in the
  // illustration map.
  const chapterXhtmlByPath = new Map<string, string>();
  for (const ch of input.chapters) {
    const ill = chapterImageByChapterId.get(ch.id);
    const xhtml = buildChapterXhtml(ch, ill || null, input.labels);
    chapterXhtmlByPath.set(`OEBPS/xhtml/chapter-${ch.number}.xhtml`, xhtml);
  }

  const opfImageEntries: OpfImageEntry[] = allImages.map(e => ({
    id: e.id, href: e.href, mediaType: e.mediaType,
  }));

  // Compose the file map. fflate preserves insertion order in
  // the ZIP, and the `mimetype` entry must be the first file
  // AND stored uncompressed for EPUBCheck.
  // The `level` literals are typed with `as const` so they
  // match fflate's narrow union (0 | 1 | ... | 9) — passing a
  // generic `number` here is a type error.
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  files['mimetype'] = [strToU8('application/epub+zip'), { level: 0 }];
  files[CONTAINER_PATH] = [strToU8(buildContainerXml()), { level: 6 }];
  files[OPF_PATH] = [strToU8(buildOpf(input, opfImageEntries)), { level: 6 }];
  files[STYLESHEET_PATH] = [strToU8(STYLESHEET), { level: 6 }];
  files[NAV_XHTML_PATH] = [strToU8(buildNavXhtml(input)), { level: 6 }];
  files[COVER_XHTML_PATH] = [strToU8(buildCoverXhtml(input, coverEntry)), { level: 6 }];
  files[BACK_COVER_XHTML_PATH] = [strToU8(buildBackCoverXhtml(input, buildBlurb(input), backEntry)), { level: 6 }];
  for (const [path, xhtml] of chapterXhtmlByPath) {
    files[path] = [strToU8(xhtml), { level: 6 }];
  }
  for (const img of allImages) {
    files[img.path] = [img.bytes, { level: 6 }];
  }

  const zipped = zipSync(files);
  return new Blob([zipped], { type: 'application/epub+zip' });
}
