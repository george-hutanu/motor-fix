import {
  MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  RADIUS_KM,
  ROMANIA_BOUNDS,
} from '@motor-fix/contracts/place-section';

import { areaSql, kmOf, within } from './area-sql';

const POINT = { lat: 46.771, lng: 23.624 };
const BBOX = { east: 23.7, north: 46.8, south: 46.7, west: 23.5 };
const AT_POINT = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography';

// The statement text with its whitespace folded, as the database receives it.
const text = (fragment: { text: string }) =>
  fragment.text.replace(/\s+/g, ' ').trim();

// @traces 271-FR-010
describe('the area SQL', () => {
  it('measures metres on the sphere from the place to the garage position', () => {
    const { distance } = areaSql({ point: POINT });

    expect(text(distance)).toBe(
      `ST_Distance(garage.position, ${AT_POINT}, false)`,
    );
    expect(distance.values).toEqual([POINT.lng, POINT.lat]);
  });

  it('measures no distance for a visible area without a place', () => {
    const { distance } = areaSql({ bbox: BBOX });

    expect(text(distance)).toBe('NULL');
    expect(distance.values).toEqual([]);
  });

  it('orders by nearness to the centre of the visible area without a place', () => {
    const { nearness } = areaSql({ bbox: BBOX });

    expect(text(nearness)).toBe(
      `ST_Distance(garage.position, ${AT_POINT}, false)`,
    );
    expect(nearness.values).toEqual([23.6, 46.75]);
  });

  it('orders by nearness to the middle of Romania with neither place nor area', () => {
    const { distance, nearness } = areaSql({});

    expect(text(distance)).toBe('NULL');
    expect(nearness.values).toEqual([
      (ROMANIA_BOUNDS.lngMin + ROMANIA_BOUNDS.lngMax) / 2,
      (ROMANIA_BOUNDS.latMin + ROMANIA_BOUNDS.latMax) / 2,
    ]);
  });

  it('holds a fixed garage within 25 km of the place by default', () => {
    const { fixedIn } = areaSql({ point: POINT });

    expect(text(fixedIn)).toContain(
      `ST_DWithin(garage.position, ${AT_POINT}, $3, false)`,
    );
    expect(text(fixedIn)).toContain(
      "garage.business_kind IS DISTINCT FROM 'mobile'",
    );
    expect(fixedIn.values).toEqual([POINT.lng, POINT.lat, 25_000]);
  });

  it('holds a fixed garage within 50 km when the wider area is asked', () => {
    expect(areaSql({ point: POINT, radiusKm: 50 }).fixedIn.values).toEqual([
      POINT.lng,
      POINT.lat,
      50_000,
    ]);
  });

  it('holds a fixed garage inside the visible area, whatever the place', () => {
    const { fixedIn } = areaSql({ bbox: BBOX, point: POINT });

    expect(text(fixedIn)).toContain(
      'garage.latitude BETWEEN $1 AND $2 AND garage.longitude BETWEEN $3 AND $4',
    );
    expect(text(fixedIn)).not.toContain('ST_DWithin');
    expect(fixedIn.values).toEqual([46.7, 46.8, 23.5, 23.7]);
  });

  it('holds a mobile mechanic when its own service radius reaches the place', () => {
    const { mobileIn } = areaSql({ point: POINT, radiusKm: 50 });

    expect(text(mobileIn)).toContain("garage.business_kind = 'mobile'");
    expect(text(mobileIn)).toContain(
      'ST_Distance(garage.position, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, false) <= COALESCE(garage.service_radius_km, $6) * 1000',
    );
    expect(mobileIn.values).toEqual([
      POINT.lng,
      POINT.lat,
      RADIUS_KM.max * 1000,
      POINT.lng,
      POINT.lat,
      MOBILE_SERVICE_RADIUS_DEFAULT_KM,
    ]);
  });

  it('bounds the mobile mechanics by the widest service radius, so the position index can find them', () => {
    const { mobileIn } = areaSql({ point: POINT });

    expect(text(mobileIn)).toContain(
      `ST_DWithin(garage.position, ${AT_POINT}, $3, false) AND ST_Distance(`,
    );
  });

  it('holds no mobile mechanic for a visible area without a place', () => {
    expect(text(areaSql({ bbox: BBOX }).mobileIn)).toContain('FALSE');
  });

  it('holds every garage with a position when there is neither place nor area', () => {
    const { fixedIn, mobileIn } = areaSql({});

    expect(text(fixedIn)).toContain('garage.position IS NOT NULL');
    expect(text(fixedIn)).toContain('TRUE');
    expect(text(mobileIn)).toContain('garage.position IS NOT NULL');
    expect(text(mobileIn)).toContain('TRUE');
  });

  it('holds the fixed garages within the radius or the mobile ones that reach the place', () => {
    const where = within(areaSql({ point: POINT }));

    expect(text(where)).toMatch(/^\(\(.*ST_DWithin.*\) OR \(.*COALESCE.*\)\)$/);
    expect(where.values).toEqual([
      POINT.lng,
      POINT.lat,
      25_000,
      POINT.lng,
      POINT.lat,
      RADIUS_KM.max * 1000,
      POINT.lng,
      POINT.lat,
      MOBILE_SERVICE_RADIUS_DEFAULT_KM,
    ]);
  });

  it('binds every value instead of writing it into the text', () => {
    const area = areaSql({ bbox: BBOX, point: POINT, radiusKm: 50 });

    for (const fragment of [within(area), area.distance, area.nearness]) {
      expect(text(fragment)).not.toMatch(/46\.7|23\.6|50000/);
    }
  });
});

describe('the area beside the public scope', () => {
  it('holds every garage with no area, and the fixed or mobile ones of an area', () => {
    expect(text(within())).toBe('TRUE');
    expect(text(within(areaSql({ point: POINT })))).toMatch(
      /^\(\(garage\.business_kind IS DISTINCT FROM 'mobile'.*\) OR \(garage\.business_kind = 'mobile'.*\)\)$/,
    );
  });
});

describe('a distance in kilometres', () => {
  it.each([
    [0, 0],
    [1_049, 1],
    [1_050, 1.1],
    [2_430, 2.4],
    [24_960, 25],
  ])('reads %d m as %d km', (metres, km) => {
    expect(kmOf(metres)).toBe(km);
  });
});
