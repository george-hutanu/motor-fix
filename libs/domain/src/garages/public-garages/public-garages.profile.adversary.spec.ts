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
  courtesy_car: false,
  courtesy_car_paid: false,
  courtesy_car_price_per_day_bani: null,
  id: 'g1',
  known_for: null,
  labour_from_bani: null,
  labour_to_bani: null,
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
  verified_at: null,
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

  it('keeps a mobile garage without a seat and with the default radius', async () => {
    const { service } = build([
      listedRow({
        address: 'Home 1',
        business_kind: 'mobile',
        latitude: 44.4,
        longitude: 26.1,
      }),
    ]);

    const body = await service.bySlug('garage');

    expect(body).toMatchObject({ businessKind: 'mobile', serviceRadiusKm: 20 });
    expect(body).not.toHaveProperty('address');
    expect(body).not.toHaveProperty('latitude');
    expect(body).not.toHaveProperty('longitude');
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
