// @traces 1192-FR-001 1192-FR-007
import { IMAGE_FORMATS, IMAGE_WIDTHS, variantFile } from './images';

describe('the image variants', () => {
  it('come in four widths and two formats', () => {
    expect(IMAGE_WIDTHS).toEqual([320, 640, 960, 1600]);
    expect(IMAGE_FORMATS).toEqual(['avif', 'webp']);
  });

  it('are named by width and format', () => {
    expect(variantFile(640, 'avif')).toBe('640.avif');
    expect(variantFile(1600, 'webp')).toBe('1600.webp');
  });
});
