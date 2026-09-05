/**
 * Sniff the actual image format from the leading bytes of a base64
 * payload. The image-01 model used by `minimax` advertises "image"
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
export interface ImageFormat {
  ext: 'jpg' | 'png' | 'webp' | 'gif';
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

export function sniffImageFormat(b64: string): ImageFormat {
  if (!b64) return { ext: 'jpg', mime: 'image/jpeg' };
  const head = b64.slice(0, 12);
  if (head.startsWith('/9j/') || head.startsWith('/9j/4')) return { ext: 'jpg', mime: 'image/jpeg' };
  if (head.startsWith('iVBORw')) return { ext: 'png', mime: 'image/png' };
  if (head.startsWith('UklGR')) return { ext: 'webp', mime: 'image/webp' };
  if (head.startsWith('R0lGOD')) return { ext: 'gif', mime: 'image/gif' };
  return { ext: 'jpg', mime: 'image/jpeg' };
}
