import { Logger } from '@nestjs/common';

import { PLACE_GARAGES_PER_NIGHT, placeGarages } from './place-garages';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';
import { FakePlaces } from '../places/providers/fake-places.provider';
import type {
  PlacesAnswer,
  PlacesProvider,
} from '../places/providers/places.provider';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let slug = 0;
const garage = (
  data: {
    address?: string | null;
    seatAddress?: string | null;
    status?: 'draft' | 'approved';
    approvedAt?: Date;
    createdAt?: Date;
    cityKey?: string;
    cityName?: string;
  } = {},
) =>
  prisma.garage.create({
    data: {
      address: 'Strada Exemplu 2, Cluj-Napoca',
      name: 'Service',
      slug: `place-${++slug}`,
      ...data,
    },
  });

const cityOfGarage = (id: string) =>
  prisma.garage.findUniqueOrThrow({
    select: { cityKey: true, cityName: true },
    where: { id },
  });

const asked = (answer: (q: string) => PlacesAnswer | Promise<PlacesAnswer>) => {
  const texts: string[] = [];
  const provider: PlacesProvider = {
    name: 'stub',
    search: async (q) => {
      texts.push(q);
      return answer(q);
    },
  };
  return { provider, texts };
};

let log: jest.SpyInstance;

beforeEach(async () => {
  await reset();
  log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => prisma.$disconnect());

// @traces 163-FR-005
describe('the nightly placing of garages with no city', () => {
  it("places a workshop from its address and a mobile mechanic from its seat, with the first suggestion's locality", async () => {
    const workshop = await garage();
    const mobile = await garage({
      address: null,
      seatAddress: 'Strada Ștefan cel Mare 12, Iași',
    });

    await expect(placeGarages(prisma, new FakePlaces())).resolves.toEqual({
      placed: 2,
      unplaced: 0,
    });

    await expect(cityOfGarage(workshop.id)).resolves.toEqual({
      cityKey: 'cluj-napoca',
      cityName: 'Cluj-Napoca',
    });
    await expect(cityOfGarage(mobile.id)).resolves.toEqual({
      cityKey: 'iasi',
      cityName: 'Iași',
    });
  });

  it('asks nothing for a garage with a city or with no address or seat', async () => {
    await garage({ cityKey: 'arad', cityName: 'Arad' });
    await garage({ address: null, seatAddress: null });
    const { provider, texts } = asked(() => ({ items: [] }));

    await expect(placeGarages(prisma, provider)).resolves.toEqual({
      placed: 0,
      unplaced: 0,
    });
    expect(texts).toEqual([]);
  });

  it(`places at most ${PLACE_GARAGES_PER_NIGHT} a night, the listed ones first, then the oldest`, async () => {
    expect(PLACE_GARAGES_PER_NIGHT).toBe(25);
    const old = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 25; i += 1) {
      await garage({ address: `Strada Veche ${i}`, createdAt: old });
    }
    const listed = await garage({
      address: 'Strada Listată 1',
      approvedAt: new Date('2026-09-02T00:00:00Z'),
      createdAt: new Date('2026-09-01T00:00:00Z'),
      status: 'approved',
    });
    const newest = await garage({
      address: 'Strada Nouă 1',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });
    const { provider, texts } = asked(() => ({
      items: [{ label: 'x', lat: 44.4, lng: 26.1, locality: 'București' }],
    }));

    await expect(placeGarages(prisma, provider)).resolves.toEqual({
      placed: 25,
      unplaced: 0,
    });
    expect(texts).toHaveLength(25);
    expect(texts[0]).toBe('Strada Listată 1');
    expect(texts).not.toContain('Strada Nouă 1');
    await expect(cityOfGarage(listed.id)).resolves.toMatchObject({
      cityKey: 'bucuresti',
    });
    await expect(cityOfGarage(newest.id)).resolves.toEqual({
      cityKey: null,
      cityName: null,
    });

    await placeGarages(prisma, provider);

    await expect(cityOfGarage(newest.id)).resolves.toMatchObject({
      cityKey: 'bucuresti',
    });
  });

  it.each([
    ['finds nothing', { items: [] }],
    [
      'finds a place with no locality',
      { items: [{ label: 'x', lat: 44.4, lng: 26.1 }] },
    ],
  ] as [string, PlacesAnswer][])(
    'leaves a garage unplaced when the look-up %s, and tries it again the next night',
    async (_, answer) => {
      const { id } = await garage();
      const { provider, texts } = asked(() => answer);

      await expect(placeGarages(prisma, provider)).resolves.toEqual({
        placed: 0,
        unplaced: 1,
      });
      await placeGarages(prisma, provider);

      expect(texts).toHaveLength(2);
      await expect(cityOfGarage(id)).resolves.toEqual({
        cityKey: null,
        cityName: null,
      });
    },
  );

  it('stops asking once the look-up is down, and counts what it did not place', async () => {
    await garage();
    await garage();
    await garage();
    const { provider, texts } = asked(() => ({ unavailable: 'timeout' }));

    await expect(placeGarages(prisma, provider)).resolves.toEqual({
      placed: 0,
      unplaced: 3,
    });
    expect(texts).toHaveLength(1);
  });

  it('takes a look-up that throws as down, never as a failed night', async () => {
    await garage();
    const { provider } = asked(() => {
      throw new Error('boom');
    });

    await expect(placeGarages(prisma, provider)).resolves.toEqual({
      placed: 0,
      unplaced: 1,
    });
  });

  it('logs one line with the counts and never an address', async () => {
    await garage();
    await garage({ address: 'Strada Nicaieri 7' });

    await placeGarages(prisma, new FakePlaces());

    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toEqual(['placed 1, unplaced 1']);
  });
});
