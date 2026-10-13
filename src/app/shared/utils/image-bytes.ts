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

/** Natural pixel dimensions of an image. */
export interface PixelSize {
  width: number;
  height: number;
}

/**
 * Read the natural pixel dimensions out of a PNG or JPEG header.
 *
 * Needed because the exporters that place an image inside a fixed box
 * have to preserve its aspect ratio — a non-square cover forced into a
 * square box comes out stretched. Returns `null` for formats we don't
 * decode (WebP, GIF) or for a truncated / malformed header, and callers
 * fall back to the max box in that case.
 */
export function sniffImageSize(data: Uint8Array, ext: 'jpg' | 'png'): PixelSize | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  try {
    if (ext === 'png') {
      // 8-byte signature, then the IHDR chunk: length(4) type(4)
      // width(4) height(4).
      if (data.length < 24) return null;
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (ext === 'jpg') {
      // Walk the marker segments to the first SOF, which carries the
      // frame dimensions. SOF0/1/2/3, 5/6/7, 9/10/11, 13/14/15 — i.e.
      // everything except the DHT/JPG/DAC markers interleaved with them.
      let offset = 2; // skip SOI
      while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) { offset++; continue; }
        const marker = data[offset + 1];
        // Standalone markers carry no length payload.
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const isSof = (marker >= 0xc0 && marker <= 0xc3)
          || (marker >= 0xc5 && marker <= 0xc7)
          || (marker >= 0xc9 && marker <= 0xcb)
          || (marker >= 0xcd && marker <= 0xcf);
        if (isSof) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        offset += 2 + view.getUint16(offset + 2);
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}
