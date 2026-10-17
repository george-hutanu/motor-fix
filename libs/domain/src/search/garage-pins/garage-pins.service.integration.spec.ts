import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { GaragePinsService } from './garage-pins.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import type { GarageSearchCache } from '../garage-search/garage-search.cache';
import { GarageSearchService } from '../garage-search/garage-search.service';
import { SearchLogService } from '../search-log/search-log.service';

const { prisma } = fixtures();
// PostgreSQL's answer every time; garage-search.cache.integration.spec.ts
// covers the cache.
const uncached = {
  entry: (_key, read) => read(),
} satisfies Pick<GarageSearchCache, 'entry'> as unknown as GarageSearchCache;
const pins = new GaragePinsService(prisma, uncached);
const list = new GarageSearchService(
  prisma,
  uncached,
  new SearchLogService(prisma),
);
serialDatabase(databaseUrl);

const PLACE = { lat: 44.437, lng: 26.117 };
const METRES_PER_DEGREE = (6_371_008.8 * Math.PI) / 180;
const northOf = (metres: number) => PLACE.lat + metres / METRES_PER_DEGREE;

type Garage = {
  at?: number | null;
  bani?: number;
  stance?: 'works_on' | 'does_not_take';
  brandId?: string;
  status?: 'approved' | 'draft' | 'suspended';
  kind?: 'company' | 'mobile';
  radiusKm?: number;
};

let dacia: string;
let tesla: string;

async function garage({
  at = 1000,
  bani,
  brandId,
  kind = 'company',
  radiusKm,
  stance,
  status = 'approved',
}: Garage = {}) {
  const { id } = await prisma.garage.create({
    data: {
      businessKind: kind,
      labourFromBani: bani,
      name: `Garage ${randomUUID()}`,
      serviceRadiusKm: radiusKm,
      slug: randomUUID(),
      status,
      ...(at !== null && { latitude: northOf(at), longitude: PLACE.lng }),
      ...(kind === 'mobile' && { seatAddress: 'Strada Sediului 1, București' }),
    },
  });
  if (stance) {
    await prisma.garageBrand.create({
      data: {
        brandId: brandId ?? dacia,
        garageId: id,
        stance,
        ...(stance === 'does_not_take' && {
          diesel: false,
          electric: false,
          hybrid: false,
          petrol: false,
        }),
      },
    });
  }
  return id;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, brand, garage CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
  tesla = (
    await prisma.brand.create({
      data: { key: 'tesla', name: 'Tesla', slug: 'tesla' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ids = (answer: { pins: { id: string }[] }) =>
  answer.pins.map((pin) => pin.id);

// @traces 269-FR-001 269-FR-002 269-FR-004
describe('the pins of a search around a place', () => {
  it('holds one pin per fixed garage within 25 km, nearest first, and the total the list gives', async () => {
    const far = await garage({ at: 20_000, stance: 'works_on' });
    const near = await garage({ at: 2000 });
    const middle = await garage({ at: 9000, stance: 'does_not_take' });
    await garage({ at: 26_000, stance: 'works_on' });

    const answer = await pins.forBrand(dacia, PLACE, 25);
    const page = await list.forBrand(dacia, undefined, PLACE, 25);

    expect(ids(answer)).toEqual([near, middle, far]);
    expect(answer.total).toBe(3);
    expect(answer.total).toBe(page.total);
  });

  it('widens to 50 km as the list does', async () => {
    const id = await garage({ at: 40_000 });

    expect(ids(await pins.forBrand(dacia, PLACE, 25))).toEqual([]);
    expect(ids(await pins.forBrand(dacia, PLACE, 50))).toEqual([id]);
  });

  it('finds the brand by its slug as the address bar holds it', async () => {
    const id = await garage();

    expect(ids(await pins.forBrand({ slug: 'dacia' }, PLACE))).toEqual([id]);
  });

  it('answers not_found for a brand the catalogue does not hold', async () => {
    await expect(
      pins.forBrand({ slug: 'trabant' }, PLACE),
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      pins.forBrand({ slug: 'trabant' }, PLACE),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('gives each pin its id, position, whole-lei rate and the stance for the brand, and nothing else', async () => {
    const id = await garage({ at: 1000, bani: 15_049, stance: 'works_on' });

    const [pin] = (await pins.forBrand(dacia, PLACE)).pins;

    expect(pin).toEqual({
      id,
      lat: northOf(1000),
      lng: PLACE.lng,
      rateLei: 150,
      stance: 'works_on',
    });
  });

  it.each([
    [15_050, 151],
    [9999, 100],
    [50, 1],
    [0, 0],
  ])('rounds a rate of %d bani to %d lei', async (bani, lei) => {
    await garage({ bani });

    expect((await pins.forBrand(dacia, PLACE)).pins[0]?.rateLei).toBe(lei);
  });

  it('gives a null rate when the garage has set none', async () => {
    await garage();

    expect((await pins.forBrand(dacia, PLACE)).pins[0]?.rateLei).toBeNull();
  });

  it('reads the stance for the searched brand only, else unstated', async () => {
    const refuses = await garage({ at: 1000, stance: 'does_not_take' });
    const otherBrand = await garage({
      at: 2000,
      brandId: tesla,
      stance: 'works_on',
    });
    const unmarked = await garage({ at: 3000 });

    const stances = Object.fromEntries(
      (await pins.forBrand(dacia, PLACE)).pins.map((pin) => [
        pin.id,
        pin.stance,
      ]),
    );

    expect(stances).toEqual({
      [otherBrand]: 'unstated',
      [refuses]: 'does_not_take',
      [unmarked]: 'unstated',
    });
  });

  it.each(['draft', 'suspended'] as const)(
    'never gives a pin for a %s garage, nor counts it',
    async (status) => {
      await garage({ status });

      expect(await pins.forBrand(dacia, PLACE)).toEqual({ pins: [], total: 0 });
    },
  );
});

// @traces 269-FR-004 269-FR-005
describe('the pins of a box on the map', () => {
  const BOX = {
    east: PLACE.lng + 0.1,
    north: northOf(30_000),
    south: northOf(-5000),
    west: PLACE.lng - 0.1,
  };

  it('holds the fixed garages inside the box, past the radius, with the total the list gives', async () => {
    const past = await garage({ at: 28_000 });
    const near = await garage({ at: 1000 });
    await garage({ at: 31_000 });

    const answer = await pins.forBrand(dacia, PLACE, 25, BOX);

    expect(ids(answer)).toEqual([near, past]);
    expect(answer.total).toBe(2);
  });

  it('measures from the centre of the box without a place', async () => {
    const edge = await garage({ at: -4000 });
    const middle = await garage({ at: 12_000 });

    const answer = await pins.forBrand(dacia, undefined, undefined, BOX);

    expect(ids(answer)).toEqual([middle, edge]);
  });
});

// @traces 269-FR-003
describe('the pins of a search finding more than 500 garages', () => {
  it('answers the 500 nearest and still counts every garage found', async () => {
    await prisma.garage.createMany({
      data: Array.from({ length: 502 }, (_, n) => ({
        businessKind: 'company' as const,
        latitude: northOf(100 + n * 10),
        longitude: PLACE.lng,
        name: `Bulk ${n}`,
        slug: `bulk-${n}`,
        status: 'approved' as const,
      })),
    });

    const answer = await pins.forBrand(dacia, PLACE);

    expect(answer.total).toBe(502);
    expect(answer.pins).toHaveLength(500);
    expect(answer.pins.at(-1)?.lat).toBe(northOf(100 + 499 * 10));
  });
});

// @traces 269-FR-002 269-FR-004
describe('the pins of a search with neither a place nor a box', () => {
  it('counts every approved garage as the list does and pins the ones with a position, from the centre of Romania', async () => {
    // Bucharest is nearer the centre of Romania than Constanța.
    const { id: constanta } = await prisma.garage.create({
      data: {
        latitude: 44.17,
        longitude: 28.63,
        name: 'Constanța',
        slug: 'constanta',
        status: 'approved',
      },
    });
    const bucharest = await garage({ at: 0 });
    await garage({ at: null });

    const answer = await pins.forBrand(dacia);
    const page = await list.forBrand(dacia);

    expect(ids(answer)).toEqual([bucharest, constanta]);
    expect(answer.total).toBe(3);
    expect(page.total).toBe(3);
  });

  it('never gives a pin for a garage with no position', async () => {
    await garage({ at: null });

    expect((await pins.forBrand(dacia, PLACE)).pins).toEqual([]);
  });
});

// @traces 269-FR-002
// @traces 269-FR-014
// @traces 269-FR-021
describe('the pins of a mobile mechanic', () => {
  const eastOf = (metres: number) =>
    PLACE.lng +
    metres / (METRES_PER_DEGREE * Math.cos((PLACE.lat * Math.PI) / 180));

  async function mobile(at: number, radiusKm?: number, bani?: number) {
    const id = await garage({ at, bani, kind: 'mobile', radiusKm });
    await prisma.garage.update({
      data: { longitude: eastOf(3333) },
      where: { id },
    });
    return id;
  }

  it('answers one whose area covers the place, with its area, its centre to 2 decimals, and nothing that names it', async () => {
    const id = await mobile(15_000, undefined, 12_000);

    const [pin] = (await pins.forBrand(dacia, PLACE)).pins;

    expect(pin).toEqual({
      id,
      lat: Math.round(northOf(15_000) * 100) / 100,
      lng: Math.round(eastOf(3333) * 100) / 100,
      rateLei: 120,
      serviceRadiusKm: 20,
      stance: 'unstated',
    });
  });

  it('keeps the radius the mechanic set', async () => {
    await mobile(8000, 10);

    expect((await pins.forBrand(dacia, PLACE)).pins[0]?.serviceRadiusKm).toBe(
      10,
    );
  });

  it('answers nothing of one whose area does not cover the place, nor counts it', async () => {
    await mobile(15_000, 10);

    expect(await pins.forBrand(dacia, PLACE)).toEqual({ pins: [], total: 0 });
  });

  it('answers one over the place in a box that does not hold its seat', async () => {
    const id = await mobile(15_000);
    const box = {
      east: PLACE.lng + 0.05,
      north: northOf(5000),
      south: northOf(-5000),
      west: PLACE.lng - 0.05,
    };

    const answer = await pins.forBrand(dacia, PLACE, 25, box);

    expect(ids(answer)).toEqual([id]);
    expect(answer.total).toBe(1);
  });

  it('never answers one for a box alone, even when the box holds its seat', async () => {
    await mobile(1000);
    const box = {
      east: PLACE.lng + 0.1,
      north: northOf(5000),
      south: northOf(-5000),
      west: PLACE.lng - 0.1,
    };

    expect(await pins.forBrand(dacia, undefined, undefined, box)).toEqual({
      pins: [],
      total: 0,
    });
  });
});
