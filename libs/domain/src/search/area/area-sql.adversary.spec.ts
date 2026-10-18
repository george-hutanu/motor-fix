import { areaSql, kmOf, within } from './area-sql';
import type { Area } from './search-area';
import { publicGaragesSql } from '../../garages/public-garages/public-garages';
import { Prisma } from '../../generated/prisma/client';

const text = (fragment: { text: string }) =>
  fragment.text.replace(/\s+/g, ' ').trim();

const POINT = { lat: 46.771, lng: 23.624 };
const BBOX = { east: 23.7, north: 46.8, south: 46.7, west: 23.5 };

// @traces 271-FR-010
describe('the area SQL under hostile input', () => {
  it('gives every fragment as a Prisma.Sql', () => {
    const sql = areaSql({ point: POINT });

    for (const fragment of [
      sql.distance,
      sql.fixedIn,
      sql.mobileIn,
      sql.nearness,
      within(sql),
    ]) {
      expect(fragment).toBeInstanceOf(Prisma.Sql);
    }
  });

  it('measures nothing for a visible area without a place', () => {
    expect(text(areaSql({ bbox: BBOX }).distance)).toBe('NULL');
  });

  it('measures nothing without a place or an area', () => {
    expect(text(areaSql({}).distance)).toBe('NULL');
    expect(areaSql({}).distance.values).toEqual([]);
  });

  it('measures from a place on the equator and the meridian as from any other', () => {
    const { distance } = areaSql({ point: { lat: 0, lng: 0 } });

    expect(distance.values).toEqual([0, 0]);
    expect(text(distance)).toContain('ST_MakePoint($1, $2)');
  });

  it('keeps a radius of zero as zero metres', () => {
    expect(areaSql({ point: POINT, radiusKm: 0 }).fixedIn.values).toEqual([
      POINT.lng,
      POINT.lat,
      0,
    ]);
  });

  it('measures from the place, not the box, when both are given', () => {
    expect(areaSql({ bbox: BBOX, point: POINT }).distance.values).toEqual([
      POINT.lng,
      POINT.lat,
    ]);
  });

  it('holds a mobile mechanic by its radius when a place and a box are both given', () => {
    const { mobileIn } = areaSql({ bbox: BBOX, point: POINT });

    expect(text(mobileIn)).toContain('COALESCE(garage.service_radius_km');
    expect(text(mobileIn)).not.toBe('FALSE');
  });

  it('never writes a hostile value into the text', () => {
    const hostile = {
      lat: '1; DROP TABLE garage; --' as unknown as number,
      lng: "' OR 1=1 --" as unknown as number,
    };

    const area = areaSql({ point: hostile, radiusKm: 25 });
    const where = within(area);
    const { distance } = area;

    expect(text(where)).not.toMatch(/DROP|OR 1=1/);
    expect(text(distance)).not.toMatch(/DROP|OR 1=1/);
  });

  it('answers the same twice and leaves a frozen area as it was', () => {
    const area: Area = Object.freeze({
      bbox: Object.freeze({ ...BBOX }),
      point: Object.freeze({ ...POINT }),
      radiusKm: 50,
    });

    const first = within(areaSql(area));
    const second = within(areaSql(area));

    expect(text(second)).toBe(text(first));
    expect(second.values).toEqual(first.values);
  });

  it('numbers the placeholders of the public scope and the area without a gap', () => {
    const where = Prisma.sql`${publicGaragesSql} AND ${within(areaSql({ point: POINT }))}`;
    const numbers = [...text(where).matchAll(/\$(\d+)/g)].map((m) =>
      Number(m[1]),
    );

    expect(Math.max(...numbers)).toBe(where.values.length);
    expect(new Set(numbers).size).toBe(where.values.length);
  });

  it('holds everything for an area that is nothing', () => {
    expect(text(within())).toBe('TRUE');
  });
});

describe('a distance rounded to one decimal', () => {
  it.each([
    [3_250, 3.3],
    [150, 0.2],
    [250, 0.3],
    [50, 0.1],
    [49, 0],
    [1_150, 1.2],
    [999_950, 1000],
  ])('reads %d m as %d km, halves away from zero', (metres, km) => {
    expect(kmOf(metres)).toBe(km);
  });
});
