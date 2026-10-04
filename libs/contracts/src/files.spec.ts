import {
  DOWNLOAD_URL_MINUTES,
  FILE_RULES,
  PUBLIC_IMAGE_URL_MINUTES,
  UPLOAD_URL_MINUTES,
} from './files';

const TEN_MB = 10 * 1024 * 1024;
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENTS = ['application/pdf', 'image/jpeg', 'image/png'];

describe('file rules', () => {
  it('names the five launch purposes', () => {
    expect(Object.keys(FILE_RULES).sort()).toEqual([
      'garage_photo',
      'legal_document',
      'mechanic_photo',
      'message_photo',
      'repair_invoice',
    ]);
  });

  it.each([
    ['garage_photo', IMAGES],
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
