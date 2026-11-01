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
import { readDemand, writeDemandDaily } from '../demand';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

// Saturday 17 October 2026, 11:00 in Bucharest: the window is 18 September
// to 17 October; 10 October is a closed day of it.
const TODAY = '2026-10-17';
const NOW = atLocal(TODAY, 11);
const FIRST = '2026-09-18';
const DAY = '2026-10-10';

// Points checked against areas.json, and the cells whose centres lie in the
// same area.
const POINT = {
  cluj: { lat: 46.77, lng: 23.59 },
  open: { lat: 45.5, lng: 25 },
  sector1: { lat: 44.49, lng: 26.06 },
  sector2: { lat: 44.455, lng: 26.14 },
  sector3: { lat: 44.415, lng: 26.17 },
} as const;
const CELL = {
  cluj: 'u82f0',
  open: 'u81fb',
  sector1: 'sxft1',
  sector2: 'sxfsf',
  sector3: 'sxfse',
} as const;

const AREA = {
  cluj: { code: 'cluj-napoca', kind: 'city', name: 'Cluj-Napoca' },
  sector1: { code: 'sector-1', kind: 'sector', name: 'Sector 1' },
  sector2: { code: 'sector-2', kind: 'sector', name: 'Sector 2' },
  sector3: { code: 'sector-3', kind: 'sector', name: 'Sector 3' },
  unknown: { code: 'unknown', kind: 'unknown', name: 'Zonă necunoscută' },
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

// A garage at `point` (none: no position) taking or refusing the brands named.
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
      // Fuels stay only on a brand worked on (garage_brand_fuel_check).
      data: {
        brandId: id,
        garageId: garage.id,
        stance,
        ...(stance === 'works_on'
          ? {}
          : { diesel: false, electric: false, hybrid: false, petrol: false }),
      },
    });
  }
  return garage;
}

// `times` searches for the brand, logged at `at` from `cell` (null: none).
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

// A request for `brand` created at `at`, sent to `garages`; closed
// `expired` (or `cancelled`) at `closedAt` when given.
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

const areaRows = (day: string) =>
  prisma.demandDaily.findMany({
    orderBy: { key: 'asc' },
    select: {
      key: true,
      requests: true,
      searches: true,
      unmetRequests: true,
    },
    where: { day: new Date(day), dimension: 'brand_area' },
  });

const noon = (day: string) => atLocal(day, 12);
// 23:59 in Bucharest, the day's last minute.
const lastMinute = (day: string) =>
  new Date(atLocal(addDays(day, 1), 0).getTime() - 60_000);

describe('the nightly brand-area rows', () => {
  it('counts a search once for its brand and the area of its cell, and one without a cell under unknown', async () => {
    await searched('BMW', noon(DAY), CELL.sector3, 2);
    await searched('BMW', noon(DAY), null);
    await searched('BMW', noon(DAY), CELL.open);
    await searched('Dacia', lastMinute(DAY), CELL.cluj);

    await writeBrandAreaDaily(prisma, NOW);

    expect(await areaRows(DAY)).toEqual([
      { key: 'all', requests: 0, searches: 5, unmetRequests: 0 },
      { key: 'cluj-napoca:Dacia', requests: 0, searches: 1, unmetRequests: 0 },
      { key: 'sector-3:BMW', requests: 0, searches: 2, unmetRequests: 0 },
      { key: 'unknown:BMW', requests: 0, searches: 2, unmetRequests: 0 },
    ]);
  });

  it('counts a request once in each distinct area it was sent to, and a recipient in no area under unknown', async () => {
    const east = await garageAt('Est', POINT.sector3);
    const east2 = await garageAt('Est 2', POINT.sector3);
    const north = await garageAt('Nord', POINT.sector2);
    const lost = await garageAt('Fără adresă', null);
    await asked('BMW', noon(DAY), [east, east2, north]);
    await asked('BMW', noon(DAY), [lost]);

    await writeBrandAreaDaily(prisma, NOW);

    expect(await areaRows(DAY)).toEqual([
      { key: 'all', requests: 3, searches: 0, unmetRequests: 0 },
      { key: 'sector-2:BMW', requests: 1, searches: 0, unmetRequests: 0 },
      { key: 'sector-3:BMW', requests: 1, searches: 0, unmetRequests: 0 },
      { key: 'unknown:BMW', requests: 1, searches: 0, unmetRequests: 0 },
    ]);
  });

  it('counts an expired request with no quote as unmet on the day it closed, and not one quoted or cancelled', async () => {
    const east = await garageAt('Est', POINT.sector3);
    const north = await garageAt('Nord', POINT.sector2);
    // Created before the window, expired on DAY: unmet exceeds requests.
    const before = addDays(FIRST, -3);
    await asked('BMW', noon(before), [east, north], { at: noon(DAY) });
    await asked('BMW', noon(before), [east], { at: noon(DAY) });
    const quoted = await asked('BMW', noon(before), [east], { at: noon(DAY) });
    await world.quote(quoted.id, east.id);
    await asked('BMW', noon(before), [east], {
      at: noon(DAY),
      reason: 'cancelled',
    });

    await writeBrandAreaDaily(prisma, NOW);

    expect(await areaRows(DAY)).toEqual([
      { key: 'all', requests: 0, searches: 0, unmetRequests: 3 },
      { key: 'sector-2:BMW', requests: 0, searches: 0, unmetRequests: 1 },
      { key: 'sector-3:BMW', requests: 0, searches: 0, unmetRequests: 2 },
    ]);
  });

  it('writes every closed day of the window once, with its marker even when the day had nothing', async () => {
    await searched('BMW', noon(DAY), CELL.sector3);

    const first = await writeBrandAreaDaily(prisma, NOW);
    const rows = await areaRows(DAY);
    const again = await writeBrandAreaDaily(prisma, NOW);

    expect(first.days).toHaveLength(29);
    expect(first.days[0]).toBe(FIRST);
    expect(first.written).toBe(30);
    expect(again).toEqual({ days: [], written: 0 });
    expect(await areaRows(DAY)).toEqual(rows);
    expect(await areaRows(addDays(DAY, 1))).toEqual([
      { key: 'all', requests: 0, searches: 0, unmetRequests: 0 },
    ]);
    expect(await areaRows(TODAY)).toEqual([]);
    expect(
      await prisma.demandDaily.findFirst({
        select: { writtenAt: true },
        where: { day: new Date(DAY), dimension: 'brand_area', key: 'all' },
      }),
    ).toEqual({ writtenAt: NOW });
  });

  it('writes no day while the areas are not loaded, so no day is marked with every row unknown', async () => {
    await searched('BMW', noon(DAY), CELL.sector3);
    await prisma.$executeRawUnsafe('TRUNCATE area');
    try {
      expect(await writeBrandAreaDaily(prisma, NOW)).toEqual({
        days: [],
        written: 0,
      });
      expect(await areaRows(DAY)).toEqual([]);
    } finally {
      await new AreaLoader(prisma).load(AREAS);
    }
  });

  it('back-fills a day written before the brand-area rows and leaves its brand, job and total rows as they are', async () => {
    await searched('BMW', noon(DAY), CELL.sector3);
    await writeDemandDaily(prisma, NOW);
    const before = await prisma.demandDaily.findMany({
      orderBy: [{ dimension: 'asc' }, { key: 'asc' }],
      where: { day: new Date(DAY) },
    });

    await writeBrandAreaDaily(prisma, NOW);
    await writeDemandDaily(prisma, NOW);

    expect(
      await prisma.demandDaily.findMany({
        orderBy: [{ dimension: 'asc' }, { key: 'asc' }],
        where: { day: new Date(DAY), dimension: { not: 'brand_area' } },
      }),
    ).toEqual(before);
    expect(before.every((row) => row.unmetRequests === 0)).toBe(true);
    expect(await areaRows(DAY)).toEqual([
      { key: 'all', requests: 0, searches: 1, unmetRequests: 0 },
      { key: 'sector-3:BMW', requests: 0, searches: 1, unmetRequests: 0 },
    ]);
  });

  it('keeps the brand-area rows when the day is written again for its total', async () => {
    await searched('BMW', noon(DAY), CELL.sector3);
    await writeBrandAreaDaily(prisma, NOW);

    await writeDemandDaily(prisma, NOW);

    expect(await areaRows(DAY)).toEqual([
      { key: 'all', requests: 0, searches: 1, unmetRequests: 0 },
      { key: 'sector-3:BMW', requests: 0, searches: 1, unmetRequests: 0 },
    ]);
  });
});

describe('demand against supply', () => {
  const read = (query: { brand?: string; area?: string } = {}) =>
    readDemandSupply(prisma, NOW, query);

  // The Build brief's example, BMW in Sector 3 and Tesla in Cluj-Napoca.
  async function brief() {
    const garages = [];
    for (let i = 1; i <= 4; i++)
      garages.push(
        await garageAt(`BMW ${i}`, POINT.sector3, { BMW: 'works_on' }),
      );
    await garageAt('Fără Tesla', POINT.cluj, { Tesla: 'does_not_take' });
    await searched('BMW', noon(DAY), CELL.sector3, 420);
    await searched('Tesla', noon(DAY), CELL.cluj, 85);
    for (let i = 0; i < 96; i++)
      await asked(
        'BMW',
        noon(addDays(DAY, -2)),
        [garages[i % 4]],
        i < 12 ? { at: noon(DAY) } : undefined,
      );
  }

  // @traces 106-FR-014
  it("answers the brief's figures for BMW in Sector 3 and Tesla in Cluj-Napoca", async () => {
    await brief();

    const answer = await read();

    expect(answer).toMatchObject({
      firstDay: FIRST,
      lastDay: TODAY,
      writtenAt: null,
    });
    expect(answer.rows).toEqual([
      {
        area: AREA.sector3,
        brand: 'BMW',
        requests: 96,
        requestsPerGarage: 24,
        searches: 420,
        supply: 4,
        unmet: 12,
      },
      {
        area: AREA.cluj,
        brand: 'Tesla',
        requests: 0,
        requestsPerGarage: null,
        searches: 85,
        supply: 0,
        unmet: 0,
      },
    ]);
  });

  it('answers the same figures once the night has written the days', async () => {
    await brief();
    const live = await read();

    await writeBrandAreaDaily(prisma, NOW);
    const written = await read();

    expect(written.rows).toEqual(live.rows);
    expect(written.writtenAt).toBe(NOW.toISOString());
  });

  it('counts today and a closed day the night left unwritten live, beside the written ones', async () => {
    await searched('BMW', noon(DAY), CELL.sector3);
    await writeBrandAreaDaily(prisma, NOW);
    await prisma.demandDaily.deleteMany({
      where: { day: new Date(addDays(DAY, 1)), dimension: 'brand_area' },
    });
    await searched('BMW', noon(addDays(DAY, 1)), CELL.sector3, 2);
    await searched('BMW', atLocal(TODAY, 9), CELL.sector3, 4);
    await searched('BMW', lastMinute(addDays(FIRST, -1)), CELL.sector3);

    expect((await read()).rows).toEqual([
      expect.objectContaining({
        area: AREA.sector3,
        brand: 'BMW',
        searches: 7,
      }),
    ]);
  });

  it('counts as supply only the approved garages there that work on the brand, a mobile mechanic by its seat', async () => {
    await garageAt('Da', POINT.sector3, { BMW: 'works_on' });
    const mobile = await garageAt('Mobil', POINT.sector3, { BMW: 'works_on' });
    await prisma.garage.update({
      data: { businessKind: 'mobile', seatAddress: 'Str. Baba Novac 1' },
      where: { id: mobile.id },
    });
    await garageAt('Nu', POINT.sector3, { BMW: 'does_not_take' });
    await garageAt('Fără mărci', POINT.sector3);
    await garageAt('Altă marcă', POINT.sector3, { Audi: 'works_on' });
    await garageAt(
      'Suspendat',
      POINT.sector3,
      { BMW: 'works_on' },
      'suspended',
    );
    await garageAt('Ciornă', POINT.sector3, { BMW: 'works_on' }, 'draft');
    await garageAt('Alt sector', POINT.sector1, { BMW: 'works_on' });
    await garageAt('Fără adresă', null, { BMW: 'works_on' });
    await searched('BMW', noon(DAY), CELL.sector3);
    await searched('BMW', noon(DAY), null);

    expect(
      (await read()).rows.map(({ area, supply }) => [area.code, supply]),
    ).toEqual([
      ['sector-3', 2],
      ['unknown', 1],
    ]);
  });

  it('rounds the requests per garage to the nearest whole number', async () => {
    const garages = [];
    for (let i = 1; i <= 4; i++)
      garages.push(
        await garageAt(`G${i}`, POINT.sector2, { Audi: 'works_on' }),
      );
    for (let i = 0; i < 10; i++)
      await asked('Audi', noon(DAY), [garages[i % 4]]);

    expect((await read()).rows[0]).toMatchObject({
      requests: 10,
      requestsPerGarage: 3,
      supply: 4,
    });
  });

  it('answers a row for unmet requests alone', async () => {
    const east = await garageAt('Est', POINT.sector3);
    await asked('Opel', noon(addDays(FIRST, -5)), [east], { at: noon(DAY) });

    expect((await read()).rows).toEqual([
      {
        area: AREA.sector3,
        brand: 'Opel',
        requests: 0,
        requestsPerGarage: null,
        searches: 0,
        supply: 0,
        unmet: 1,
      },
    ]);
  });

  it('orders by unmet, searches and requests, most first, then brand and area name', async () => {
    const east = await garageAt('Est', POINT.sector3);
    await asked('Audi', noon(addDays(FIRST, -5)), [east], { at: noon(DAY) });
    await searched('Audi', noon(DAY), CELL.sector1, 3);
    await searched('BMW', noon(DAY), CELL.sector1, 3);
    await searched('BMW', noon(DAY), CELL.sector2, 3);
    await searched('audi', noon(DAY), CELL.sector2, 3);
    // Dacia and Citroën tie on searches; Dacia's request puts it first.
    const north = await garageAt('Nord', POINT.sector2);
    await searched('Dacia', noon(DAY), CELL.sector2, 1);
    await asked('Dacia', noon(DAY), [north]);
    await searched('Citroën', noon(DAY), CELL.sector2, 1);

    expect(
      (await read()).rows.map((row) => `${row.brand} ${row.area.code}`),
    ).toEqual([
      'Audi sector-3',
      'Audi sector-1',
      'BMW sector-1',
      'BMW sector-2',
      'audi sector-2',
      'Dacia sector-2',
      'Citroën sector-2',
    ]);
  });

  it('keeps the rows of the brand, the area, or both, asked for', async () => {
    await searched('BMW', noon(DAY), CELL.sector3);
    await searched('BMW', noon(DAY), CELL.cluj);
    await searched('Dacia', noon(DAY), CELL.sector3);
    await searched('Dacia', noon(DAY), null);
    const pairs = async (query: { brand?: string; area?: string }) =>
      (await read(query)).rows.map((row) => `${row.brand} ${row.area.code}`);

    expect(await pairs({ brand: 'BMW' })).toEqual([
      'BMW cluj-napoca',
      'BMW sector-3',
    ]);
    expect(await pairs({ area: 'sector-3' })).toEqual([
      'BMW sector-3',
      'Dacia sector-3',
    ]);
    expect(await pairs({ area: 'unknown' })).toEqual(['Dacia unknown']);
    expect(await pairs({ area: 'sector-3', brand: 'Dacia' })).toEqual([
      'Dacia sector-3',
    ]);
    expect(await pairs({ brand: 'bmw' })).toEqual([]);
  });

  it('refuses an area that is not one', async () => {
    await expect(read({ area: 'nowhere' })).rejects.toThrow(
      new BadRequestException('validation_failed'),
    );
  });

  it('lists every area by code, then the unknown one, whatever the filter', async () => {
    const { areas } = await read({ area: 'sector-3' });

    expect(areas).toHaveLength(48);
    expect(areas[0]).toEqual({
      code: 'alba-iulia',
      kind: 'city',
      name: 'Alba Iulia',
    });
    expect(areas.at(-1)).toEqual(AREA.unknown);
    expect(areas.map((a) => a.code).slice(0, -1)).toEqual(
      AREAS.map((a) => a.code).sort(),
    );
  });

  // @traces 106-FR-003
  it("sums a brand's searches over the areas to the demand read's", async () => {
    await searched('BMW', noon(DAY), CELL.sector3, 2);
    await searched('BMW', noon(DAY), null, 3);
    await searched('BMW', atLocal(TODAY, 8), CELL.cluj);
    await writeDemandDaily(prisma, NOW);

    const supply = await read({ brand: 'BMW' });
    const demand = await readDemand(prisma, NOW);

    expect(supply.rows.reduce((n, row) => n + row.searches, 0)).toBe(
      demand.brands.find((b) => b.name === 'BMW')?.searches,
    );
  });
});
