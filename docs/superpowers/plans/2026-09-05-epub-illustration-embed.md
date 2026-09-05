# EPUB Illustration Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user exports an EPUB with **Add illustrations** checked and the active LLM provider is `minimax`, embed the generated cover art, back cover art, and per-chapter illustrations directly into the EPUB package — and produce a real EPUB file while we're at it (the current "EPUB" export is just a markdown string with the wrong MIME type, so it doesn't actually open in any reader).

**Architecture:**

1. Build a real EPUB 3 package from scratch: a ZIP (`fflate` is already in `node_modules`, no new dependency) containing the required `mimetype` entry (uncompressed), `META-INF/container.xml`, `OEBPS/package.opf` (manifest + spine), `OEBPS/nav.xhtml` (EPUB 3 navigation document), and one XHTML file per chapter.
2. When illustration data is present, decode each `base64` to bytes, write the bytes to `OEBPS/images/<safe-name>.<real-ext>`, declare them in the OPF manifest with the correct `media-type`, and reference them from the cover / back cover / chapter XHTML via `<img src="…">`.
3. Extend the export component's illustration-generation gate from `format === 'pdf'` to `format === 'pdf' || format === 'epub'` so the existing `IllustrationService.generateAll$` call also fires for EPUB. Caption localisation (already in place) keeps working for EPUB unchanged.
4. Sniff the actual image format from the leading bytes of the base64 payload — the existing `MinimaxImageService.detectImageMime` helper collapses WebP/GIF to PNG/JPEG for `pdfmake`, so we cannot trust the `mimeType` field as a label for the file extension. Extract the sniff logic into a shared helper and have both the PDF path and the EPUB path call it.

**Tech Stack:** Angular 20 standalone components, RxJS, TypeScript, `fflate` (already installed at `node_modules/fflate`), Karma + Jasmine for tests. No new dependencies.

## Global Constraints

- **No new npm packages** — `fflate` is already at `node_modules/fflate` and is the only ZIP library the project ships. The implementation must use it for both the EPUB ZIP and the `Uint8Array` ↔ base64 conversions (`fflate.strFromU8` for the base64 round-trip, `fflate.zipSync` for the package).
- **EPUB 3 spec compliance** — the package must validate as EPUB 3 (EPUBCheck-clean): the `mimetype` entry is the first ZIP entry, stored uncompressed, containing the exact bytes `application/epub+zip`; `META-INF/container.xml` points at `OEBPS/package.opf` via `<rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>`; the nav document is EPUB 3 (`<nav epub:type="toc">`).
- **No breaking change to PDF or DOCX or Markdown export** — the PDF path is untouched. The DOCX / Markdown paths still go through `buildBookContent` (which is what the existing export component spec covers). Only the EPUB branch changes.
- **Localisation** — chapter labels, TOC heading, "a novel" tag, author byline, and back-cover text all read from the existing `ExportLabels` bundle (`getExportLabels(exportLanguage)`). No new i18n keys are needed for this plan.
- **Provider gate** — illustrations are only generated when `providerService.getActiveProviderId() === 'minimax'` (matching the existing template guard at `export.component.html:167` and the existing `IllustrationService.generateAll$` early-return). If the user has the checkbox on but a different provider is active, the checkbox is hidden in the template; if it ever gets submitted anyway, `IllustrationService` returns an empty result, so the EPUB ships without images (and the export does not fail).
- **Image formats** — the EPUB package may contain JPEG / PNG / WebP / GIF depending on what the image model returned. The byte-sniffing helper must detect all four and pick the right file extension + `media-type`. WebP and GIF work in mainstream EPUB 3 readers but **not** in Amazon's Kindle conversion pipeline — that's out of scope here, the user can re-export as PDF if they want Kindle.
- **Failure mode** — if the image model fails for any specific image, the existing `IllustrationService` already returns `null` for that image and the export still ships (just without that image). The EPUB builder must treat a missing `coverArt` / `backCoverArt` / per-chapter illustration as "no image at that slot" and render a typographic fallback (mirroring `pdf-cover.ts`).
- **Filename uniqueness** — chapter XHTML files are named `chapter-<number>.xhtml` where `<number>` is the chapter's `number` field. Image files use the same prefix plus the chapter id (`illustration-<chapter-id>.<ext>`) to handle books that have non-numeric ids. Cover art is `cover-front.<ext>`, back cover is `cover-back.<ext>`.
- **Output blob MIME** — `application/epub+zip`. The current code already uses this; the new builder must keep it.

## File Structure

- **Create** `src/app/ui/export/epub-builder.ts` — pure function `buildEpubBlob(input: EpubBuildInput): Blob`. Owns the EPUB 3 package shape: mimetype, META-INF, OPF, nav, chapter XHTML, cover XHTML, image embedding. No Angular dependencies (so it can be unit-tested without `TestBed`).
- **Create** `src/app/ui/export/epub-builder.spec.ts` — unit tests for the builder. Uses `fflate.unzipSync` to assert package contents.
- **Create** `src/app/shared/utils/image-bytes.ts` — shared helper `sniffImageFormat(b64: string): { ext: string; mime: string }`. Extracted from `minimax-image.service.ts:156-164` so both the PDF path and the EPUB path can call it. Returns one of `jpg` / `png` / `webp` / `gif` plus the matching `image/*` mime. Falls back to `jpg` when the magic bytes don't match anything known (matching the existing behaviour).
- **Modify** `src/app/core/providers/minimax-image.service.ts:156-164` — replace the local `detectImageMime` with a re-export of `sniffImageFormat` (or keep the local function as a thin wrapper for backwards compatibility, but have it call the shared helper so the byte-sniff logic lives in one place).
- **Modify** `src/app/ui/export/export.component.ts:268-298` — extend the illustration-generation gate from `format === 'pdf'` to also include `format === 'epub'`. Pass `chapterIllustrations`, `coverArt`, `backCoverArt` to `generateEPUB`. Replace `generateEPUB`'s body (line 431) to call the new `buildEpubBlob`. Drop the `buildBookContent` call from the EPUB branch (keep it for DOCX / markdown).
- **Modify** `src/app/ui/export/export.component.spec.ts` — add tests covering the EPUB branch: (a) when `selectedFormat === 'epub'` and `includeIllustrations` is on and the provider is `minimax`, the component calls `illustrationService.generateAll$`; (b) the result is a Blob with type `application/epub+zip`; (c) when the checkbox is off, the component still ships a valid EPUB blob (real EPUB, just without images).
- **Out of scope** — DOCX export. The current DOCX branch has the same "markdown in a DOCX-mime blob" bug as the current EPUB branch, but the user explicitly asked for EPUB only. If the user wants the same treatment for DOCX, it should be a follow-up plan (and would need `docx` or `pizzip` rather than a markdown string). Not part of this plan.

---

## Task 1: Extract image-format sniffing into a shared helper

The current `MinimaxImageService.detectImageMime` (`minimax-image.service.ts:156-164`) collapses WebP and GIF to `image/png` because `pdfmake 0.2.7` has poor support for both. The EPUB path needs the **real** mime (so the file extension and the OPF `media-type` are correct). Extract the byte-sniffing logic into a shared helper and have the existing function delegate to it.

**Files:**
- Create: `src/app/shared/utils/image-bytes.ts`
- Modify: `src/app/core/providers/minimax-image.service.ts:156-164`
- Create: `src/app/shared/utils/image-bytes.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `sniffImageFormat(b64: string): { ext: 'jpg' | 'png' | 'webp' | 'gif'; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }`

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/shared/utils/image-bytes.spec.ts
import { sniffImageFormat } from './image-bytes';

describe('sniffImageFormat', () => {
  // These are the leading base64 chars of each format's magic bytes.
  //   JPEG  : /9j/    (FFD8FFE0…)
  //   PNG   : iVBORw  (89504E47…)
  //   WebP  : UklGR    (RIFF…WEBP)
  //   GIF   : R0lGOD   (47494638…)
  it('detects JPEG from /9j/ prefix', () => {
    expect(sniffImageFormat('/9j/4AAQSkZJRgABAQAAAQABAAD')).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
  });

  it('detects PNG from iVBORw prefix', () => {
    expect(sniffImageFormat('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ')).toEqual({ ext: 'png', mime: 'image/png' });
  });

  it('detects WebP from UklGR prefix (RIFF...WEBP)', () => {
    expect(sniffImageFormat('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJZQCdAEO/gbsAAA=')).toEqual({ ext: 'webp', mime: 'image/webp' });
  });

  it('detects GIF from R0lGOD prefix', () => {
    expect(sniffImageFormat('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')).toEqual({ ext: 'gif', mime: 'image/gif' });
  });

  it('falls back to jpg for unknown leading bytes', () => {
    expect(sniffImageFormat('AAAAdeadbeefcafe')).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
  });

  it('falls back to jpg for empty input', () => {
    expect(sniffImageFormat('')).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/image-bytes.spec.ts'`
Expected: FAIL with "Cannot find module './image-bytes'".

- [ ] **Step 3: Implement the helper**

```typescript
// src/app/shared/utils/image-bytes.ts

export interface ImageFormat {
  ext: 'jpg' | 'png' | 'webp' | 'gif';
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

/**
 * Sniff the actual image format from the leading bytes of a base64
 * payload. The image-01 model used by minimax advertises "image"
 * but does not document the binary format; in practice we've seen
 * JPEG, PNG, WebP, and GIF. The base64 magic prefixes are stable:
 *   JPEG  : /9j/    (FFD8FFE0…)
 *   PNG   : iVBORw  (89504E47…)
 *   WebP  : UklGR    (RIFF…WEBP)
 *   GIF   : R0lGOD   (47494638…)
 * Anything else (or empty input) falls back to JPEG.
 *
 * Note: the legacy `MinimaxImageService.detectImageMime` collapses
 * WebP/GIF to JPEG/PNG because pdfmake 0.2.7 has poor support for
 * both. The EPUB path needs the *real* format so the file extension
 * and the OPF media-type are correct, so this helper preserves
 * WebP and GIF as their own types. The PDF path still has its own
 * coercion when it needs to feed pdfmake — see `detectImageMime`.
 */
export function sniffImageFormat(b64: string): ImageFormat {
  if (!b64) return { ext: 'jpg', mime: 'image/jpeg' };
  const head = b64.slice(0, 12);
  if (head.startsWith('/9j/') || head.startsWith('/9j/4')) return { ext: 'jpg', mime: 'image/jpeg' };
  if (head.startsWith('iVBORw')) return { ext: 'png', mime: 'image/png' };
  if (head.startsWith('UklGR')) return { ext: 'webp', mime: 'image/webp' };
  if (head.startsWith('R0lGOD')) return { ext: 'gif', mime: 'image/gif' };
  return { ext: 'jpg', mime: 'image/jpeg' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/image-bytes.spec.ts'`
Expected: PASS — 6 specs, 0 failures.

- [ ] **Step 5: Update `MinimaxImageService.detectImageMime` to delegate**

In `src/app/core/providers/minimax-image.service.ts`, replace lines 156-164 with:

```typescript
import { sniffImageFormat } from '../../shared/utils/image-bytes';

function detectImageMime(b64: string): MinimaxImageResult['mimeType'] {
  // pdfmake 0.2.7 has poor support for WebP and GIF, so the PDF
  // path collapses both to PNG/JPEG via the shared sniffer. The
  // EPUB path calls `sniffImageFormat` directly so it gets the
  // real format.
  const { mime } = sniffImageFormat(b64);
  if (mime === 'image/webp' || mime === 'image/gif') return 'image/jpeg';
  return mime;
}
```

- [ ] **Step 6: Run the existing `minimax-image.service` test to make sure the change didn't break it**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/minimax-image.service.spec.ts'`
Expected: PASS (existing specs unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/app/shared/utils/image-bytes.ts \
        src/app/shared/utils/image-bytes.spec.ts \
        src/app/core/providers/minimax-image.service.ts
git commit -m "feat(export): extract image-format sniff into shared helper"
```

---

## Task 2: Build a real EPUB 3 package from chapters + config + illustrations

Build a pure function `buildEpubBlob(input)` that produces a real, valid EPUB 3 file. No Angular deps, fully unit-testable. The function handles the no-illustrations case too (just typographic content) so the existing `selectedFormat === 'epub' && !includeIllustrations` flow also produces a valid EPUB.

**Files:**
- Create: `src/app/ui/export/epub-builder.ts`
- Create: `src/app/ui/export/epub-builder.spec.ts`

**Interfaces:**
- Consumes: nothing (pure function)
- Produces: `buildEpubBlob(input: EpubBuildInput): Blob` returning a Blob with type `application/epub+zip`.

```typescript
// At the top of epub-builder.ts
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
```

- [ ] **Step 1: Write the failing tests for the package structure**

```typescript
// src/app/ui/export/epub-builder.spec.ts
import { unzipSync, strFromU8 } from 'fflate';
import { buildEpubBlob, EpubBuildInput } from './epub-builder';
import { BookConfig } from '../../models/book-config.model';
import { Chapter } from '../../models/chapter.model';

const baseInput: EpubBuildInput = {
  chapters: [
    { id: 'c1', number: 1, title: 'The Beginning', content: 'It was a dark and stormy night.' } as Chapter,
    { id: 'c2', number: 2, title: 'The Middle', content: 'Things got complicated.' } as Chapter,
  ],
  config: { title: 'Test Book', genre: 'mystery', protagonist: { name: 'Alex' } } as BookConfig,
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

function readEntry(blob: Blob, name: string): string {
  const bytes = new Uint8Array(blob as any);
  // Use a sync unzip; fflate supports this. We rely on the Blob being
  // backed by an ArrayBuffer in tests (which the builder guarantees
  // by returning `new Blob([uint8], { type })`).
  const files = unzipSync(bytes);
  const entry = files[name];
  if (!entry) throw new Error(`Missing EPUB entry: ${name}`);
  return strFromU8(entry);
}

describe('buildEpubBlob', () => {
  it('returns a Blob with type application/epub+zip', () => {
    const blob = buildEpubBlob(baseInput);
    expect(blob.type).toBe('application/epub+zip');
  });

  it('puts the uncompressed mimetype entry as the first ZIP entry', () => {
    const blob = buildEpubBlob(baseInput);
    const files = unzipSync(new Uint8Array(blob as any));
    const names = Object.keys(files);
    expect(names[0]).toBe('mimetype');
    expect(strFromU8(files['mimetype'])).toBe('application/epub+zip');
  });

  it('includes META-INF/container.xml pointing at OEBPS/package.opf', () => {
    const blob = buildEpubBlob(baseInput);
    const container = readEntry(blob, 'META-INF/container.xml');
    expect(container).toContain('<rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>');
  });

  it('includes an EPUB 3 navigation document', () => {
    const blob = buildEpubBlob(baseInput);
    const nav = readEntry(blob, 'OEBPS/nav.xhtml');
    expect(nav).toContain('<nav epub:type="toc">');
    expect(nav).toContain('The Beginning');
    expect(nav).toContain('The Middle');
  });

  it('includes one XHTML file per chapter with the localised chapter label', () => {
    const blob = buildEpubBlob(baseInput);
    const c1 = readEntry(blob, 'OEBPS/xhtml/chapter-1.xhtml');
    expect(c1).toContain('The Beginning');
    expect(c1).toContain('It was a dark and stormy night.');
    const c2 = readEntry(blob, 'OEBPS/xhtml/chapter-2.xhtml');
    expect(c2).toContain('The Middle');
  });

  it('strips the running word-count footer from chapter content', () => {
    const inputWithWordCount: EpubBuildInput = {
      ...baseInput,
      chapters: [
        { id: 'c1', number: 1, title: 'Has count', content: 'Body.\n\nWord count: 1,234 words\n' } as Chapter,
      ],
    };
    const blob = buildEpubBlob(inputWithWordCount);
    const c1 = readEntry(blob, 'OEBPS/xhtml/chapter-1.xhtml');
    expect(c1).toContain('Body.');
    expect(c1).not.toContain('Word count:');
  });

  it('does not include image entries when no illustrationCtx is provided', () => {
    const blob = buildEpubBlob(baseInput);
    const files = unzipSync(new Uint8Array(blob as any));
    const imageEntries = Object.keys(files).filter(n => n.startsWith('OEBPS/images/'));
    expect(imageEntries).toEqual([]);
  });
});

describe('buildEpubBlob with illustrations', () => {
  // 1x1 transparent PNG bytes, base64-encoded.
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  // 1x1 JPEG bytes (white pixel), base64-encoded.
  const JPG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////2wBDAf//////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AfwD/2Q==';

  it('embeds the cover image as a separate file and references it from the cover XHTML', () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        coverArt: { base64: JPG_B64, mimeType: 'image/jpeg', side: 'front' },
      },
    });
    const files = unzipSync(new Uint8Array(blob as any));
    expect(files['OEBPS/images/cover-front.jpg']).toBeDefined();
    const coverXhtml = strFromU8(files['OEBPS/xhtml/cover.xhtml']);
    expect(coverXhtml).toContain('<img src="../images/cover-front.jpg"');
  });

  it('embeds the back-cover image and references it from the back cover XHTML', () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        backCoverArt: { base64: PNG_B64, mimeType: 'image/png', side: 'back' },
      },
    });
    const files = unzipSync(new Uint8Array(blob as any));
    expect(files['OEBPS/images/cover-back.png']).toBeDefined();
    const backXhtml = strFromU8(files['OEBPS/xhtml/back-cover.xhtml']);
    expect(backXhtml).toContain('<img src="../images/cover-back.png"');
  });

  it('embeds a per-chapter illustration and references it from the chapter XHTML', () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        chapterIllustrations: new Map([
          ['c1', { base64: JPG_B64, mimeType: 'image/jpeg', caption: 'Chapter 1 · The Beginning' }],
        ]),
      },
    });
    const files = unzipSync(new Uint8Array(blob as any));
    expect(files['OEBPS/images/illustration-c1.jpg']).toBeDefined();
    const c1 = strFromU8(files['OEBPS/xhtml/chapter-1.xhtml']);
    expect(c1).toContain('<img src="../images/illustration-c1.jpg"');
    expect(c1).toContain('Chapter 1 · The Beginning');
  });

  it('uses the actual byte format (not the supplied mimeType) for the file extension', () => {
    // Caller says "image/png" but the bytes are JPEG (starts with /9j/).
    // The EPUB file should still be saved as .jpg.
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        coverArt: { base64: JPG_B64, mimeType: 'image/png', side: 'front' },
      },
    });
    const files = unzipSync(new Uint8Array(blob as any));
    expect(files['OEBPS/images/cover-front.jpg']).toBeDefined();
    expect(files['OEBPS/images/cover-front.png']).toBeUndefined();
    const opf = strFromU8(files['OEBPS/package.opf']);
    expect(opf).toContain('media-type="image/jpeg"');
    expect(opf).not.toContain('cover-front.png"');
  });

  it('declares every image in the OPF manifest with the correct media-type', () => {
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
    const opf = strFromU8(unzipSync(new Uint8Array(blob as any))['OEBPS/package.opf']);
    expect(opf).toContain('id="img-cover-front"');
    expect(opf).toContain('href="images/cover-front.jpg"');
    expect(opf).toContain('media-type="image/jpeg"');
    expect(opf).toContain('id="img-cover-back"');
    expect(opf).toContain('href="images/cover-back.png"');
    expect(opf).toContain('media-type="image/png"');
    expect(opf).toContain('id="img-illust-c1"');
    expect(opf).toContain('href="images/illustration-c1.jpg"');
  });

  it('round-trips image bytes exactly (no re-encoding)', () => {
    const blob = buildEpubBlob({
      ...baseInput,
      illustrationCtx: {
        coverArt: { base64: JPG_B64, mimeType: 'image/jpeg', side: 'front' },
      },
    });
    const files = unzipSync(new Uint8Array(blob as any));
    const saved = files['OEBPS/images/cover-front.jpg'];
    // Decode the saved bytes and compare to the original b64-decoded bytes.
    const original = Uint8Array.from(atob(JPG_B64), c => c.charCodeAt(0));
    expect(saved.length).toBe(original.length);
    for (let i = 0; i < saved.length; i++) expect(saved[i]).toBe(original[i]);
  });

  it('falls back to a typographic cover when coverArt is missing', () => {
    const blob = buildEpubBlob({
      ...baseInput,
      // illustrationCtx provided but coverArt undefined — the model
      // failed for the cover. The cover XHTML should still render
      // the typographic fallback (no <img> tag).
      illustrationCtx: {},
    });
    const files = unzipSync(new Uint8Array(blob as any));
    const cover = strFromU8(files['OEBPS/xhtml/cover.xhtml']);
    expect(cover).toContain('Test Book');
    expect(cover).not.toContain('<img');
  });
});
```

- [ ] **Step 2: Run the tests to verify they all fail**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/epub-builder.spec.ts'`
Expected: FAIL with "Cannot find module './epub-builder'".

- [ ] **Step 3: Implement the builder**

```typescript
// src/app/ui/export/epub-builder.ts
import { zipSync, strToU8, strFromU8, unzipSync } from 'fflate';
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

/**
 * Decode a base64 string to bytes. Uses `atob` (available in browsers
 * and in modern Node). Returns a Uint8Array.
 */
function base64ToBytes(b64: string): Uint8Array {
  // atob is fine for ASCII-only base64. The image payloads from
  // minimax are clean base64 (no whitespace) per the existing
  // minimax-image.service.ts code, so we don't need a tolerant parser.
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
 * Build the front cover XHTML. When `coverArt` is present, embeds
 * the image at the top of the cover. When absent, renders a pure
 * typographic cover (title + author + a novel tag).
 */
function buildCoverXhtml(input: EpubBuildInput, hasCoverImage: boolean): string {
  const { config, labels, bookAuthor } = input;
  const title = (config?.title || '').trim() || labels.untitledFallback;
  const genre = (config?.genre || '').trim();
  const imgTag = hasCoverImage
    ? `<figure class="cover"><img src="../images/cover-front.jpg" alt="${escapeXml(title)}"/></figure>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(labels.chapterLabel === 'Chapter' ? 'en' : 'en')}">
<head><title>${escapeXml(title)}</title></head>
<body>
<section epub:type="cover">
  ${genre ? `<p class="eyebrow">${escapeXml(genre.toUpperCase())}</p>` : ''}
  <h1 class="book-title">${escapeXml(title)}</h1>
  ${imgTag}
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
function buildBackCoverXhtml(input: EpubBuildInput, blurb: string, hasBackImage: boolean): string {
  const { config, labels, bookAuthor } = input;
  const themes = (config?.themes || []).slice(0, 3).filter(Boolean);
  const themePart = themes.length ? themes.join(labels.themeSeparator) : labels.backCoverUnknownTheme;
  const authorBio = themes.length
    ? `${labels.backCoverHead}: ${labels.backCoverSubject}${labels.backCoverVerb} ${themePart}.`
    : `${labels.backCoverHead}: ${labels.backCoverSubject}.`;
  const imgTag = hasBackImage
    ? `<figure class="back-cover"><img src="../images/cover-back.jpg" alt=""/></figure>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeXml(labels.backCoverHead)}</title></head>
<body>
<section class="back-cover">
  <p class="blurb">${escapeXml(blurb)}</p>
  ${imgTag}
  <p class="author-bio">${escapeXml(authorBio.length > 200 ? authorBio.slice(0, 199).trimEnd() + '\u2026' : authorBio)}</p>
  <p class="byline">${escapeXml(bookAuthor)}</p>
  <p class="isbn">${escapeXml(labels.isbnPlaceholder)}</p>
</section>
</body>
</html>`;
}

/**
 * Build one chapter XHTML. Splits the content on blank lines into
 * paragraphs (the existing buildBookContent does the same implicit
 * split by emitting `\n\n`; we just preserve paragraph breaks).
 * The illustration, if present, is rendered as a `<figure>` at the
 * top with the caption as `<figcaption>`.
 */
function buildChapterXhtml(chapter: Chapter, illustration: ChapterIllustration | null, labels: ExportLabels): string {
  const body = stripRunningWordCount(chapter.content || '').trim();
  const paragraphs = body.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const figure = illustration
    ? `<figure class="chapter-illustration"><img src="../images/illustration-${escapeXml(chapter.id)}.jpg" alt="${escapeXml(illustration.caption)}"/><figcaption>${escapeXml(illustration.caption)}</figcaption></figure>`
    : '';
  const titleHtml = `<h1 class="chapter-title">${escapeXml(labels.chapterLabel)} ${chapter.number}: ${escapeXml(chapter.title || '')}</h1>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeXml(`${labels.chapterLabel} ${chapter.number}: ${chapter.title || ''}`)}</title></head>
<body>
<section class="chapter" id="chapter-${chapter.number}">
  ${titleHtml}
  ${figure}
  ${paragraphs.map(p => `<p>${escapeXml(p)}</p>`).join('\n  ')}
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
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeXml(labels.tocLabel)}</title></head>
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

/**
 * Build the OPF package document: manifest of every file in the
 * package, spine listing the reading order, and (EPUB 3) the
 * metadata block.
 */
function buildOpf(input: EpubBuildInput, imageEntries: { id: string; href: string; mediaType: string }[]): string {
  const { chapters, config, labels, bookAuthor } = input;
  const title = (config?.title || '').trim() || labels.untitledFallback;
  const langCode = 'en'; // The orchestrator always writes English.
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const manifestItems: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="cover" href="xhtml/cover.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="back-cover" href="xhtml/back-cover.xhtml" media-type="application/xhtml+xml"/>`,
  ];
  for (const ch of chapters) {
    manifestItems.push(`<item id="chapter-${ch.number}" href="xhtml/chapter-${ch.number}.xhtml" media-type="application/xhtml+xml"/>`);
  }
  for (const img of imageEntries) {
    manifestItems.push(`<item id="${img.id}" href="${img.href}" media-type="${img.mediaType}"${img.id === 'img-cover-front' ? ' properties="cover-image"' : ''}/>`);
  }

  const spineItems: string[] = [
    `<itemref idref="cover"/>`,
    ...chapters.map(ch => `<itemref idref="chapter-${ch.number}"/>`),
    `<itemref idref="back-cover"/>`,
  ];

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${langCode}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(bookAuthor)}</dc:creator>
    <dc:language>${langCode}</dc:language>
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

/**
 * Build a real EPUB 3 file from chapters + config + (optional)
 * illustration context. Returns a Blob with MIME `application/epub+zip`.
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

  // Decode each image to bytes + sniff the real format. Build a
  // manifest entry per image and a per-chapter image map keyed by
  // chapter id.
  const imageEntries: { id: string; href: string; mediaType: string; path: string; bytes: Uint8Array }[] = [];
  if (coverArt && coverArt.base64) {
    const { ext, mime } = sniffImageFormat(coverArt.base64);
    imageEntries.push({
      id: 'img-cover-front',
      href: `images/cover-front.${ext}`,
      mediaType: mime,
      path: `OEBPS/images/cover-front.${ext}`,
      bytes: base64ToBytes(coverArt.base64),
    });
  }
  if (backCoverArt && backCoverArt.base64) {
    const { ext, mime } = sniffImageFormat(backCoverArt.base64);
    imageEntries.push({
      id: 'img-cover-back',
      href: `images/cover-back.${ext}`,
      mediaType: mime,
      path: `OEBPS/images/cover-back.${ext}`,
      bytes: base64ToBytes(backCoverArt.base64),
    });
  }
  const chapterImageByChapterId = new Map<string, { id: string; href: string; mediaType: string; path: string; bytes: Uint8Array; ill: ChapterIllustration }>();
  if (chapterIlls) {
    for (const [chapterId, ill] of chapterIlls.entries()) {
      if (!ill || !ill.base64) continue;
      const { ext, mime } = sniffImageFormat(ill.base64);
      const safeId = chapterId.replace(/[^a-zA-Z0-9_-]/g, '_');
      chapterImageByChapterId.set(chapterId, {
        id: `img-illust-${safeId}`,
        href: `images/illustration-${safeId}.${ext}`,
        mediaType: mime,
        path: `OEBPS/images/illustration-${safeId}.${ext}`,
        bytes: base64ToBytes(ill.base64),
        ill,
      });
    }
  }

  // Adjust the cover XHTML: the embedded `<img>` tag references
  // `cover-front.jpg` literally, but if the actual extension is
  // different we need to update the href. Same for the back cover
  // and the per-chapter images.
  const coverEntry = imageEntries.find(e => e.id === 'img-cover-front');
  const backEntry = imageEntries.find(e => e.id === 'img-cover-back');
  const coverXhtml = buildCoverXhtml(input, !!coverEntry)
    .replace('cover-front.jpg', coverEntry ? coverEntry.href.split('/').pop()! : 'cover-front.jpg');
  const backXhtml = buildBackCoverXhtml(input, buildBlurb(input), !!backEntry)
    .replace('cover-back.jpg', backEntry ? backEntry.href.split('/').pop()! : 'cover-back.jpg');

  // Build per-chapter XHTML.
  const chapterXhtmlByPath = new Map<string, string>();
  for (const ch of input.chapters) {
    const ill = chapterImageByChapterId.get(ch.id);
    let xhtml = buildChapterXhtml(ch, ill ? ill.ill : null, input.labels);
    if (ill) {
      // The placeholder href is `illustration-${id}.jpg`; replace
      // with the real extension.
      const fileName = ill.href.split('/').pop()!;
      xhtml = xhtml.replace(`illustration-${ch.id}.jpg`, fileName);
    }
    chapterXhtmlByPath.set(`OEBPS/xhtml/chapter-${ch.number}.xhtml`, xhtml);
  }

  // Manifest entries for the OPF (just the metadata, not the bytes).
  const opfImageEntries = imageEntries.map(e => ({ id: e.id, href: e.href, mediaType: e.mediaType }));
  // Add chapter images to the manifest.
  for (const [, v] of chapterImageByChapterId) {
    opfImageEntries.push({ id: v.id, href: v.href, mediaType: v.mediaType });
  }

  // Compose the file map. fflate requires the `mimetype` entry to
  // be first and stored uncompressed for EPUBCheck; we achieve both
  // with `uncompressed` per-entry and insertion order.
  const files: Record<string, [Uint8Array, { level: number }]> = {};
  // mimetype first, uncompressed
  files['mimetype'] = [strToU8('application/epub+zip'), { level: 0 }];
  files[CONTAINER_PATH] = [strToU8(buildContainerXml()), { level: 6 }];
  files[OPF_PATH] = [strToU8(buildOpf(input, opfImageEntries)), { level: 6 }];
  files[NAV_XHTML_PATH] = [strToU8(buildNavXhtml(input)), { level: 6 }];
  files[COVER_XHTML_PATH] = [strToU8(coverXhtml), { level: 6 }];
  files[BACK_COVER_XHTML_PATH] = [strToU8(backXhtml), { level: 6 }];
  for (const [path, xhtml] of chapterXhtmlByPath) {
    files[path] = [strToU8(xhtml), { level: 6 }];
  }
  for (const img of imageEntries) {
    files[img.path] = [img.bytes, { level: 6 }];
  }
  for (const [, v] of chapterImageByChapterId) {
    files[v.path] = [v.bytes, { level: 6 }];
  }

  const zipped = zipSync(files);
  return new Blob([zipped], { type: 'application/epub+zip' });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/epub-builder.spec.ts'`
Expected: PASS — 13 specs, 0 failures.

If the `crypto.randomUUID()` call complains under Karma / older Chrome, replace it with a hand-rolled UUID-v4 generator. Add this fallback if needed:

```typescript
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/export/epub-builder.ts \
        src/app/ui/export/epub-builder.spec.ts
git commit -m "feat(export): build a real EPUB 3 package with image embedding"
```

---

## Task 3: Wire the illustration pipeline + new builder into `ExportComponent`

Replace the current `generateEPUB` (which just calls `buildBookContent`) with a real call to `buildEpubBlob`, and extend the illustration-generation gate so the `minimax` image pipeline also fires when the user picks EPUB.

**Files:**
- Modify: `src/app/ui/export/export.component.ts:268-298` (gate) and `src/app/ui/export/export.component.ts:431-434` (generateEPUB body)
- Modify: `src/app/ui/export/export.component.spec.ts` (add EPUB branch coverage)

- [ ] **Step 1: Write the failing tests for the EPUB branch**

Add to `src/app/ui/export/export.component.spec.ts` (append after the existing `describe('Multi-language export', ...)` block):

```typescript
import { IllustrationService } from '../../core/providers/illustration.service';
import { ProviderService } from '../../core/providers/provider.service';
import { BookCoverArt, ChapterIllustration } from '../../core/providers/illustration.types';

const mockIllustration = {
  generateAll$: (_req: any) => of({
    chapterIllustrations: new Map<string, ChapterIllustration>([
      ['c1', { base64: 'iVBORw0KGgo=', mimeType: 'image/png', caption: 'Chapter 1' }],
    ]),
    coverArt: { base64: '/9j/4AAQ=', mimeType: 'image/jpeg', side: 'front' } as BookCoverArt,
    backCoverArt: { base64: 'iVBORw0KGgo=', mimeType: 'image/png', side: 'back' } as BookCoverArt,
    totalCalls: 3,
    completedCalls: 3,
  }),
} as Partial<IllustrationService>;

const mockProvider = {
  getActiveProviderId: () => 'minimax',
  getApiKey: () => 'sk-test',
  getBaseUrl: () => 'https://api.example.com/v1',
} as Partial<ProviderService>;

describe('ExportComponent EPUB branch', () => {
  beforeEach(async () => {
    // Reset the TestBed with the illustration + provider mocks.
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule, ExportComponent],
      providers: [
        { provide: BookStateService, useValue: mockBookState },
        { provide: PersistenceService, useValue: mockPersistence },
        { provide: TranslationService, useValue: mockTranslation },
        { provide: IllustrationService, useValue: mockIllustration },
        { provide: ProviderService, useValue: mockProvider },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('calls illustrationService.generateAll$ when EPUB + includeIllustrations + minimax', async () => {
    const illSpy = spyOn(mockIllustration as any, 'generateAll$').and.callThrough();

    chaptersSubject.next([
      { id: 'c1', number: 1, title: 'A', content: 'A' },
    ]);
    component.selectedFormat = 'epub';
    component.exportOptions.includeIllustrations = true;

    spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
    spyOn(document.body, 'appendChild').and.stub();
    spyOn(document.body, 'removeChild').and.stub();
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub();

    await component.exportBook();
    expect(illSpy).toHaveBeenCalled();
  });

  it('produces a Blob with type application/epub+zip', async () => {
    chaptersSubject.next([
      { id: 'c1', number: 1, title: 'A', content: 'A' },
    ]);
    component.selectedFormat = 'epub';
    component.exportOptions.includeIllustrations = false;
    spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
    spyOn(document.body, 'appendChild').and.stub();
    spyOn(document.body, 'removeChild').and.stub();
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
    const blob = await (component as any).generateEPUB([
      { id: 'c1', number: 1, title: 'A', content: 'A' },
    ], undefined);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/epub+zip');
  });

  it('does NOT call illustrationService when includeIllustrations is off (even if minimax)', async () => {
    const illSpy = spyOn(mockIllustration as any, 'generateAll$').and.callThrough();
    chaptersSubject.next([{ id: 'c1', number: 1, title: 'A', content: 'A' }]);
    component.selectedFormat = 'epub';
    component.exportOptions.includeIllustrations = false;
    spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
    spyOn(document.body, 'appendChild').and.stub();
    spyOn(document.body, 'removeChild').and.stub();
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
    await component.exportBook();
    expect(illSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/export.component.spec.ts'`
Expected: FAIL — the new `ExportComponent EPUB branch` block fails (either "no provider for IllustrationService" or "did not call generateAll$" or "blob type is text/plain" depending on which test).

- [ ] **Step 3: Extend the illustration gate and update `generateEPUB`**

In `src/app/ui/export/export.component.ts`, change line 268-298:

```typescript
      // Illustration pass (minimax-only). Runs for both PDF and
      // EPUB; DOCX and Markdown skip it because the user only asked
      // for EPUB and DOCX's "real format" rebuild is out of scope.
      // Failure is non-fatal: a null result or a missing illustration
      // means the chapter / cover ships without art, but the export
      // still completes.
      let chapterIllustrations: Map<string, ChapterIllustration> | undefined;
      let coverArt: BookCoverArt | undefined;
      let backCoverArt: BookCoverArt | undefined;
      if ((this.selectedFormat === 'pdf' || this.selectedFormat === 'epub') &&
          this.exportOptions.includeIllustrations &&
          this.providerService.getActiveProviderId() === 'minimax') {
        // ... existing block unchanged ...
      }
```

Then change the `case 'epub':` branch (around line 349-352):

```typescript
        case 'epub':
          content = await this.generateEPUB(chapters, config, {
            chapterIllustrations,
            coverArt,
            backCoverArt,
          });
          filename = 'book-export.epub';
          break;
```

And replace `generateEPUB` (lines 431-434) with:

```typescript
  private async generateEPUB(
    chapters: Chapter[],
    translatedConfig?: any,
    illustrationCtx?: {
      chapterIllustrations?: Map<string, ChapterIllustration>;
      coverArt?: BookCoverArt;
      backCoverArt?: BookCoverArt;
    },
  ): Promise<Blob> {
    const baseState = this.bookStateService.getState();
    const config = translatedConfig ?? baseState.config;
    const labels = getExportLabels(this.exportLanguage);
    return buildEpubBlob({
      chapters,
      config,
      labels,
      bookAuthor: this.getEffectiveAuthor(),
      illustrationCtx,
    });
  }
```

Add the import at the top of the file (next to the existing `buildPdfDocument` import on line 16):

```typescript
import { buildEpubBlob } from './epub-builder';
```

- [ ] **Step 4: Run all the export component tests to verify they pass**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/export.component.spec.ts'`
Expected: PASS — original 7 specs + 3 new EPUB specs, 0 failures.

- [ ] **Step 5: Run the full test suite to make sure nothing else broke**

Run: `npx ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS — all specs green.

- [ ] **Step 6: Manual smoke test in the dev server**

```bash
npm start
```

1. Open the export tab.
2. Pick the `minimax` provider, type a book with at least 3 chapters, check **Add illustrations**.
3. Pick **EPUB** and click **Export**. The file should download as `book-export.epub`.
4. Open the file in [EPUBCheck](https://www.npmjs.com/package/epubcheck) (CLI: `npx epubcheck book-export.epub`) — should be 0 errors, 0 fatals.
5. Open it in Calibre's viewer (or Apple's Books) — cover image renders, chapter illustrations render, no broken image placeholders.
6. Re-export as **EPUB** with **Add illustrations** UNCHECKED — file still opens, ships as a typographic-only EPUB.
7. Re-export as **PDF** with **Add illustrations** CHECKED — the existing PDF behaviour is unchanged (cover image, chapter plates, no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/app/ui/export/export.component.ts \
        src/app/ui/export/export.component.spec.ts
git commit -m "feat(export): wire illustration pipeline into EPUB export"
```

---

## Self-Review

**1. Spec coverage:**
- "Embed images in EPUB when Add illustrations on minimax is checked" → Task 3 wires the gate; Task 2 builds the EPUB with image embedding. ✓
- Cover, back cover, and per-chapter images are all embedded. ✓ (covered by Task 2 tests for each)
- Real EPUB file is produced (not the current "markdown with EPUB MIME" lie). ✓ (Task 2 first test asserts `application/epub+zip` and the mimetype entry)
- Existing PDF, DOCX, Markdown flows unchanged. ✓ (Task 3 only touches the EPUB branch + the gate; PDF branch identical)
- Provider gate respected. ✓ (Task 3 reuses the existing `providerService.getActiveProviderId() === 'minimax'` check)

**2. Placeholder scan:**
- No "TBD" / "TODO" / "implement later" / "fill in details" in any step. ✓
- No "similar to Task N" cross-references — each task repeats its own code. ✓
- No "add appropriate error handling" / "add validation" — failure modes are explicit (sniff fallback to JPEG, missing illustration = typographic cover, missing chapter illustration = no `<figure>`). ✓
- Every test step has actual test code. ✓
- Every implement step has actual implementation code. ✓
- All types referenced (`ChapterIllustration`, `BookCoverArt`, `EpubBuildInput`, `sniffImageFormat`) are defined in the same plan or in existing code. ✓

**3. Type consistency:**
- `EpubBuildInput.illustrationCtx.chapterIllustrations` matches `Map<string, ChapterIllustration>` everywhere it appears (Task 2 interface, Task 2 test fixtures, Task 3 wire-up). ✓
- `sniffImageFormat` returns `{ ext, mime }` everywhere it's called. ✓
- `BookCoverArt.side` is `'front' | 'back'` — used in Task 2 to build the cover vs. back-cover image entries. ✓
- `coverXhtml.replace('cover-front.jpg', ...)` and the same for back cover — both replacements are guarded by `if (coverEntry)` / `if (backEntry)` so they fall back to the placeholder when no image is present. ✓
