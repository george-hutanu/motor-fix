import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { GaragePinsQueryDto, GarageSearchQueryDto } from './garage-search.dto';
import { ROMANIA_BOUNDS } from './place-section';
import {
  bboxOf,
  bboxSideKm,
  clampBbox,
  parseBbox,
  SEARCH_BBOX_MAX_KM,
} from './search-place';

const BBOX_MESSAGE =
  'bbox must be south,west,north,east inside Romania, at most 100 km wide';

const check = (
  dto: typeof GaragePinsQueryDto | typeof GarageSearchQueryDto,
  query: Record<string, unknown>,
) =>
  validateSync(plainToInstance(dto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));

// @traces 269-FR-005
describe.each([
  ['pins', GaragePinsQueryDto],
  ['list', GarageSearchQueryDto],
] as const)('the %s bbox under hostile input', (_name, dto) => {
  const refused = (bbox: unknown) =>
    check(dto, { bbox, brand: 'bmw' }).includes(BBOX_MESSAGE);

  it.each([
    ['an empty string', ''],
    ['null', null],
    ['a number', 44.35],
    ['an object', { south: 44.35 }],
    ['an array of four numbers', [44.35, 26, 44.5, 26.25]],
    ['a leading space', ' 44.35,26,44.5,26.25'],
    ['a space after a comma', '44.35, 26,44.5,26.25'],
    ['a trailing newline', '44.35,26,44.5,26.25\n'],
    ['a trailing comma', '44.35,26,44.5,26.25,'],
    ['a plus sign', '+44.35,26,44.5,26.25'],
    ['a bare leading dot', '.35,26,44.5,26.25'],
    ['a bare trailing dot', '44.,26,44.5,26.25'],
    ['exponent notation', '4.435e1,26,44.5,26.25'],
    ['NaN', 'NaN,26,44.5,26.25'],
    ['Infinity', '44.35,26,44.5,Infinity'],
    ['arabic-indic digits', '٤٤.٣٥,26,44.5,26.25'],
    ['fullwidth digits', '４４.35,26,44.5,26.25'],
    ['a decimal comma', '44,35,26,44,5,26,25'],
    ['semicolons', '44.35;26;44.5;26.25'],
    ['a negative latitude', '-44.35,26,-44.2,26.25'],
    ['a negative longitude', '44.35,-26,44.5,-25.75'],
    ['a zero box', '0,0,0,0'],
    ['a world box', '-90,-180,90,180'],
    ['a box that is a point', '44.4,26.1,44.4,26.1'],
    ['corners that round to one longitude', '44.35,26.0001,44.5,26.0004'],
    ['corners that round to one latitude', '44.4001,26,44.4004,26.25'],
    ['a ten-thousand-character string', '9'.repeat(10_000)],
    ['ten thousand commas', ','.repeat(10_000)],
    ['a script tag', '<script>alert(1)</script>'],
    ['a SQL fragment', "44.35,26,44.5,26.25');DROP TABLE garage;--"],
  ])('refuses %s', (_case, bbox) => {
    expect(refused(bbox)).toBe(true);
  });

  it('rounds a latitude with thousands of decimals instead of refusing it', () => {
    expect(
      check(dto, {
        bbox: `44.${'3'.repeat(5000)},26,44.5,26.25`,
        brand: 'bmw',
      }),
    ).toEqual([]);
  });

  it('refuses a box that crosses the southern bound of Romania', () => {
    expect(refused('43.4,26,43.6,26.25')).toBe(true);
  });

  it('refuses a box that crosses the northern bound of Romania', () => {
    expect(refused('48.3,26,48.5,26.25')).toBe(true);
  });

  it('refuses a box that crosses the western bound of Romania', () => {
    expect(refused('45,20.1,45.1,20.3')).toBe(true);
  });

  it('refuses a box that crosses the eastern bound of Romania', () => {
    expect(refused('45,29.7,45.1,29.9')).toBe(true);
  });

  it('takes a box whose corners sit exactly on the bounds of Romania', () => {
    expect(check(dto, { bbox: '43.5,20.2,43.6,20.3', brand: 'bmw' })).toEqual(
      [],
    );
    expect(check(dto, { bbox: '48.3,29.7,48.4,29.8', brand: 'bmw' })).toEqual(
      [],
    );
  });

  it('takes a corner that only rounds onto the bound', () => {
    expect(check(dto, { bbox: '43.4996,26,43.6,26.25', brand: 'bmw' })).toEqual(
      [],
    );
  });

  it('refuses a corner that rounds off the bound', () => {
    expect(refused('43.4994,26,43.6,26.25')).toBe(true);
  });

  it('takes a box 100 km tall and refuses one a metre more', () => {
    const degrees = 100 / 111.32;
    const south = 44.0;
    const north = Math.floor((south + degrees) * 1000) / 1000;
    expect(
      bboxSideKm({ east: 26.1, north, south, west: 26 }),
    ).toBeLessThanOrEqual(SEARCH_BBOX_MAX_KM);
    expect(
      check(dto, { bbox: `${south},26,${north},26.1`, brand: 'bmw' }),
    ).toEqual([]);
    expect(refused(`${south},26,${north + 0.001},26.1`)).toBe(true);
  });

  it('refuses a box too wide on its southern edge even when its northern edge is under the cap', () => {
    expect(refused('43.6,20.2,48.3,29.7')).toBe(true);
  });

  it('refuses the whole of Romania as one box', () => {
    expect(refused('43.5,20.2,48.4,29.8')).toBe(true);
  });

  it('refuses a box with bbox given beside a bad brand without hiding the box error', () => {
    expect(check(dto, { bbox: 'x', brand: 'BMW' }).includes(BBOX_MESSAGE)).toBe(
      true,
    );
  });

  it('ignores an unrelated bad radius being swallowed by a good box', () => {
    expect(
      check(dto, { bbox: '44.35,26,44.5,26.25', brand: 'bmw', radius: '30' }),
    ).not.toEqual([]);
  });

  it('refuses a bbox of an unknown key spelling', () => {
    expect(
      check(dto, { BBOX: '44.35,26,44.5,26.25', brand: 'bmw' }),
    ).not.toEqual([]);
  });
});

// @traces 269-FR-005
describe('reading the visible area', () => {
  it.each([
    ['a trailing newline', '44.35,26,44.5,26.25\n'],
    ['a leading space', ' 44.35,26,44.5,26.25'],
    ['a plus sign', '+44.35,26,44.5,26.25'],
    ['a lone dot', '.,26,44.5,26.25'],
    ['arabic-indic digits', '٤٤.٣٥,26,44.5,26.25'],
    ['a long run of digits', '9'.repeat(100_000)],
  ])('reads no box from %s', (_case, text) => {
    expect(parseBbox(text)).toBeUndefined();
  });

  it('reads a negative number and keeps its sign', () => {
    expect(parseBbox('-1,-2,3,4')).toEqual({
      east: 4,
      north: 3,
      south: -1,
      west: -2,
    });
  });

  it('does not turn a negative zero into a different box text', () => {
    expect(bboxOf({ east: 1, north: 1, south: -0.0004, west: 0 })).toBe(
      '0,0,1,1',
    );
  });

  it('writes then reads a box back to the same box', () => {
    const box = { east: 26.25, north: 44.5, south: 44.35, west: 26 };
    expect(parseBbox(bboxOf(box))).toEqual(box);
  });

  it('reads the same box twice to the same answer', () => {
    expect(parseBbox('44.35,26,44.5,26.25')).toEqual(
      parseBbox('44.35,26,44.5,26.25'),
    );
  });

  it('gives a width of zero for a box one longitude wide of nothing', () => {
    expect(bboxSideKm({ east: 26, north: 44, south: 44, west: 26 })).toBe(0);
  });

  it('gives the same width whichever side is longer', () => {
    const tall = bboxSideKm({ east: 26.01, north: 45.1, south: 44, west: 26 });
    expect(tall).toBeCloseTo(1.1 * 111.32, 1);
  });

  it('gives no box when the clamp leaves a line', () => {
    expect(
      clampBbox(
        { east: 26.25, north: 43.5, south: 43, west: 26 },
        ROMANIA_BOUNDS,
      ),
    ).toBeUndefined();
  });

  it('gives no box when a box only touches the east bound from outside', () => {
    expect(
      clampBbox({ east: 31, north: 46, south: 45, west: 29.8 }, ROMANIA_BOUNDS),
    ).toBeUndefined();
  });

  it('gives no box for an inverted box', () => {
    expect(
      clampBbox(
        { east: 26, north: 44.35, south: 44.5, west: 26.25 },
        ROMANIA_BOUNDS,
      ),
    ).toBeUndefined();
  });

  it('gives no box for a box with a NaN corner', () => {
    expect(
      clampBbox(
        { east: 26.25, north: Number.NaN, south: 44.35, west: 26 },
        ROMANIA_BOUNDS,
      ),
    ).toBeUndefined();
  });
});
