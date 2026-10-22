// @traces 1192-FR-001 1192-FR-006
import {
  IMAGE_FORMATS,
  IMAGE_WIDTHS,
  variantFile,
  variantKeys,
} from './images';

describe('the image variant names, hostile inputs', () => {
  it('lists eight keys for a path, widths in order, avif before webp', () => {
    expect(variantKeys('g/o/d')).toEqual([
      'g/o/d/320.avif',
      'g/o/d/320.webp',
      'g/o/d/640.avif',
      'g/o/d/640.webp',
      'g/o/d/960.avif',
      'g/o/d/960.webp',
      'g/o/d/1600.avif',
      'g/o/d/1600.webp',
    ]);
  });

  it('gives the same keys on a second call', () => {
    expect(variantKeys('g/o/d')).toEqual(variantKeys('g/o/d'));
  });

  it('names every width and format pair exactly once', () => {
    const names = IMAGE_WIDTHS.flatMap((w) =>
      IMAGE_FORMATS.map((f) => variantFile(w, f)),
    );
    expect(new Set(names).size).toBe(8);
  });

  it('keeps a path with unicode and spaces verbatim', () => {
    expect(variantKeys('g/é ü/日本')[0]).toBe('g/é ü/日本/320.avif');
  });

  it('does not collapse a trailing slash in the path', () => {
    expect(variantKeys('g/o/d/')[0]).toBe('g/o/d//320.avif');
  });

  it('keeps the empty path as a leading slash key', () => {
    expect(variantKeys('')[0]).toBe('/320.avif');
  });
});
