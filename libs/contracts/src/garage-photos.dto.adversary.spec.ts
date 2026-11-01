import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { galleryErrors, SaveGaragePhotosDto } from './garage-photos.dto';
import { isFileKey, isListingDraftData } from './listing-sections';

const GARAGE = '7b0c9a52-2f7e-4d55-9a0f-0d6c1a0e5c11';
const id = (n: number) =>
  `5e0a8f3b-91c2-4d7e-8b6a-${String(n).padStart(12, '0')}`;
const LETTERS = 'abcdefab-91c2-4d7e-8b6a-abcdefabcdef';
const key = (n: number) => `garage_photo/${GARAGE}/${id(n)}`;

const failed = (body: unknown) =>
  validateSync(plainToInstance(SaveGaragePhotosDto, body as object), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((e) => e.property);

const fieldsOf = (photos: unknown) => galleryErrors(photos).map((e) => e.field);

// @traces 1249-FR-005 1249-FR-006
describe('the gallery save under hostile bodies', () => {
  it.each([
    ['an object', { 0: { id: id(1) }, length: 1 }],
    ['a string', 'photos'],
    ['null', null],
    ['a number', 1],
  ])('refuses photos given as %s', (_, photos) => {
    expect(failed({ photos, version: '1' })).toContain('photos');
  });

  it.each([
    ['a number', 4],
    ['null', null],
    ['an empty string', ''],
    ['twenty-one characters', '1'.repeat(21)],
  ])('refuses a version of %s', (_, version) => {
    expect(failed({ photos: [{ id: id(1) }], version })).toEqual(['version']);
  });

  it('takes a version of exactly twenty characters', () => {
    expect(
      failed({ photos: [{ id: id(1) }], version: '1'.repeat(20) }),
    ).toEqual([]);
  });

  it('refuses ten thousand entries without naming each', () => {
    const many = Array.from({ length: 10_000 }, (_, n) => ({ id: id(n) }));

    expect(failed({ photos: many, version: '1' })).toEqual(['photos']);
  });

  it('refuses a twenty-first entry that is a repeat of the first', () => {
    const photos = Array.from({ length: 20 }, (_, n) => ({ id: id(n) }));
    photos.push({ id: id(0) });

    expect(failed({ photos, version: '1' })).toEqual(['photos']);
  });

  it('refuses an unknown top-level field', () => {
    expect(
      failed({ owner: 'x', photos: [{ id: id(1) }], version: '1' }),
    ).toEqual(['owner']);
  });

  it('refuses a position sent on an entry', () => {
    expect(fieldsOf([{ id: id(1), position: 0 }])).toEqual(['photos[0]']);
  });

  it('refuses a __proto__ field smuggled on an entry', () => {
    const entry = JSON.parse(`{"id":"${id(1)}","__proto__":{"key":"x"}}`);

    expect(fieldsOf([entry])).toEqual(['photos[0]']);
  });

  it('refuses an id sent twice in different letter case', () => {
    expect(fieldsOf([{ id: LETTERS }, { id: LETTERS.toUpperCase() }])).toEqual([
      'photos[1].id',
    ]);
  });

  it('refuses a key whose name differs only in letter case', () => {
    expect(
      fieldsOf([
        { key: `garage_photo/${GARAGE}/${LETTERS}` },
        { key: `garage_photo/${GARAGE}/${LETTERS.toUpperCase()}` },
      ]),
    ).toEqual([]);
  });

  it.each([
    ['null id with a key', { id: null, key: key(1) }],
    ['an empty id', { id: '' }],
    ['an array id', { id: [id(1)] }],
    ['a null key alone', { key: null }],
    ['an empty key', { key: '' }],
  ])('refuses %s', (_, entry) => {
    expect(fieldsOf([entry]).length).toBeGreaterThan(0);
  });

  it('reports an invalid reference and an invalid caption of one entry', () => {
    expect(fieldsOf([{ caption: 'a\nb', id: 'nope' }])).toEqual([
      'photos[0].id',
      'photos[0].caption',
    ]);
  });

  it('takes a caption of exactly eighty characters and refuses eighty-one', () => {
    expect(fieldsOf([{ caption: 'a'.repeat(80), id: id(1) }])).toEqual([]);
    expect(fieldsOf([{ caption: 'a'.repeat(81), id: id(1) }])).toEqual([
      'photos[0].caption',
    ]);
  });

  it('trims a no-break space before counting', () => {
    expect(fieldsOf([{ caption: ` ${'a'.repeat(80)} `, id: id(1) }])).toEqual(
      [],
    );
  });

  it.each([
    ['a next-line character', 'Hala\u0085noua'],
    ['a C1 control', 'Hala\u009fnoua'],
    ['an escape', 'Hala\u001bnoua'],
    ['a carriage return inside', 'Hala\rnoua'],
  ])('refuses a caption holding %s', (_, caption) => {
    expect(fieldsOf([{ caption, id: id(1) }])).toEqual(['photos[0].caption']);
  });

  it('takes a caption that is only blanks, a null one and an absent one', () => {
    expect(
      fieldsOf([
        { caption: '   ', id: id(1) },
        { caption: null, id: id(2) },
        { id: id(3) },
      ]),
    ).toEqual([]);
  });

  it('counts an astral caption of eighty code points once, not twice', () => {
    expect(fieldsOf([{ caption: '𝒜'.repeat(80), id: id(1) }])).toEqual([]);
  });
});

// @traces 1249-FR-018
describe('the strict file-key pattern', () => {
  const name64 = 'a'.repeat(64);

  it.each([
    ['a 64-character name', `garage_photo/${GARAGE}/${name64}`, true],
    ['a 65-character name', `garage_photo/${GARAGE}/${name64}a`, false],
    ['an empty name', `garage_photo/${GARAGE}/`, false],
    ['a trailing newline', `garage_photo/${GARAGE}/${id(1)}\n`, false],
    ['a leading slash', `/garage_photo/${GARAGE}/${id(1)}`, false],
    ['a fourth segment', `garage_photo/${GARAGE}/${id(1)}/x`, false],
    ['an incoming prefix', `incoming/garage_photo/${GARAGE}/${id(1)}`, false],
    ['a 36-dash owner', `garage_photo/${'-'.repeat(36)}/${id(1)}`, false],
    [
      'Arabic-Indic digits in the owner',
      `garage_photo/${GARAGE.replace('7b0c9a52', '٧٧٧٧٧٧٧٧')}/${id(1)}`,
      false,
    ],
    ['a name with a dot', `garage_photo/${GARAGE}/a.b`, false],
    ['a name with a space', `garage_photo/${GARAGE}/a b`, false],
    ['a full-width name', `garage_photo/${GARAGE}/ａｂ`, false],
    ['an owner with a trailing dash', `garage_photo/${GARAGE}-/x`, false],
    ['a digit in the purpose', `garage2/${GARAGE}/x`, false],
  ])('%s', (_, candidate, expected) => {
    expect(isFileKey(candidate)).toBe(expected);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array holding a key', [key(1)]],
    ['a String object', new String(key(1))],
  ])('refuses %s as a key', (_, candidate) => {
    expect(isFileKey(candidate)).toBe(false);
  });
});

// @traces 1249-FR-018
describe("the draft envelope's files under hostile input", () => {
  const files = (value: unknown) => isListingDraftData({ files: value });

  it.each([
    ['a string', key(1)],
    ['an object', { 0: key(1) }],
    ['null', null],
    ['a number', 1],
  ])('refuses files given as %s', (_, value) => {
    expect(files(value)).toBe(false);
  });

  it('takes an empty files list', () => {
    expect(files([])).toBe(true);
  });

  it('refuses ten thousand keys', () => {
    expect(files(Array.from({ length: 10_000 }, (_, n) => key(n)))).toBe(false);
  });

  it('refuses twenty keys with one 36-dash owner among them', () => {
    const keys = Array.from({ length: 19 }, (_, n) => key(n));
    keys.push(`garage_photo/${'-'.repeat(36)}/x`);

    expect(files(keys)).toBe(false);
  });

  it('refuses one key twice among twenty', () => {
    const keys = Array.from({ length: 19 }, (_, n) => key(n));
    keys.push(key(0));

    expect(files(keys)).toBe(false);
  });
});
