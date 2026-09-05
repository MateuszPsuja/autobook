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
