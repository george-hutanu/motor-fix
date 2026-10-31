import { PublicGaragesService, publicGaragesSql } from './public-garages';
import type { CacheService } from '../../cache/cache.service';
import type { PrismaClient } from '../../generated/prisma/client';
import type { StorageService } from '../../storage/storage.service';

type Row = Record<string, unknown>;

const listedRow = (over: Row = {}): Row => ({
  address: null,
  approved_at: null,
  brand_note: null,
  brands: [],
  business_kind: null,
  courtesy_car_paid: false,
  courtesy_car_price_per_day_bani: null,
  facilities: [],
  facilities_note: null,
  id: 'g1',
  known_for: null,
  labour_from_bani: null,
  labour_to_bani: null,
  last_checked_on: null,
  latitude: null,
  lifetime_requests: null,
  listed: true,
  longitude: null,
  name: 'Garage',
  payment_card: false,
  payment_cash: false,
  payment_transfer: false,
  photos: [],
  prices: [],
  rar_activities: [],
  rate: null,
  rating: null,
  refusal_phrase: null,
  review_count: 0,
  service_radius_km: null,
  slug: 'garage',
  status: 'approved',
  ...over,
});

function build(rows: Row[]) {
  const calls: { strings: string[]; values: unknown[] }[] = [];
  const queryRaw = jest.fn((strings: TemplateStringsArray, ...values) => {
    calls.push({ strings: [...strings], values });
    return Promise.resolve(rows);
  });
  const prisma = {
    $queryRaw: queryRaw,
    brand: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
  const cache = {
    read: jest.fn(async (spec: { read: () => Promise<{ value: unknown }> }) => {
      const filled = await spec.read();
      return filled.value;
    }),
  } as unknown as CacheService;
  const storage = {
    createDownloadUrl: jest.fn().mockResolvedValue('https://signed'),
    derivedKey: (key: string, kind: string) => `${key}.${kind}`,
    metadataOf: jest.fn().mockResolvedValue(null),
  } as unknown as StorageService;
  return {
    calls,
    queryRaw,
    service: new PublicGaragesService(prisma, cache, storage),
  };
}

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error: { getStatus?: () => number }) => error.getStatus?.() ?? -1,
  );

// @traces 1183-FR-002
describe('the profile verdict', () => {
  it('answers 404 for a slug nobody holds from one statement', async () => {
    const { queryRaw, service } = build([]);

    expect(await status(service.bySlug('nobody'))).toBe(404);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('answers 410 for a suspended garage and 404 for a draft one', async () => {
    const suspended = build([
      listedRow({ brands: null, listed: false, status: 'suspended' }),
    ]);
    const draft = build([
      listedRow({ brands: null, listed: false, status: 'draft' }),
    ]);

    expect([
      await status(suspended.service.bySlug('s')),
      await status(draft.service.bySlug('d')),
    ]).toEqual([410, 404]);
    expect(suspended.queryRaw).toHaveBeenCalledTimes(1);
    expect(draft.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('never leaks a field of a garage that is not listed', async () => {
    const { service } = build([
      listedRow({ listed: false, name: 'Secret', status: 'suspended' }),
    ]);

    const error = await service.bySlug('s').catch((e: unknown) => e);

    expect(
      JSON.stringify((error as { getResponse: () => unknown }).getResponse()),
    ).not.toContain('Secret');
  });
});

describe('a slug the database cannot hold', () => {
  it.each([
    ['NUL', 'a\u0000b'],
    ['newline', 'a\nb'],
    ['DEL', 'a\u007fb'],
    ['C1 control', 'a\u0085b'],
    ['tab', '\tgarage'],
  ])('answers 404 without a statement for %s', async (_, slug) => {
    const { queryRaw, service } = build([listedRow()]);

    expect(await status(service.bySlug(slug))).toBe(404);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('sends a hostile slug as a bound value, never inside the statement text', async () => {
    const hostile = `x'; DROP TABLE garage; --`;
    const { calls, service } = build([]);

    await status(service.bySlug(hostile));

    expect(calls[0]?.strings.join('')).not.toContain('DROP TABLE');
    expect(calls[0]?.values).toContain(hostile);
  });

  it('treats a blank or non-string brand as no brand', async () => {
    const { service } = build([listedRow()]);

    for (const brand of ['', '   ', null, 7, ['a'], { a: 1 }]) {
      expect(await service.bySlug('garage', brand)).not.toHaveProperty('brand');
    }
  });
});

// @traces 1183-FR-003
describe('the profile answer of a bare garage', () => {
  it('keeps the empty collections and nulls of a garage with nothing', async () => {
    const { service } = build([listedRow()]);

    expect(await service.bySlug('garage')).toEqual({
      brandNote: null,
      doesNotTake: [],
      facilities: [],
      hours: {},
      id: 'g1',
      jobTypes: [],
      name: 'Garage',
      paymentMethods: { card: false, cash: false, transfer: false },
      photos: [],
      prices: [],
      rating: null,
      refusalPhrase: null,
      responseRate: expect.anything(),
      reviewCount: 0,
      slug: 'garage',
      verifiedAt: null,
      worksOn: [],
    });
  });

  it('falls back to the approval time when no verification file was decided', async () => {
    const approved = new Date('2026-09-01T08:00:00.000Z');
    const { service } = build([listedRow({ approved_at: approved })]);

    expect((await service.bySlug('garage')).verifiedAt).toBe(
      '2026-09-01T08:00:00.000Z',
    );
  });

  it('answers the same twice', async () => {
    const { service } = build([listedRow({ known_for: '  ' })]);

    const first = await service.bySlug('garage');
    const second = await service.bySlug('garage');

    expect(second).toEqual(first);
    expect(first).not.toHaveProperty('description');
  });
});

// @traces 1183-FR-004
describe('the SQL public scope', () => {
  it('names the default alias and the approved status', () => {
    expect(publicGaragesSql().sql).toBe("garage.status = 'approved'");
  });

  it('names the alias a query gives the table', () => {
    expect(publicGaragesSql('g').sql).toBe("g.status = 'approved'");
  });

  it('carries no bound value', () => {
    expect(publicGaragesSql('g').values).toEqual([]);
  });
});

// @traces 1383-FR-001 1383-FR-002
describe("the centre of a mobile mechanic's area", () => {
  it('rounds the position to two decimals beside the radius', async () => {
    const { service } = build([
      listedRow({
        business_kind: 'mobile',
        latitude: 44.9365,
        longitude: 26.0129,
      }),
    ]);

    const answer = await service.bySlug('garage');

    expect(answer).toMatchObject({
      areaLat: 44.94,
      areaLng: 26.01,
      serviceRadiusKm: 20,
    });
    expect(answer).not.toHaveProperty('latitude');
    expect(answer).not.toHaveProperty('longitude');
  });

  it.each([
    ['only a latitude', { latitude: 44.9365 }],
    ['only a longitude', { longitude: 26.0129 }],
    ['no position', {}],
  ])('answers no centre for %s', async (_, position) => {
    const { service } = build([
      listedRow({ business_kind: 'mobile', ...position }),
    ]);

    const answer = await service.bySlug('garage');

    expect(answer).not.toHaveProperty('areaLat');
    expect(answer).not.toHaveProperty('areaLng');
    expect(answer.serviceRadiusKm).toBe(20);
  });

  it('gives a workshop its exact position and no centre', async () => {
    const { service } = build([
      listedRow({
        address: 'Strada Exemplu 1',
        business_kind: 'company',
        latitude: 44.9365,
        longitude: 26.0129,
      }),
    ]);

    const answer = await service.bySlug('garage');

    expect(answer).toMatchObject({ latitude: 44.9365, longitude: 26.0129 });
    expect(answer).not.toHaveProperty('areaLat');
    expect(answer).not.toHaveProperty('areaLng');
  });
});

// @traces 1383-FR-001 1383-FR-002
describe("the centre of a mobile mechanic's area, at its edges", () => {
  const mobile = (over: Row) =>
    build([listedRow({ business_kind: 'mobile', ...over })]).service.bySlug(
      'garage',
    );

  it.each([
    [44.995, 26.004, 45, 26],
    [44.994, 26.005, 44.99, 26.01],
    [-0.004, 0.004, 0, 0],
    [0, 0, 0, 0],
    [-33.456, -70.649, -33.46, -70.65],
    [89.999, 179.999, 90, 180],
  ])(
    'rounds %d, %d to %d, %d',
    async (latitude, longitude, areaLat, areaLng) => {
      const answer = await mobile({ latitude, longitude });

      expect(answer.areaLat).toBeCloseTo(areaLat, 10);
      expect(answer.areaLng).toBeCloseTo(areaLng, 10);
    },
  );

  it('keeps a centre at zero degrees, since zero is a position', async () => {
    const answer = await mobile({ latitude: 0, longitude: 0 });

    expect(answer).toHaveProperty('areaLat');
    expect(answer).toHaveProperty('areaLng');
  });

  it('leaves neither the seat text nor its exact coordinates in the serialised body', async () => {
    const answer = await mobile({
      address: 'Strada Secretă 7, Sector 3',
      latitude: 44.936512,
      longitude: 26.012934,
    });
    const body = JSON.stringify(answer);

    expect(body).not.toContain('Secretă');
    expect(body).not.toContain('44.936512');
    expect(body).not.toContain('26.012934');
    expect(Object.keys(answer)).not.toEqual(
      expect.arrayContaining(['address']),
    );
    expect(answer).not.toHaveProperty('seatAddress');
  });

  it('answers the same centre twice', async () => {
    const row = { latitude: 44.9365, longitude: 26.0129 };

    expect(await mobile(row)).toEqual(await mobile(row));
  });

  it('keeps the radius a mobile mechanic chose beside its centre', async () => {
    const answer = await mobile({
      latitude: 44.9365,
      longitude: 26.0129,
      service_radius_km: 100,
    });

    expect(answer.serviceRadiusKm).toBe(100);
  });

  it('gives a garage of no kind no centre', async () => {
    const answer = await build([
      listedRow({ business_kind: null, latitude: 44.9365, longitude: 26.0129 }),
    ]).service.bySlug('garage');

    expect(answer).not.toHaveProperty('areaLat');
    expect(answer).not.toHaveProperty('areaLng');
  });

  it('gives a former mobile mechanic now a workshop its seat and no centre', async () => {
    const answer = await build([
      listedRow({
        address: 'Strada Veche 2',
        business_kind: 'company',
        latitude: 44.9365,
        longitude: 26.0129,
        service_radius_km: 40,
      }),
    ]).service.bySlug('garage');

    expect(answer).toMatchObject({ address: 'Strada Veche 2' });
    expect(answer).not.toHaveProperty('areaLat');
    expect(answer).not.toHaveProperty('serviceRadiusKm');
  });
});
