// @traces 333-FR-015
import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  MEDIA_LIMITS,
  MediaFileQueryDto,
  MediaUploadRequestDto,
} from './media.dto';

function failed<T extends object>(type: new () => T, body: object) {
  return validateSync(plainToInstance(type, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
}

const PHOTO = {
  checksum: 'yPQ5Jg==',
  contentType: 'image/jpeg',
  kind: 'photo',
  sizeBytes: 1,
};
const CLIP = { ...PHOTO, contentType: 'video/mp4', kind: 'clip', seconds: 30 };

describe('upload request, hostile input', () => {
  it.each([
    ['seconds 0', { seconds: 0 }],
    ['seconds -1', { seconds: -1 }],
    ['seconds 1.5', { seconds: 1.5 }],
    ['seconds as a string', { seconds: '30' }],
    ['seconds null', { seconds: null }],
    ['seconds NaN', { seconds: Number.NaN }],
    ['seconds Infinity', { seconds: Number.POSITIVE_INFINITY }],
  ])('refuses a clip with %s', (_t, patch) => {
    expect(failed(MediaUploadRequestDto, { ...CLIP, ...patch })).toContain(
      'seconds',
    );
  });

  it('refuses a clip with no seconds', () => {
    const { seconds: _s, ...rest } = CLIP;
    expect(failed(MediaUploadRequestDto, rest)).toContain('seconds');
  });

  it.each([1, 30, 60, 61, 3600])(
    'lets seconds %s through for the service',
    (seconds) => {
      expect(failed(MediaUploadRequestDto, { ...CLIP, seconds })).toEqual([]);
    },
  );

  it.each([0, null, '5'])('refuses a photo carrying seconds %p', (seconds) => {
    expect(failed(MediaUploadRequestDto, { ...PHOTO, seconds })).toContain(
      'seconds',
    );
  });

  it.each([0, -1, 1.5, '100', null, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses sizeBytes %p',
    (sizeBytes) => {
      expect(failed(MediaUploadRequestDto, { ...PHOTO, sizeBytes })).toContain(
        'sizeBytes',
      );
    },
  );

  it('accepts sizeBytes of exactly 1', () => {
    expect(failed(MediaUploadRequestDto, PHOTO)).toEqual([]);
  });

  it.each(['live', 'PHOTO', '', null, 1])('refuses kind %p', (kind) => {
    expect(failed(MediaUploadRequestDto, { ...PHOTO, kind })).toContain('kind');
  });

  it('accepts a caption of 140 characters and refuses 141', () => {
    expect(
      failed(MediaUploadRequestDto, { ...PHOTO, caption: 'a'.repeat(140) }),
    ).toEqual([]);
    expect(
      failed(MediaUploadRequestDto, { ...PHOTO, caption: 'a'.repeat(141) }),
    ).toEqual(['caption']);
  });

  it('counts a caption in characters, so 140 Romanian letters pass', () => {
    expect(
      failed(MediaUploadRequestDto, { ...PHOTO, caption: 'ș'.repeat(140) }),
    ).toEqual([]);
  });

  it('counts a caption of 140 emoji as 140 characters', () => {
    expect(
      failed(MediaUploadRequestDto, { ...PHOTO, caption: '🔧'.repeat(140) }),
    ).toEqual([]);
  });

  it.each([1, {}, []])('refuses caption %p', (caption) => {
    expect(failed(MediaUploadRequestDto, { ...PHOTO, caption })).toContain(
      'caption',
    );
  });

  it.each([
    'yPQ5Jg=',
    'yPQ5Jg===',
    'yPQ5Jg==\n',
    ' yPQ5Jg==',
    'yPQ5JB==',
    'yPQ5Jg',
    'yPQ5Jgxx',
    'yPQ-Jg==',
    '',
    'AAAAAAAA',
  ])('refuses checksum %p', (checksum) => {
    expect(failed(MediaUploadRequestDto, { ...PHOTO, checksum })).toContain(
      'checksum',
    );
  });

  it.each([
    'AAAAAA==',
    'AAAAAQ==',
    'AAAAAg==',
    'AAAAAw==',
    '/+/+/g=='.replace('g', 'g'),
  ])('accepts the valid CRC32 checksum %p', (checksum) => {
    expect(failed(MediaUploadRequestDto, { ...PHOTO, checksum })).toEqual([]);
  });

  it('refuses a missing checksum', () => {
    const { checksum: _c, ...rest } = PHOTO;
    expect(failed(MediaUploadRequestDto, rest)).toContain('checksum');
  });

  it('accepts a content type of 100 characters and refuses 101', () => {
    expect(
      failed(MediaUploadRequestDto, { ...PHOTO, contentType: 'x'.repeat(100) }),
    ).toEqual([]);
    expect(
      failed(MediaUploadRequestDto, { ...PHOTO, contentType: 'x'.repeat(101) }),
    ).toEqual(['contentType']);
  });

  it('refuses an unknown field such as garageId or status', () => {
    expect(
      failed(MediaUploadRequestDto, { ...PHOTO, status: 'visible' }),
    ).toEqual(['status']);
  });

  it('refuses a prototype-pollution key', () => {
    const body = JSON.parse('{"__proto__":{"kind":"live"},"kind":"photo"}');
    expect(failed(MediaUploadRequestDto, { ...PHOTO, ...body })).toEqual([]);
    expect(({} as Record<string, unknown>)['kind']).toBeUndefined();
  });

  it('keeps the limits the spec names', () => {
    expect(MEDIA_LIMITS).toMatchObject({
      captionChars: 140,
      clipBytes: 100 * 1024 * 1024,
      clipSeconds: 60,
      clipShortSidePx: 720,
      downloadUrlMinutes: 5,
      photoPx: 2048,
      thumbPx: 480,
      uploadUrlMinutes: 15,
    });
  });
});

describe('file query', () => {
  it.each(['FILE', 'original', '', 'file,thumbnail'])(
    'refuses variant %p',
    (variant) => {
      expect(failed(MediaFileQueryDto, { variant })).toEqual(['variant']);
    },
  );

  it('accepts no variant, file and thumbnail', () => {
    for (const q of [{}, { variant: 'file' }, { variant: 'thumbnail' }]) {
      expect(failed(MediaFileQueryDto, q)).toEqual([]);
    }
  });
});
