// @traces 1191-FR-005
// @traces 333-media-storage-FR-002
import {
  DOWNLOAD_URL_MINUTES,
  FILE_RULES,
  PUBLIC_IMAGE_URL_MINUTES,
  UPLOAD_URL_MINUTES,
} from './files';

const TEN_MB = 10 * 1024 * 1024;
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const GARAGE_PHOTOS = [...IMAGES, 'image/heic', 'image/heif'];
const DOCUMENTS = ['application/pdf', 'image/jpeg', 'image/png'];

describe('file rules', () => {
  it('names the five launch purposes and the two media purposes', () => {
    expect(Object.keys(FILE_RULES).sort()).toEqual([
      'garage_photo',
      'legal_document',
      'mechanic_photo',
      'media_clip',
      'media_photo',
      'message_photo',
      'repair_invoice',
    ]);
  });

  it('lets a media photo take what a garage photo takes, up to 10 MB', () => {
    expect(FILE_RULES.media_photo).toEqual({
      maxBytes: TEN_MB,
      types: GARAGE_PHOTOS,
    });
  });

  it('lets a media clip take MP4, QuickTime and WebM up to 100 MB', () => {
    expect(FILE_RULES.media_clip).toEqual({
      maxBytes: 100 * 1024 * 1024,
      types: ['video/mp4', 'video/quicktime', 'video/webm'],
    });
  });

  it.each([
    ['garage_photo', GARAGE_PHOTOS],
    ['message_photo', IMAGES],
    ['mechanic_photo', IMAGES],
    ['legal_document', DOCUMENTS],
    ['repair_invoice', DOCUMENTS],
  ] as const)('lets %s take its types up to 10 MB', (purpose, types) => {
    expect(FILE_RULES[purpose]).toEqual({ maxBytes: TEN_MB, types });
  });

  it('signs uploads for 15 minutes, downloads for 5 and public images for 60', () => {
    expect([
      UPLOAD_URL_MINUTES,
      DOWNLOAD_URL_MINUTES,
      PUBLIC_IMAGE_URL_MINUTES,
    ]).toEqual([15, 5, 60]);
  });
});
