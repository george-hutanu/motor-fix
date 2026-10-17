import { garagesInArea } from './search-area';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma } = fixtures();
serialDatabase(databaseUrl);

const POINT = { lat: 46.771, lng: 23.624 };
// Metres per degree of latitude on the sphere the area is measured on.
const METRES_PER_DEGREE = (6_371_008.8 * Math.PI) / 180;
const north = (metres: number) => ({
  latitude: POINT.lat + metres / METRES_PER_DEGREE,
  longitude: POINT.lng,
});

type Garage = {
  status?: 'draft' | 'approved' | 'suspended';
  at?: number;
  kind?: 'company' | 'pfa' | 'ii' | 'mobile';
  radiusKm?: number;
};

let made = 0;
async function garage({ at, kind, radiusKm, status = 'approved' }: Garage) {
  const slug = `garage-${++made}`;
  const { id } = await prisma.garage.create({
    data: {
      businessKind: kind,
      name: slug,
      serviceRadiusKm: radiusKm,
      slug,
      status,
      ...(at !== undefined && north(at)),
      ...(kind === 'mobile' && at !== undefined
        ? { seatAddress: 'Strada Sediului 1, Cluj-Napoca' }
        : {}),
    },
  });
  return id;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE garage CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

// @traces 267-FR-005
describe('the area around a place', () => {
  it('holds a fixed garage 24.9 km away and not one 25.1 km away', async () => {
    const near = await garage({ at: 24_900, kind: 'company' });
    const far = await garage({ at: 25_100, kind: 'company' });

    const area = await garagesInArea(prisma, { point: POINT });

    expect(area.has(near)).toBe(true);
    expect(area.has(far)).toBe(false);
  });

  it('holds a fixed garage on the 25 km line', async () => {
    const id = await garage({ at: 24_999.995 });

    expect((await garagesInArea(prisma, { point: POINT })).has(id)).toBe(true);
  });

  it('treats a garage with no business kind as a fixed one', async () => {
    const near = await garage({ at: 1000 });
    const far = await garage({ at: 26_000 });

    const area = await garagesInArea(prisma, { point: POINT });

    expect(area.get(near)).toEqual({
      distanceM: expect.closeTo(1000, 0),
      lat: north(1000).latitude,
      lng: POINT.lng,
      mobile: false,
    });
    expect(area.has(far)).toBe(false);
  });

  it('never holds a garage with no position', async () => {
    const id = await garage({ kind: 'company' });

    expect((await garagesInArea(prisma, { point: POINT })).has(id)).toBe(false);
  });

  it.each(['draft', 'suspended'] as const)(
    'never holds a %s garage, however near',
    async (status) => {
      const id = await garage({ at: 100, status });

      expect((await garagesInArea(prisma, { point: POINT })).has(id)).toBe(
        false,
      );
    },
  );

  it.each([
    ['15 km away with a 20 km area', 15_000, 20, true],
    ['5 km away with a 3 km area', 5000, 3, false],
    ['30 km away with a 35 km area', 30_000, 35, true],
    ['on the edge of its 10 km area', 9_999.995, 10, true],
  ])(
    'judges a mobile mechanic %s by its own area',
    async (_, at, radiusKm, inside) => {
      const id = await garage({ at, kind: 'mobile', radiusKm });

      expect((await garagesInArea(prisma, { point: POINT })).has(id)).toBe(
        inside,
      );
    },
  );

  it('gives a mobile mechanic with no area of its own 20 km', async () => {
    const inside = await garage({ at: 19_000, kind: 'mobile' });
    const outside = await garage({ at: 21_000, kind: 'mobile' });

    const area = await garagesInArea(prisma, { point: POINT });

    expect(area.has(inside)).toBe(true);
    expect(area.has(outside)).toBe(false);
  });

  it('never holds a mobile mechanic with no seat', async () => {
    const id = await garage({ kind: 'mobile', radiusKm: 100 });

    expect((await garagesInArea(prisma, { point: POINT })).has(id)).toBe(false);
  });

  it('gives each garage its distance in metres, its position and whether it comes to you', async () => {
    const fixed = await garage({ at: 3200, kind: 'pfa' });
    const mobile = await garage({ at: 15_000, kind: 'mobile', radiusKm: 20 });

    const area = await garagesInArea(prisma, { point: POINT });

    expect(area.get(fixed)).toEqual({
      distanceM: expect.closeTo(3200, 0),
      lat: north(3200).latitude,
      lng: POINT.lng,
      mobile: false,
    });
    expect(area.get(mobile)).toEqual({
      distanceM: expect.closeTo(15_000, 0),
      lat: north(15_000).latitude,
      lng: POINT.lng,
      mobile: true,
    });
    expect(area.size).toBe(2);
  });
});

// @traces 267-FR-005
describe('the area at a wider radius', () => {
  it('holds a fixed garage 49.9 km away at 50 km and not one 50.1 km away', async () => {
    const near = await garage({ at: 49_900, kind: 'company' });
    const far = await garage({ at: 50_100, kind: 'company' });

    const area = await garagesInArea(prisma, { point: POINT, radiusKm: 50 });

    expect(area.has(near)).toBe(true);
    expect(area.has(far)).toBe(false);
  });

  it('leaves a mobile mechanic to its own area at 50 km', async () => {
    const outside = await garage({ at: 30_000, kind: 'mobile', radiusKm: 20 });
    const inside = await garage({ at: 30_000, kind: 'mobile', radiusKm: 35 });

    const area = await garagesInArea(prisma, { point: POINT, radiusKm: 50 });

    expect(area.has(outside)).toBe(false);
    expect(area.has(inside)).toBe(true);
  });
});

// A box from 10 km south of the place to 30 km north of it, 0.2° of
// longitude wide, the place inside it near its southern edge.
const BOX = {
  east: POINT.lng + 0.1,
  north: north(30_000).latitude,
  south: north(-10_000).latitude,
  west: POINT.lng - 0.1,
};
const east = (metresNorth: number, degreesEast: number) => ({
  latitude: north(metresNorth).latitude,
  longitude: POINT.lng + degreesEast,
});

// @traces 269-FR-004 269-FR-005
describe('the area of a box on the map', () => {
  it('holds the fixed garages inside the box and none outside, whatever the radius', async () => {
    const inside = await garage({ at: 28_000, kind: 'company' });
    const south = await garage({ at: -9000 });
    const above = await garage({ at: 31_000, kind: 'company' });
    const below = await garage({ at: -11_000, kind: 'company' });

    const area = await garagesInArea(prisma, {
      bbox: BOX,
      point: POINT,
      radiusKm: 25,
    });

    expect(area.has(inside)).toBe(true);
    expect(area.has(south)).toBe(true);
    expect(area.has(above)).toBe(false);
    expect(area.has(below)).toBe(false);
  });

  it('leaves out a fixed garage east or west of the box', async () => {
    const { id } = await prisma.garage.create({
      data: { name: 'east', slug: 'east', status: 'approved', ...east(0, 0.2) },
    });

    expect(
      (await garagesInArea(prisma, { bbox: BOX, point: POINT })).has(id),
    ).toBe(false);
  });

  it('finds a mobile mechanic by its own area around the place, not by the box', async () => {
    // Its seat is inside the box but its 5 km area does not reach the place.
    const seatInBox = await garage({ at: 20_000, kind: 'mobile', radiusKm: 5 });
    // Its seat is outside the box but its 40 km area holds the place.
    const reaching = await garage({
      at: -35_000,
      kind: 'mobile',
      radiusKm: 40,
    });

    const area = await garagesInArea(prisma, { bbox: BOX, point: POINT });

    expect(area.has(seatInBox)).toBe(false);
    expect(area.get(reaching)).toMatchObject({ mobile: true });
  });

  it('finds no mobile mechanic in a box without a place', async () => {
    const id = await garage({ at: 1000, kind: 'mobile', radiusKm: 50 });
    const fixed = await garage({ at: 1000, kind: 'company' });

    const area = await garagesInArea(prisma, { bbox: BOX });

    expect(area.has(id)).toBe(false);
    expect(area.has(fixed)).toBe(true);
  });

  it('measures from the place when there is one, else from the centre of the box', async () => {
    const id = await garage({ at: 10_000, kind: 'company' });

    const fromPlace = await garagesInArea(prisma, { bbox: BOX, point: POINT });
    const fromCentre = await garagesInArea(prisma, { bbox: BOX });

    expect(fromPlace.get(id)?.distanceM).toBeCloseTo(10_000, 0);
    expect(fromCentre.get(id)?.distanceM).toBeLessThan(100);
  });

  it('gives each garage in the box its position', async () => {
    const id = await garage({ at: 5000, kind: 'company' });

    expect((await garagesInArea(prisma, { bbox: BOX })).get(id)).toEqual({
      distanceM: expect.any(Number),
      lat: north(5000).latitude,
      lng: POINT.lng,
      mobile: false,
    });
  });

  it.each(['draft', 'suspended'] as const)(
    'never holds a %s garage inside the box',
    async (status) => {
      const id = await garage({ at: 1000, status });

      expect((await garagesInArea(prisma, { bbox: BOX })).has(id)).toBe(false);
    },
  );
});

// @traces 269-FR-004
describe('the area with neither a place nor a box', () => {
  it('holds every approved garage with a position, the mobile mechanics too, and none without one', async () => {
    const far = await garage({ at: 300_000, kind: 'company' });
    const mobile = await garage({ at: 200_000, kind: 'mobile', radiusKm: 5 });
    const nowhere = await garage({ kind: 'company' });
    const draft = await garage({ at: 0, status: 'draft' });

    const area = await garagesInArea(prisma, {});

    expect(area.has(far)).toBe(true);
    expect(area.get(mobile)).toMatchObject({ mobile: true });
    expect(area.has(nowhere)).toBe(false);
    expect(area.has(draft)).toBe(false);
  });
});
