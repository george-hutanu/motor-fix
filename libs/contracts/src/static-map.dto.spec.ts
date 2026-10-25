import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { STATIC_MAP_CACHE_CONTROL, StaticMapQueryDto } from './static-map.dto';

const VALID = {
  h: '480',
  lat: '44.42681',
  lng: '26.10254',
  theme: 'light',
  w: '640',
  z: '13',
};

// The fields a query is refused on, as the API's validation reads it.
function refused(query: Record<string, unknown>) {
  return validateSync(plainToInstance(StaticMapQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
}

// @traces 1196-FR-001 1196-FR-003 1196-FR-005
describe('StaticMapQueryDto', () => {
  it('takes a view in Romania at a bucket size', () => {
    expect(refused(VALID)).toEqual([]);
  });

  it('reads the numbers of a valid query as numbers', () => {
    const query = plainToInstance(StaticMapQueryDto, VALID);

    expect(query).toMatchObject({
      h: 480,
      lat: 44.42681,
      lng: 26.10254,
      theme: 'light',
      w: 640,
      z: 13,
    });
  });

  it.each([
    ['theme', 'sepia'],
    ['theme', undefined],
    ['z', '4'],
    ['z', '17'],
    ['z', '13.5'],
    ['z', '1e1'],
    ['z', undefined],
    ['lat', '43.4'],
    ['lat', '48.5'],
    ['lat', 'north'],
    ['lat', undefined],
    ['lng', '20.1'],
    ['lng', '29.9'],
    ['lng', '0x1a'],
    ['w', '500'],
    ['w', '2560'],
    ['w', undefined],
    ['h', '100'],
    ['h', '640.5'],
  ])('refuses %s of %s, naming it', (field, value) => {
    expect(refused({ ...VALID, [field]: value })).toEqual([field]);
  });

  it('refuses a size above 1280 by 1024, naming the height', () => {
    expect(refused({ ...VALID, h: '1280', w: '1280' })).toEqual(['h']);
    expect(refused({ ...VALID, h: '1024', w: '1280' })).toEqual([]);
  });

  it('refuses a parameter it does not know', () => {
    expect(refused({ ...VALID, scale: '2' })).toEqual(['scale']);
  });
});

describe('the static map cache policy', () => {
  it('keeps an image a day in the browser and a month at the edge', () => {
    expect(STATIC_MAP_CACHE_CONTROL).toBe(
      'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800, stale-if-error=604800',
    );
  });
});
