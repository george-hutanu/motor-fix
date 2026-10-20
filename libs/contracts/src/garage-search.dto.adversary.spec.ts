import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { GarageSearchQueryDto } from './garage-search.dto';
import { PublicLiveQueryDto } from './public-live.dto';

const BRAND = '9f1c2a7b-0000-4000-8000-000000000000';
const uuid = (n: number) =>
  `9f1c2a7b-0000-4000-8000-${String(n).padStart(12, '0')}`;
const list = (count: number) =>
  Array.from({ length: count }, (_, i) => uuid(i + 1)).join(',');

function search(query: Record<string, unknown>) {
  return validateSync(plainToInstance(GarageSearchQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) =>
    Object.keys(error.constraints ?? {}).map(() => error.property),
  );
}

function live(query: Record<string, unknown>) {
  return validateSync(plainToInstance(PublicLiveQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
}

describe('GarageSearchQueryDto under hostile input', () => {
  it('takes a brand slug of 80 characters and refuses 81', () => {
    expect(search({ brand: 'a'.repeat(80) })).toEqual([]);
    expect(search({ brand: 'a'.repeat(81) })).toContain('brand');
  });

  it.each(['', 'BMW', 'b m w', 'bmw/../x', 'bmw\n', 'ß', 'bmw,audi'])(
    'refuses the brand slug %j',
    (brand) => {
      expect(search({ brand })).toContain('brand');
    },
  );

  it('refuses a brand and a brandId together', () => {
    expect(search({ brand: 'bmw', brandId: BRAND })).not.toEqual([]);
  });

  it('refuses a brand given as null', () => {
    expect(search({ brand: null })).not.toEqual([]);
  });

  it('refuses ids given as null', () => {
    expect(search({ brand: 'bmw', ids: null })).toContain('ids');
  });

  it('refuses a brand key repeated into a list', () => {
    expect(search({ brand: ['bmw', 'audi'] })).not.toEqual([]);
  });

  it('refuses a brandId key repeated into a list', () => {
    expect(search({ brandId: [BRAND, BRAND] })).not.toEqual([]);
  });

  it('refuses an empty brand with an empty brandId', () => {
    expect(search({ brand: '', brandId: '' })).not.toEqual([]);
  });

  it.each([25, 50, '25', '50'])('takes the radius %j', (radius) => {
    expect(search({ brand: 'bmw', radius })).toEqual([]);
  });

  it.each([
    0,
    '0',
    24,
    26,
    51,
    100,
    -25,
    '',
    'abc',
    '25abc',
    null,
    [25, 50],
    '2.5e1',
    '0x19',
  ])('refuses the radius %j', (radius) => {
    expect(search({ brand: 'bmw', radius })).toContain('radius');
  });

  it('takes 20 different ids and refuses 21', () => {
    expect(search({ brand: 'bmw', ids: list(20) })).toEqual([]);
    expect(search({ brand: 'bmw', ids: list(21) })).toContain('ids');
  });

  it('takes a single id', () => {
    expect(search({ brand: 'bmw', ids: uuid(1) })).toEqual([]);
  });

  it('refuses an empty ids value', () => {
    expect(search({ brand: 'bmw', ids: '' })).toContain('ids');
  });

  it('refuses ids that repeat in another letter case', () => {
    const lower = uuid(1);
    expect(
      search({ brand: 'bmw', ids: `${lower},${lower.toUpperCase()}` }),
    ).toContain('ids');
  });

  it.each([
    ['a trailing comma', `${uuid(1)},`],
    ['a leading comma', `,${uuid(1)}`],
    ['a doubled comma', `${uuid(1)},,${uuid(2)}`],
    ['a space after the comma', `${uuid(1)}, ${uuid(2)}`],
    ['a non-uuid', `${uuid(1)},dacia`],
    ['a semicolon separator', `${uuid(1)};${uuid(2)}`],
    ['a newline', `${uuid(1)}\n${uuid(2)}`],
  ])('refuses ids with %s', (_name, ids) => {
    expect(search({ brand: 'bmw', ids })).toContain('ids');
  });

  it('refuses a repeated ids key', () => {
    expect(search({ brand: 'bmw', ids: [uuid(1), uuid(2)] })).toContain('ids');
  });

  it('refuses ids sent as a number', () => {
    expect(search({ brand: 'bmw', ids: 1 })).toContain('ids');
  });

  it.each(['0', 'true', '', '11', 1, true])('refuses log=%j', (log) => {
    expect(search({ brand: 'bmw', log })).toContain('log');
  });

  it('takes log=1', () => {
    expect(search({ brand: 'bmw', log: '1' })).toEqual([]);
  });

  it('takes a cursor of 256 characters and refuses 257', () => {
    expect(search({ brand: 'bmw', cursor: 'a'.repeat(256) })).toEqual([]);
    expect(search({ brand: 'bmw', cursor: 'a'.repeat(257) })).toContain(
      'cursor',
    );
  });

  it('refuses a cursor sent as a list', () => {
    expect(search({ brand: 'bmw', cursor: ['a', 'b'] })).toContain('cursor');
  });

  it('takes an empty cursor string', () => {
    expect(search({ brand: 'bmw', cursor: '' })).toEqual([]);
  });

  it.each([[12], [{}], [true]])('refuses a cursor of %j', (cursor) => {
    expect(search({ brand: 'bmw', cursor })).toContain('cursor');
  });

  it.each([
    ['an emoji', '😀'.repeat(128)],
    ['a space', 'abc def'],
    ['base64 padding', 'YWJj='],
    ['a plus', 'a+b'],
  ])('refuses a cursor holding %s, which no page answers', (_, cursor) => {
    expect(search({ brand: 'bmw', cursor })).toContain('cursor');
  });

  it('takes a base64url cursor of 256 characters', () => {
    expect(search({ brand: 'bmw', cursor: 'aZ0_-'.repeat(51) + 'x' })).toEqual(
      [],
    );
  });

  it('takes a cursor beside a list of ids', () => {
    expect(search({ brand: 'bmw', cursor: 'abc', ids: uuid(1) })).toEqual([]);
  });

  it('takes a place in Romania', () => {
    expect(search({ brand: 'bmw', near: '44.426,26.102' })).toEqual([]);
  });

  it.each([
    ['outside Romania', '48.858,2.352'],
    ['a space after the comma', '44.426, 26.102'],
    ['a third number', '44.426,26.102,5'],
    ['swapped coordinates', '26.102,44.426'],
    ['not numbers', 'a,b'],
    ['an exponent', '4.4e1,26.1'],
    ['a single number', '44.426'],
    ['an empty value', ''],
    ['the origin', '0,0'],
    ['a list', ['44.426,26.102', '44.5,26.1']],
  ])('refuses near %s', (_name, near) => {
    expect(search({ brand: 'bmw', near })).toContain('near');
  });
});

describe('PublicLiveQueryDto under hostile input', () => {
  it('takes no query at all', () => {
    expect(live({})).toEqual([]);
  });

  it('takes 20 different garages and refuses 21', () => {
    expect(live({ garages: list(20) })).toEqual([]);
    expect(live({ garages: list(21) })).toContain('garages');
  });

  it('refuses garages that repeat in another letter case', () => {
    expect(live({ garages: `${uuid(1)},${uuid(1).toUpperCase()}` })).toContain(
      'garages',
    );
  });

  it.each([
    '',
    ',',
    `${uuid(1)},`,
    `${uuid(1)}, ${uuid(2)}`,
    'x',
    ` ${uuid(1)}`,
  ])('refuses garages %j', (garages) => {
    expect(live({ garages })).toContain('garages');
  });

  it('refuses a repeated garages key', () => {
    expect(live({ garages: [uuid(1), uuid(2)] })).toContain('garages');
  });

  it('refuses garages given as null', () => {
    expect(live({ garages: null })).toContain('garages');
  });

  it('refuses a repeated brand key', () => {
    expect(live({ brand: [uuid(1), uuid(2)] })).toContain('brand');
  });

  it('refuses a repeated mechanics key', () => {
    expect(live({ mechanics: [uuid(1), uuid(2)] })).toContain('mechanics');
  });

  it('refuses a key it does not know', () => {
    expect(live({ garage: uuid(1) })).toContain('garage');
  });
});
