// @traces 106-FR-002 106-FR-003 106-FR-004 106-FR-005 106-FR-006 106-FR-007 106-FR-009 106-FR-010 106-FR-011
import { BadRequestException } from '@nestjs/common';

import { readDemandSupply, writeBrandAreaDaily } from './supply';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { addDays, atLocal } from '../../../bucharest';
import type {
  GarageBrandStance,
  GarageStatus,
} from '../../../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../../../quotes/quotes.testing';
import { AREAS, AreaLoader } from '../../areas/areas';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const TODAY = '2026-10-17';
const NOW = atLocal(TODAY, 11);
const FIRST = '2026-09-18';
const DAY = '2026-10-10';

const POINT = {
  cluj: { lat: 46.77, lng: 23.59 },
  sector2: { lat: 44.455, lng: 26.14 },
  sector3: { lat: 44.415, lng: 26.17 },
} as const;
const CELL = {
  cluj: 'u82f0',
  sector2: 'sxfsf',
  sector3: 'sxfse',
} as const;

let driverId: string;
let carId: string;

beforeAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE area');
  await new AreaLoader(prisma).load(AREAS);
});

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE demand_daily');
  driverId = await world.account('Andrei Ion Marin');
  carId = (await world.car(driverId)).id;
});

afterAll(() => prisma.$disconnect());

async function brandNamed(name: string) {
  const slug = `brand-${[...name].map((c) => c.codePointAt(0)).join('-')}`;
  return (
    (await prisma.brand.findUnique({ where: { name } })) ??
    (await prisma.brand.create({ data: { key: slug, name, slug } }))
  );
}

async function garageAt(
  name: string,
  point: { lat: number; lng: number } | null,
  brands: Record<string, GarageBrandStance> = {},
  status: GarageStatus = 'approved',
) {
  const garage = await world.garage(name);
  await prisma.garage.update({ data: { status }, where: { id: garage.id } });
  if (point)
    await prisma.$executeRaw`UPDATE garage SET position = ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography WHERE id = ${garage.id}::uuid`;
  for (const [brand, stance] of Object.entries(brands)) {
    const { id } = await brandNamed(brand);
    await prisma.garageBrand.create({
      data: { brandId: id, garageId: garage.id, stance },
    });
  }
  return garage;
}

async function searched(
  brand: string,
  at: Date,
  cell: string | null,
  times = 1,
) {
  const { id } = await brandNamed(brand);
  await prisma.searchLog.createMany({
    data: Array.from({ length: times }, () => ({
      areaCell: cell,
      at,
      brandId: id,
    })),
  });
}

async function asked(
  brand: string,
  at: Date,
  garages: { id: string }[],
  closed?: { at: Date; reason?: 'expired' | 'cancelled' },
) {
  const request = await world.request(driverId, { carId, createdAt: at });
  await prisma.quoteRequest.update({
    data: {
      carBrand: brand,
      ...(closed && {
        closedAt: closed.at,
        closedReason: closed.reason ?? 'expired',
        status: 'closed',
      }),
    },
    where: { id: request.id },
  });
  for (const garage of garages) await world.recipient(request.id, garage.id);
  return request;
}

const noon = (day: string) => atLocal(day, 12);
const lastMs = (day: string) =>
  new Date(atLocal(addDays(day, 1), 0).getTime() - 1);

const read = (query: { brand?: string; area?: string } = {}, now: Date = NOW) =>
  readDemandSupply(prisma, now, query);

const areaRows = (day: string) =>
  prisma.demandDaily.findMany({
    orderBy: { key: 'asc' },
    select: { key: true, requests: true, searches: true, unmetRequests: true },
    where: { day: new Date(day), dimension: 'brand_area' },
  });

const everything = () =>
  prisma.demandDaily.findMany({
    orderBy: [{ day: 'asc' }, { dimension: 'asc' }, { key: 'asc' }],
  });

const figures = async (query: { brand?: string; area?: string } = {}) =>
  (await read(query)).rows.map((r) => [
    r.brand,
    r.area.code,
    r.searches,
    r.requests,
    r.unmet,
    r.supply,
    r.requestsPerGarage,
  ]);

describe('the nightly rows written twice, at once and in failure', () => {
  it('writes the 29 closed days, and a second night reports and changes nothing', async () => {
    await searched('BMW', noon(DAY), CELL.sector3, 2);

    const first = await writeBrandAreaDaily(prisma, NOW);
    const before = await everything();
    const second = await writeBrandAreaDaily(prisma, NOW);

    expect(first.days).toHaveLength(29);
    expect(first.written).toBe(1 + 29);
    expect(second).toEqual({ days: [], written: 0 });
    expect(await everything()).toEqual(before);
  });

  it('writes only a marker per closed day on an empty database, and the read answers no rows', async () => {
    const result = await writeBrandAreaDaily(prisma, NOW);

    const markers = await prisma.demandDaily.findMany({
      where: { dimension: 'brand_area', key: 'all' },
    });
    const answer = await read();
    expect(result.days).toHaveLength(29);
    expect(markers).toHaveLength(29);
    expect(markers.every((m) => m.searches + m.requests === 0)).toBe(true);
    expect(answer.rows).toEqual([]);
    expect(answer.writtenAt).not.toBeNull();
    expect(answer.areas).toHaveLength(48);
  });

  it('survives two nights running at once with one marker per day and the counts of one run', async () => {
    await searched('BMW', noon(DAY), CELL.sector3, 3);

    await Promise.all([
      writeBrandAreaDaily(prisma, NOW),
      writeBrandAreaDaily(prisma, NOW),
    ]);

    expect(await areaRows(DAY)).toEqual([
      { key: 'all', requests: 0, searches: 3, unmetRequests: 0 },
      { key: 'sector-3:BMW', requests: 0, searches: 3, unmetRequests: 0 },
    ]);
    expect(
      await prisma.demandDaily.count({
        where: { dimension: 'brand_area', key: 'all' },
      }),
    ).toBe(29);
  });

  it('never leaves a day with rows and no marker when a transaction fails, and a retry completes the window', async () => {
    await searched('BMW', noon(DAY), CELL.sector3, 2);
    await searched('BMW', noon(addDays(DAY, -3)), CELL.cluj, 1);
    let calls = 0;
    const flaky = {
      $queryRaw: prisma.$queryRaw.bind(prisma),
      $transaction: ((...args: unknown[]) => {
        calls += 1;
        if (calls === 3) throw new Error('connection lost');
        return (prisma.$transaction as (...a: unknown[]) => unknown)(...args);
      }) as typeof prisma.$transaction,
      area: prisma.area,
      demandDaily: prisma.demandDaily,
    };

    await expect(writeBrandAreaDaily(flaky, NOW)).rejects.toThrow(
      'connection lost',
    );

    const rows = await prisma.demandDaily.findMany({
      where: { dimension: 'brand_area' },
    });
    const withMarker = new Set(
      rows.filter((r) => r.key === 'all').map((r) => r.day.toISOString()),
    );
    expect(rows.filter((r) => !withMarker.has(r.day.toISOString()))).toEqual(
      [],
    );

    await writeBrandAreaDaily(prisma, NOW);
    expect(
      await prisma.demandDaily.count({
        where: { dimension: 'brand_area', key: 'all' },
      }),
    ).toBe(29);
    expect((await areaRows(DAY)).map((r) => r.key)).toEqual([
      'all',
      'sector-3:BMW',
    ]);
  });

  it('replaces rows left on a day without a marker instead of adding to them', async () => {
    await searched('BMW', noon(DAY), CELL.sector3, 1);
    await prisma.demandDaily.create({
      data: {
        day: new Date(DAY),
        dimension: 'brand_area',
        key: 'sector-3:BMW',
        requests: 0,
        searches: 7,
        writtenAt: new Date(),
      },
    });

    expect((await figures())[0].slice(0, 3)).toEqual(['BMW', 'sector-3', 1]);
    await writeBrandAreaDaily(prisma, NOW);

    expect(await areaRows(DAY)).toEqual([
      { key: 'all', requests: 0, searches: 1, unmetRequests: 0 },
      { key: 'sector-3:BMW', requests: 0, searches: 1, unmetRequests: 0 },
    ]);
  });
});

describe('the window and its day edges', () => {
  it('counts the first day from its first instant and not the day before its last', async () => {
    await searched('BMW', atLocal(FIRST, 0), CELL.sector3);
    await searched(
      'Audi',
      new Date(atLocal(FIRST, 0).getTime() - 1),
      CELL.sector3,
    );
    await asked('BMW', atLocal(FIRST, 0), [
      await garageAt('Est', POINT.sector3),
    ]);
    await asked('Audi', new Date(atLocal(FIRST, 0).getTime() - 1), [
      await garageAt('Est 2', POINT.sector3),
    ]);

    const live = await figures();
    await writeBrandAreaDaily(prisma, NOW);

    expect(live.map((r) => r.slice(0, 4))).toEqual([['BMW', 'sector-3', 1, 1]]);
    expect(await figures()).toEqual(live);
  });

  it('does not count tomorrow or a search logged in the future', async () => {
    await searched('BMW', atLocal(addDays(TODAY, 1), 0), CELL.sector3);
    await searched('BMW', atLocal(addDays(TODAY, 40), 12), CELL.sector3);

    expect((await read()).rows).toEqual([]);
  });

  it('counts a search at the last millisecond of a day on that day and the next instant on the next', async () => {
    await searched('BMW', lastMs(DAY), CELL.sector3);
    await searched('BMW', atLocal(addDays(DAY, 1), 0), CELL.sector3, 2);

    await writeBrandAreaDaily(prisma, NOW);

    expect((await areaRows(DAY))[0]).toMatchObject({ key: 'all', searches: 1 });
    expect((await areaRows(addDays(DAY, 1)))[0]).toMatchObject({
      key: 'all',
      searches: 2,
    });
  });

  it('puts the days around the autumn clock change on their Bucharest dates', async () => {
    const now = atLocal('2026-11-02', 11);
    await searched('BMW', atLocal('2026-10-25', 0), CELL.sector3);
    await searched('BMW', lastMs('2026-10-25'), CELL.sector3);
    await searched('BMW', atLocal('2026-10-26', 0), CELL.sector3, 4);

    const live = await read({}, now);
    await writeBrandAreaDaily(prisma, now);
    const written = await read({}, now);

    expect(
      await prisma.demandDaily.findMany({
        select: { searches: true },
        where: {
          day: new Date('2026-10-25'),
          dimension: 'brand_area',
          key: 'all',
        },
      }),
    ).toEqual([{ searches: 2 }]);
    expect(
      await prisma.demandDaily.findMany({
        select: { searches: true },
        where: {
          day: new Date('2026-10-26'),
          dimension: 'brand_area',
          key: 'all',
        },
      }),
    ).toEqual([{ searches: 4 }]);
    expect(written.rows).toEqual(live.rows);
    expect(live.rows[0].searches).toBe(6);
  });

  it('reads a closed day from its stored counts, so a late search does not move it', async () => {
    await searched('BMW', noon(DAY), CELL.sector3, 2);
    await writeBrandAreaDaily(prisma, NOW);
    await searched('BMW', noon(DAY), CELL.sector3, 5);

    expect((await read()).rows[0].searches).toBe(2);
  });

  it('counts today live and ignores a row or a marker stored on today and outside the window', async () => {
    await searched('BMW', noon(TODAY), CELL.sector3, 2);
    const stray = (day: string, key: string, searches: number, at: Date) =>
      prisma.demandDaily.create({
        data: {
          day: new Date(day),
          dimension: 'brand_area',
          key,
          requests: 0,
          searches,
          writtenAt: at,
        },
      });
    const later = new Date('2030-01-01T00:00:00Z');
    await stray(TODAY, 'sector-3:BMW', 500, later);
    await stray(TODAY, 'all', 500, later);
    await stray(addDays(FIRST, -10), 'sector-3:BMW', 99, later);
    await stray(addDays(FIRST, -10), 'all', 99, later);

    const answer = await read();

    expect(answer.rows.map((r) => r.searches)).toEqual([2]);
    expect(answer.writtenAt).toBeNull();
  });

  it('answers the latest marker of the window as writtenAt', async () => {
    await writeBrandAreaDaily(prisma, NOW);
    const newest = new Date('2026-10-17T01:00:00.000Z');
    await prisma.demandDaily.update({
      data: { writtenAt: newest },
      where: {
        day_dimension_key: {
          day: new Date(addDays(TODAY, -1)),
          dimension: 'brand_area',
          key: 'all',
        },
      },
    });
    await prisma.demandDaily.updateMany({
      data: { writtenAt: new Date('2026-10-10T01:00:00.000Z') },
      where: {
        day: { lt: new Date(addDays(TODAY, -1)) },
        dimension: 'brand_area',
      },
    });

    expect((await read()).writtenAt).toBe(newest.toISOString());
  });
});

describe('names that look like the stored key', () => {
  const BRANDS = [
    'Mercedes:Benz',
    'sector-3:BMW',
    ':',
    'Škoda',
    ' Audi',
    'Audi ',
    "O'Reilly",
    'A"B',
    'back\\slash',
    '100%_like',
    '\u{1F697}',
    'x'.repeat(80),
    'Café',
    'Café',
  ];

  it('answers each brand under its own exact name from the live count and from the night alike', async () => {
    for (const brand of BRANDS) {
      await searched(brand, noon(DAY), CELL.sector3);
      await searched(brand, noon(DAY), CELL.cluj, 2);
    }

    const live = await read();
    await writeBrandAreaDaily(prisma, NOW);
    const written = await read();

    expect(live.rows).toHaveLength(BRANDS.length * 2);
    expect(live.rows.map((r) => r.brand).sort()).toEqual(
      [...BRANDS, ...BRANDS].sort(),
    );
    expect(written.rows).toEqual(live.rows);
  });

  it('merges a request snapshot and a search of the same exact name, and keeps a differing case apart', async () => {
    const east = await garageAt('Est', POINT.sector3);
    await searched('BMW', noon(DAY), CELL.sector3);
    await asked('BMW', noon(DAY), [east]);
    await asked('bmw', noon(DAY), [east]);
    await asked('BMW ', noon(DAY), [east]);

    expect((await figures()).map((r) => r.slice(0, 4))).toEqual([
      ['BMW', 'sector-3', 1, 1],
      ['BMW ', 'sector-3', 0, 1],
      ['bmw', 'sector-3', 0, 1],
    ]);
  });

  it('orders equal rows by code point, a capital before a lower case before an accent', async () => {
    for (const brand of ['Škoda', 'zeta', 'Zeta', 'alfa', 'Alfa'])
      await searched(brand, noon(DAY), CELL.sector3);

    expect((await read()).rows.map((r) => r.brand)).toEqual([
      'Alfa',
      'Zeta',
      'alfa',
      'zeta',
      'Škoda',
    ]);
  });
});

describe('the filters under hostile values', () => {
  beforeEach(async () => {
    await searched('BMW', noon(DAY), CELL.sector3);
    await searched('BMW', noon(DAY), null);
  });

  it.each([
    ['a wildcard', 'B%'],
    ['a single-character wildcard', '_MW'],
    ['a lone percent', '%'],
    ['a quote injection', "BMW' OR '1'='1"],
    ['a statement', 'BMW; DROP TABLE area; --'],
    ['trailing space', 'BMW '],
    ['lower case', 'bmw'],
    ['quoted', '"BMW"'],
    ['a regular expression', 'B.*'],
    ['a backslash escape', 'BMW\\'],
    ['the empty string', ''],
  ])(
    'keeps no row for %s and leaves the area table alone',
    async (_, brand) => {
      expect((await read({ brand })).rows).toEqual([]);
      expect(await prisma.area.count()).toBe(47);
    },
  );

  it.each([
    ['a wildcard', 'sector-%'],
    ['upper case', 'UNKNOWN'],
    ['the empty string', ''],
    ['a quote injection', "unknown' OR '1'='1"],
    ['a code that is well-formed and absent', 'sector-7'],
  ])('refuses the area %s with validation_failed', async (_, area) => {
    await expect(read({ area })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers the same twice and writes nothing', async () => {
    const before = await prisma.demandDaily.count();

    const a = await read({ brand: 'BMW' });
    const b = await read({ brand: 'BMW' });

    expect(b).toEqual(a);
    expect(await prisma.demandDaily.count()).toBe(before);
  });

  it('serves everything under unknown while AREA is empty, and refuses a code', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE area');
    try {
      const answer = await read();
      expect(answer.areas.map((a) => a.code)).toEqual(['unknown']);
      expect(answer.rows.map((r) => [r.area.code, r.searches])).toEqual([
        ['unknown', 2],
      ]);
      await expect(read({ area: 'sector-3' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect((await read({ area: 'unknown' })).rows).toHaveLength(1);
    } finally {
      await new AreaLoader(prisma).load(AREAS);
    }
  });
});

describe('supply and its ratio at the edges', () => {
  it('leaves a brand with garages and no search or request without a row', async () => {
    await garageAt('Da 1', POINT.sector3, { BMW: 'works_on' });
    await garageAt('Da 2', POINT.sector3, { BMW: 'works_on' });

    expect((await read()).rows).toEqual([]);
  });

  it('rounds a half up whatever the numbers, and answers integers', async () => {
    const one = [
      await garageAt('G1a', POINT.sector2, {
        Audi: 'works_on',
        Fiat: 'works_on',
        Opel: 'works_on',
      }),
      await garageAt('G1b', POINT.sector2, {
        Audi: 'works_on',
        Fiat: 'works_on',
        Opel: 'works_on',
      }),
    ];
    await asked('Opel', noon(DAY), [one[0]]);
    for (let i = 0; i < 3; i++) await asked('Audi', noon(DAY), [one[i % 2]]);
    for (let i = 0; i < 5; i++) await asked('Fiat', noon(DAY), [one[i % 2]]);

    const rows = (await read()).rows;

    expect(
      Object.fromEntries(rows.map((r) => [r.brand, r.requestsPerGarage])),
    ).toEqual({ Audi: 2, Fiat: 3, Opel: 1 });
  });

  it('answers null per garage for supply 0 whatever the requests, never infinity', async () => {
    const east = await garageAt('Est', POINT.sector3);
    for (let i = 0; i < 3; i++) await asked('Opel', noon(DAY), [east]);

    expect((await read()).rows[0]).toMatchObject({
      requests: 3,
      requestsPerGarage: null,
      supply: 0,
    });
  });

  it('counts supply of today even for a closed day the night wrote earlier', async () => {
    await searched('BMW', noon(DAY), CELL.sector3);
    await writeBrandAreaDaily(prisma, NOW);
    expect((await read()).rows[0].supply).toBe(0);

    const late = await garageAt('Nou', POINT.sector3, { BMW: 'works_on' });
    expect((await read()).rows[0].supply).toBe(1);

    await prisma.$executeRaw`UPDATE garage SET position = ST_SetSRID(ST_MakePoint(${POINT.cluj.lng}, ${POINT.cluj.lat}), 4326)::geography WHERE id = ${late.id}::uuid`;
    expect((await read()).rows[0].supply).toBe(0);
  });

  it('counts a garage once in supply however many brands it works on and counts none of its other stances', async () => {
    await garageAt('Multi', POINT.sector3, {
      Audi: 'works_on',
      BMW: 'works_on',
      Opel: 'does_not_take',
    });
    await searched('BMW', noon(DAY), CELL.sector3);
    await searched('Opel', noon(DAY), CELL.sector3);

    expect(
      Object.fromEntries((await read()).rows.map((r) => [r.brand, r.supply])),
    ).toEqual({ BMW: 1, Opel: 0 });
  });
});

describe('what counts as a request and an unmet one', () => {
  it('counts a request sent to nobody once, under unknown', async () => {
    await asked('BMW', noon(DAY), []);

    expect((await read()).rows.map((r) => [r.area.code, r.requests])).toEqual([
      ['unknown', 1],
    ]);
  });

  it('does not count an expired request as unmet when its only quote was withdrawn', async () => {
    const east = await garageAt('Est', POINT.sector3);
    const request = await asked('BMW', noon(addDays(FIRST, -5)), [east], {
      at: noon(DAY),
    });
    await world.quote(request.id, east.id, 'withdrawn');

    expect((await read()).rows).toEqual([]);
  });

  it('counts an unmet request on the day it closed, today live and not the night, and not before the window', async () => {
    const east = await garageAt('Est', POINT.sector3);
    await asked('BMW', noon(addDays(FIRST, -9)), [east], { at: noon(TODAY) });
    await asked('Audi', noon(addDays(FIRST, -9)), [east], {
      at: new Date(atLocal(FIRST, 0).getTime() - 1),
    });
    await asked('Opel', noon(addDays(FIRST, -9)), [east], {
      at: atLocal(FIRST, 0),
    });

    const live = await figures();
    await writeBrandAreaDaily(prisma, NOW);

    expect(live.map((r) => [r[0], r[4]])).toEqual([
      ['BMW', 1],
      ['Opel', 1],
    ]);
    expect(await figures()).toEqual(live);
  });

  it('counts a request in two areas once in each beside ten thousand searches without loss', async () => {
    const east = await garageAt('Est', POINT.sector3);
    const north = await garageAt('Nord', POINT.sector2);
    await asked('BMW', noon(DAY), [east, north]);
    await searched('BMW', noon(DAY), CELL.sector3, 10_000);

    const live = await figures();
    await writeBrandAreaDaily(prisma, NOW);

    expect(live).toEqual([
      ['BMW', 'sector-3', 10_000, 1, 0, 0, null],
      ['BMW', 'sector-2', 0, 1, 0, 0, null],
    ]);
    expect(await figures()).toEqual(live);
  }, 120_000);
});

describe('search cells that are not cells', () => {
  it.each([
    ['an empty cell', ''],
    ['an upper-case cell', 'SXFSE'],
    ['a letter geohash lacks', 'sxfsa'],
    ['punctuation', 'sx!se'],
    ['a short cell', 'sx'],
    ['a multibyte cell', 'ééééé'],
  ])(
    'counts a search with %s under unknown without failing the night or the read',
    async (_, cell) => {
      await searched('BMW', noon(DAY), cell);
      await searched('BMW', noon(TODAY), cell);

      const live = await read();
      await expect(writeBrandAreaDaily(prisma, NOW)).resolves.toMatchObject({
        days: expect.any(Array),
      });
      const written = await read();

      expect(live.rows.map((r) => [r.area.code, r.searches])).toEqual([
        ['unknown', 2],
      ]);
      expect(written.rows).toEqual(live.rows);
    },
  );
});
