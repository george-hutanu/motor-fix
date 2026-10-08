import { FILE_RULES } from './files';
import { hasConfirmedPhoto, PHOTOS_MAX } from './listing-photos';

const KEY =
  'garage_photo/7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00/5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1a37';

describe('the photo limits', () => {
  it('holds at most 20 photos of JPEG, PNG or WebP up to 10 MB', () => {
    expect(PHOTOS_MAX).toBe(20);
    expect(FILE_RULES.garage_photo).toEqual({
      maxBytes: 10 * 1024 * 1024,
      types: ['image/jpeg', 'image/png', 'image/webp'],
    });
  });
});

describe('step 5 completeness for photos', () => {
  it('is met by one confirmed photo', () => {
    expect(hasConfirmedPhoto({ files: [KEY] })).toBe(true);
  });

  it.each([
    ['no files field', {}],
    ['an empty list', { files: [] }],
    ['no data at all', undefined],
  ])('is not met with %s', (_, data) => {
    expect(hasConfirmedPhoto(data)).toBe(false);
  });
});
