import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  galleryErrors,
  photoCaption,
  SaveGaragePhotosDto,
} from './garage-photos.dto';
import { GARAGE_PHOTO_CAPTION_MAX } from './garage-profile-limits';

// @traces 1249-FR-005 1249-FR-006

const GARAGE = '7b0c9a52-2f7e-4d55-9a0f-0d6c1a0e5c11';
const id = (n: number) =>
  `5e0a8f3b-91c2-4d7e-8b6a-${String(n).padStart(12, '0')}`;
const key = (n: number) => `garage_photo/${GARAGE}/${id(n)}`;

// What the global pipe would refuse, as it is configured.
const failed = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(SaveGaragePhotosDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((e) => e.property);

const fieldsOf = (photos: unknown) => galleryErrors(photos).map((e) => e.field);

describe('SaveGaragePhotosDto', () => {
  it('takes kept photos by id and uploads by key, in order, with captions', () => {
    expect(
      failed({
        photos: [
          { caption: 'Hala de reparații', id: id(1) },
          { key: key(2) },
          { caption: '', id: id(3) },
        ],
        version: '4',
      }),
    ).toEqual([]);
  });

  it('refuses a body without the stamp', () => {
    expect(failed({ photos: [{ id: id(1) }] })).toEqual(['version']);
  });

  it('refuses an empty gallery and one of more than twenty photos', () => {
    expect(failed({ photos: [], version: '1' })).toEqual(['photos']);
    const many = Array.from({ length: 21 }, (_, n) => ({ id: id(n) }));
    expect(failed({ photos: many, version: '1' })).toEqual(['photos']);
    const twenty = many.slice(0, 20);
    expect(failed({ photos: twenty, version: '1' })).toEqual([]);
  });

  it('refuses an entry the gallery rules refuse', () => {
    expect(
      failed({ photos: [{ id: id(1), key: key(1) }], version: '1' }),
    ).toEqual(['photos']);
  });
});

describe('the gallery rules, entry by entry', () => {
  it('names an entry with both an id and a key, and one with neither', () => {
    expect(
      fieldsOf([{ id: id(1) }, { id: id(2), key: key(2) }, { caption: 'x' }]),
    ).toEqual(['photos[1]', 'photos[2]']);
  });

  it('names the second of an id or a key sent twice', () => {
    expect(
      fieldsOf([
        { id: id(1) },
        { key: key(2) },
        { id: id(1) },
        { key: key(2) },
      ]),
    ).toEqual(['photos[2].id', 'photos[3].key']);
  });

  it('refuses an id that is not a uuid', () => {
    expect(fieldsOf([{ id: 'not-a-uuid' }])).toEqual(['photos[0].id']);
  });

  it.each([
    ['an incoming key', `incoming/garage_photo/${GARAGE}/${id(1)}`],
    ['another purpose', `legal_document/${GARAGE}/${id(1)}`],
    ['an owner of 36 dashes', `garage_photo/${'-'.repeat(36)}/${id(1)}`],
    ['a path climbing out', `garage_photo/${GARAGE}/../${id(1)}`],
    ['a number', 7],
  ])('refuses %s as a key', (_, bad) => {
    expect(fieldsOf([{ id: id(1) }, { key: bad }])).toEqual(['photos[1].key']);
  });

  it('counts a caption in code points after trimming', () => {
    expect(GARAGE_PHOTO_CAPTION_MAX).toBe(80);
    const emoji = '🚗'.repeat(80);
    expect(fieldsOf([{ caption: `  ${emoji}  `, id: id(1) }])).toEqual([]);
    expect(fieldsOf([{ caption: `${emoji}🚗`, id: id(1) }])).toEqual([
      'photos[0].caption',
    ]);
  });

  it.each([
    ['a line break', 'Hala\nnouă'],
    ['a tab', 'Hala\tnouă'],
    ['a null character', 'Hala\u0000'],
    ['a delete character', 'Hala\u007f'],
  ])('refuses a caption holding %s', (_, caption) => {
    expect(
      galleryErrors([{ caption, id: id(1) }]).map(({ code, field }) => ({
        code,
        field,
      })),
    ).toEqual([{ code: 'caption_invalid', field: 'photos[0].caption' }]);
  });

  it('refuses a caption that is not a string', () => {
    expect(fieldsOf([{ caption: 12, id: id(1) }])).toEqual([
      'photos[0].caption',
    ]);
  });

  it('refuses a list that is not one, or of entries that are not objects', () => {
    expect(fieldsOf('photos')).toEqual(['photos']);
    expect(fieldsOf([null])).toEqual(['photos[0]']);
  });
});

describe('photoCaption', () => {
  it('trims a caption and stores an empty one as none', () => {
    expect(photoCaption('  Hala de reparații  ')).toBe('Hala de reparații');
    expect(photoCaption('   ')).toBeNull();
    expect(photoCaption('')).toBeNull();
    expect(photoCaption(undefined)).toBeNull();
  });
});
