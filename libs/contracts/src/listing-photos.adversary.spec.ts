import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { isListingDraftData } from './listing-drafts.dto';
import { hasConfirmedPhoto } from './listing-photos';
import { ConfirmPhotoDto, PhotoUploadRequestDto } from './listing-photos.dto';

const OWNER = '7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00';
const ID = '5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1a37';
const check = async <T extends object>(cls: new () => T, value: unknown) =>
  (await validate(plainToInstance(cls, value) as object)).map(
    (e) => e.property,
  );

describe('the upload request', () => {
  it('accepts a plain request', async () => {
    expect(
      await check(PhotoUploadRequestDto, {
        contentType: 'image/jpeg',
        size: 1,
      }),
    ).toEqual([]);
  });

  it.each([
    ['a zero size', { contentType: 'image/jpeg', size: 0 }],
    ['a negative size', { contentType: 'image/jpeg', size: -5 }],
    ['a fractional size', { contentType: 'image/jpeg', size: 1.5 }],
    ['a size sent as text', { contentType: 'image/jpeg', size: '100' }],
    ['a null size', { contentType: 'image/jpeg', size: null }],
    ['an infinite size', { contentType: 'image/jpeg', size: Infinity }],
    ['a missing size', { contentType: 'image/jpeg' }],
    ['a numeric type', { contentType: 5, size: 1 }],
    ['a missing type', { size: 1 }],
    ['a 101 character type', { contentType: 'x'.repeat(101), size: 1 }],
  ])('refuses %s', async (_, body) => {
    expect(await check(PhotoUploadRequestDto, body)).toHaveLength(1);
  });

  it('accepts a 100 character type, the boundary', async () => {
    expect(
      await check(PhotoUploadRequestDto, {
        contentType: 'x'.repeat(100),
        size: 1,
      }),
    ).toEqual([]);
  });
});

describe('the confirm body', () => {
  it.each([
    ['a missing key', {}],
    ['a null key', { key: null }],
    ['a numeric key', { key: 7 }],
    ['an array key', { key: ['a'] }],
    ['a 201 character key', { key: 'k'.repeat(201) }],
  ])('refuses %s', async (_, body) => {
    expect(await check(ConfirmPhotoDto, body)).toEqual(['key']);
  });

  it('accepts a 200 character key, the boundary', async () => {
    expect(await check(ConfirmPhotoDto, { key: 'k'.repeat(200) })).toEqual([]);
  });
});

describe('the file keys a draft may hold', () => {
  it.each([
    ['an id of 64 characters', `garage_photo/${OWNER}/${'a'.repeat(64)}`, true],
    [
      'an id of 65 characters',
      `garage_photo/${OWNER}/${'a'.repeat(65)}`,
      false,
    ],
    ['an empty id', `garage_photo/${OWNER}/`, false],
    ['a trailing newline', `garage_photo/${OWNER}/${ID}\n`, false],
    ['a leading space', ` garage_photo/${OWNER}/${ID}`, false],
    ['a nested path', `garage_photo/${OWNER}/a/${ID}`, false],
    ['an upper-case owner', `garage_photo/${OWNER.toUpperCase()}/${ID}`, false],
    ['a non-ASCII id', `garage_photo/${OWNER}/${'é'}x`, false],
    [
      'a full-width digit owner',
      `garage_photo/${'１'.repeat(36)}/${ID}`,
      false,
    ],
    ['a dot in the id', `garage_photo/${OWNER}/${ID}.thumb`, false],
    ['an empty string', '', false],
  ])('%s', (_, key, accepted) => {
    expect(isListingDraftData({ files: [key] })).toBe(accepted);
  });

  it.each([
    ['null', null],
    ['a string', `garage_photo/${OWNER}/${ID}`],
    ['an object', { 0: `garage_photo/${OWNER}/${ID}` }],
  ])('refuses files given as %s', (_, files) => {
    expect(isListingDraftData({ files })).toBe(false);
  });

  it.each([
    ['a number', 5],
    ['null', null],
    ['an array', [`garage_photo/${OWNER}/${ID}`]],
  ])('refuses a key given as %s', (_, key) => {
    expect(isListingDraftData({ files: [key] })).toBe(false);
  });

  it('accepts an empty list', () => {
    expect(isListingDraftData({ files: [] })).toBe(true);
  });

  it('refuses an extra field next to files', () => {
    expect(isListingDraftData({ files: [], photos: [] })).toBe(false);
  });
});

describe('step 5 completeness for photos, hostile data', () => {
  it('is not met when files is null', () => {
    expect(hasConfirmedPhoto({ files: null } as never)).toBe(false);
  });

  it('is not met when files is an empty string', () => {
    expect(hasConfirmedPhoto({ files: '' } as never)).toBe(false);
  });
});
