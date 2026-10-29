// @traces 333-media-storage-FR-015
import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  MEDIA_KINDS,
  MEDIA_LIMITS,
  MEDIA_REFUSALS,
  MEDIA_STATUSES,
  MediaFileAddressDto,
  MediaFileQueryDto,
  MediaItemDto,
  MediaListDto,
  MediaUploadAddressDto,
  MediaUploadRequestDto,
} from './media.dto';

// As the API's ValidationPipe checks a body: unknown fields refused.
function failed<T extends object>(type: new () => T, body: object) {
  return validateSync(plainToInstance(type, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
}

const listed = (dto: object) =>
  (
    (Reflect.getMetadata('swagger/apiModelPropertiesArray', dto) ??
      []) as string[]
  ).map((name) => name.replace(/^:/, ''));

const PHOTO = {
  checksum: 'yPQ5Jg==',
  contentType: 'image/jpeg',
  kind: 'photo',
  sizeBytes: 4_000_000,
};
const CLIP = {
  checksum: 'AAAAAA==',
  contentType: 'video/quicktime',
  kind: 'clip',
  seconds: 45,
  sizeBytes: 60_000_000,
};

describe('the media contract', () => {
  it('names the kinds and the states of an item', () => {
    expect(MEDIA_KINDS).toEqual(['photo', 'clip', 'live']);
    expect(MEDIA_STATUSES).toEqual([
      'processing',
      'visible',
      'failed',
      'removed',
      'purged',
    ]);
  });

  it('names every refusal a client can meet', () => {
    expect([...MEDIA_REFUSALS].sort()).toEqual([
      'clip_too_long',
      'file_missing',
      'file_too_large',
      'file_type_mismatch',
      'file_type_not_allowed',
      'forbidden',
      'invalid_state',
      'job_handed_over',
      'job_not_in_work',
      'not_found',
      'storage_unavailable',
    ]);
  });

  it('holds the limits of the pipeline', () => {
    expect(MEDIA_LIMITS).toEqual({
      captionChars: 140,
      clipBytes: 100 * 1024 * 1024,
      clipSeconds: 60,
      clipShortSidePx: 720,
      clipToleranceSeconds: 1,
      conversionAttempts: 2,
      conversionTimeoutMs: 600_000,
      downloadUrlMinutes: 5,
      photoPx: 2048,
      thumbPx: 480,
      uploadUrlMinutes: 15,
    });
  });

  describe('an upload request', () => {
    it('takes a photo with no length and a clip with its seconds', () => {
      expect(failed(MediaUploadRequestDto, PHOTO)).toEqual([]);
      expect(failed(MediaUploadRequestDto, CLIP)).toEqual([]);
      expect(
        failed(MediaUploadRequestDto, { ...PHOTO, caption: 'x'.repeat(140) }),
      ).toEqual([]);
    });

    it.each(['live', 'video', '', undefined])('refuses the kind %p', (kind) => {
      expect(failed(MediaUploadRequestDto, { ...PHOTO, kind })).toEqual([
        'kind',
      ]);
    });

    it.each(['yPQ5Jg=', 'yPQ5Jh==', 'yPQ5Jg==x', '', 'yPQ5J!=='])(
      'refuses the checksum %p',
      (checksum) => {
        expect(failed(MediaUploadRequestDto, { ...PHOTO, checksum })).toEqual([
          'checksum',
        ]);
      },
    );

    it('refuses a request with no checksum', () => {
      const { checksum: _, ...body } = PHOTO;
      expect(failed(MediaUploadRequestDto, body)).toEqual(['checksum']);
    });

    it.each([0, -3, 4.5, '45', null, undefined])(
      'refuses a clip whose seconds are %p',
      (seconds) => {
        expect(failed(MediaUploadRequestDto, { ...CLIP, seconds })).toEqual([
          'seconds',
        ]);
      },
    );

    it('leaves a clip over 60 seconds to the service, which answers clip_too_long', () => {
      expect(failed(MediaUploadRequestDto, { ...CLIP, seconds: 61 })).toEqual(
        [],
      );
    });

    it('refuses seconds on a photo', () => {
      expect(failed(MediaUploadRequestDto, { ...PHOTO, seconds: 3 })).toEqual([
        'seconds',
      ]);
    });

    it('refuses a caption over 140 characters', () => {
      expect(
        failed(MediaUploadRequestDto, { ...PHOTO, caption: 'x'.repeat(141) }),
      ).toEqual(['caption']);
    });

    it.each([0, -1, 1.5])('refuses %p bytes', (sizeBytes) => {
      expect(failed(MediaUploadRequestDto, { ...PHOTO, sizeBytes })).toEqual([
        'sizeBytes',
      ]);
    });

    it('refuses a field the contract does not name', () => {
      expect(failed(MediaUploadRequestDto, { ...PHOTO, jobId: 'x' })).toEqual([
        'jobId',
      ]);
    });
  });

  describe('the file query', () => {
    it.each([{}, { variant: 'file' }, { variant: 'thumbnail' }])(
      'takes %p',
      (query) => {
        expect(failed(MediaFileQueryDto, query)).toEqual([]);
      },
    );

    it('refuses another variant', () => {
      expect(failed(MediaFileQueryDto, { variant: 'original' })).toEqual([
        'variant',
      ]);
    });
  });

  it('documents every field of the answers', () => {
    expect(listed(MediaItemDto.prototype).sort()).toEqual([
      'caption',
      'hasThumbnail',
      'id',
      'jobId',
      'kind',
      'removedAt',
      'seconds',
      'senderId',
      'sentAt',
      'status',
    ]);
    expect(listed(MediaUploadAddressDto.prototype).sort()).toEqual([
      'item',
      'upload',
    ]);
    expect(listed(MediaListDto.prototype)).toEqual(['items']);
    expect(listed(MediaFileAddressDto.prototype).sort()).toEqual([
      'expiresAt',
      'url',
    ]);
  });
});
