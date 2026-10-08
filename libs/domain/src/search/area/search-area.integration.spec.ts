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

describe('the area around a place', () => {
  it('holds a fixed garage 24.9 km away and not one 25.1 km away', async () => {
    const near = await garage({ at: 24_900, kind: 'company' });
    const far = await garage({ at: 25_100, kind: 'company' });

    const area = await garagesInArea(prisma, POINT);

    expect(area.has(near)).toBe(true);
    expect(area.has(far)).toBe(false);
  });

  it('holds a fixed garage on the 25 km line', async () => {
    const id = await garage({ at: 24_999.995 });

    expect((await garagesInArea(prisma, POINT)).has(id)).toBe(true);
  });

  it('treats a garage with no business kind as a fixed one', async () => {
    const near = await garage({ at: 1000 });
    const far = await garage({ at: 26_000 });

    const area = await garagesInArea(prisma, POINT);

    expect(area.get(near)).toEqual({
      distanceM: expect.closeTo(1000, 0),
      mobile: false,
    });
    expect(area.has(far)).toBe(false);
  });

  it('never holds a garage with no position', async () => {
    const id = await garage({ kind: 'company' });

    expect((await garagesInArea(prisma, POINT)).has(id)).toBe(false);
  });

  it.each(['draft', 'suspended'] as const)(
    'never holds a %s garage, however near',
    async (status) => {
      const id = await garage({ at: 100, status });

      expect((await garagesInArea(prisma, POINT)).has(id)).toBe(false);
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

      expect((await garagesInArea(prisma, POINT)).has(id)).toBe(inside);
    },
  );

  it('gives a mobile mechanic with no area of its own 20 km', async () => {
    const inside = await garage({ at: 19_000, kind: 'mobile' });
    const outside = await garage({ at: 21_000, kind: 'mobile' });

    const area = await garagesInArea(prisma, POINT);

    expect(area.has(inside)).toBe(true);
    expect(area.has(outside)).toBe(false);
  });

  it('never holds a mobile mechanic with no seat', async () => {
    const id = await garage({ kind: 'mobile', radiusKm: 100 });

    expect((await garagesInArea(prisma, POINT)).has(id)).toBe(false);
  });

  it('gives each garage its distance in metres and whether it comes to you, and nothing of where it is', async () => {
    const fixed = await garage({ at: 3200, kind: 'pfa' });
    const mobile = await garage({ at: 15_000, kind: 'mobile', radiusKm: 20 });

    const area = await garagesInArea(prisma, POINT);

    expect(area.get(fixed)).toEqual({
      distanceM: expect.closeTo(3200, 0),
      mobile: false,
    });
    expect(area.get(mobile)).toEqual({
      distanceM: expect.closeTo(15_000, 0),
      mobile: true,
    });
    expect(area.size).toBe(2);
  });
});
