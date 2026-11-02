import { LogRepairModule } from './log-repair.module';
import { addDays, localDay } from '../../bucharest';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { CarHistoryModule } from '../history/history.module';
import { RepairsModule } from '../repairs/repairs.module';

// @traces 062-FR-001 062-FR-002 062-FR-003 062-FR-004 062-FR-005 062-FR-006 062-FR-007 062-FR-012

const { bearer, get, post, world } = quotesApp([
  LogRepairModule,
  CarHistoryModule,
  RepairsModule,
]);
const { prisma } = world;

const path = (carId: string) => `/cars/${carId}/repairs`;
const today = () => localDay(new Date());

const body = (over: Record<string, unknown> = {}) => ({
  doneOn: addDays(today(), -10),
  garageName: 'Service Popescu',
  odometerKm: 148_250,
  what: 'Schimb plăcuțe frână',
  ...over,
});

async function scene() {
  const driverId = await world.account('Andrei Ion Marin');
  const car = await world.car(driverId);
  const auth = bearer(driverId, 'driver');
  const log = (over: Record<string, unknown> = {}, carId = car.id) =>
    post(path(carId), body(over), auth);
  return { auth, car, driverId, log };
}

const rows = (carId: string) => prisma.repair.findMany({ where: { carId } });
const audits = (carId: string) =>
  prisma.activityLog.count({ where: { carId } });
const events = (carId: string) =>
  prisma.outboxEvent.count({
    where: {
      kind: 'repair.logged',
      payload: { equals: carId, path: ['carId'] },
    },
  });

const reading = (carId: string, km: number, day: string, source: string) =>
  prisma.odometerReading.create({
    data: {
      carId,
      km,
      readOn: new Date(`${day}T00:00:00Z`),
      source: source as 'driver' | 'reception' | 'repair',
    },
  });

const repairRow = (
  carId: string,
  over: { deletedAt?: Date; doneOn: string; odometerKm: number | null },
) =>
  prisma.repair.create({
    data: {
      carId,
      deletedAt: over.deletedAt,
      doneOn: new Date(`${over.doneOn}T00:00:00Z`),
      garageName: 'Service Ionescu',
      odometerKm: over.odometerKm,
      source: 'logged',
      what: 'Revizie',
    },
  });

describe('hostile text', () => {
  it.each([
    ['a newline', 'ab\ncd'],
    ['a tab', 'ab\tcd'],
    ['a NUL byte', 'ab\u0000cd'],
    ['a DEL-range control', 'ab\u0085cd'],
    ['only spaces', '          '],
    ['only non-breaking spaces', '    '],
    ['two characters padded to ten', '    ab    '],
  ])('refuses what holding %s with 400 and no row', async (_, what) => {
    const { car, log } = await scene();
    const res = await log({ what });
    expect(res.status).toBe(400);
    expect(await rows(car.id)).toEqual([]);
  });

  it.each([
    ['a newline', 'Service\nPopescu'],
    ['a NUL byte', 'Service\u0000Popescu'],
    ['only spaces', '     '],
  ])('refuses garageName holding %s with 400', async (_, garageName) => {
    const { car, log } = await scene();
    const res = await log({ garageName });
    expect(res.status).toBe(400);
    expect(await rows(car.id)).toEqual([]);
  });

  it('stores the trimmed what and garage name', async () => {
    const { car, log } = await scene();
    const res = await log({ garageName: '  Garaj Șerban  ', what: '  Ulei  ' });
    expect(res.status).toBe(201);
    const [row] = await rows(car.id);
    expect(row).toMatchObject({ garageName: 'Garaj Șerban', what: 'Ulei' });
  });

  it('counts 120 Romanian letters as 120 characters, not 240 bytes', async () => {
    const { log } = await scene();
    expect((await log({ what: 'ș'.repeat(120) })).status).toBe(201);
    expect((await log({ what: 'ș'.repeat(121) })).status).toBe(400);
  });

  it.each([
    ['what', 'ab\ud800cd'],
    ['what', 'ab\udc00cd'],
    ['garageName', 'Garaj \ud800'],
  ])(
    'refuses %s holding a lone surrogate, never a 500',
    async (field, value) => {
      const { car, log } = await scene();
      const res = await log({ [field]: value });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain(field);
      expect(await prisma.repair.count({ where: { carId: car.id } })).toBe(0);
    },
  );

  it('keeps a paired surrogate, an emoji, as text', async () => {
    const { log } = await scene();
    expect((await log({ what: 'Ulei 🔧' })).status).toBe(201);
  });

  it('keeps an SQL fragment as plain text', async () => {
    const { car, log } = await scene();
    const what = "x'); DROP TABLE repair; --";
    expect((await log({ what })).status).toBe(201);
    expect((await rows(car.id))[0]?.what).toBe(what);
  });
});

describe('hostile shapes', () => {
  it.each([
    ['an array', []],
    ['a string', 'what=abc'],
    ['null', null],
    ['an empty object', {}],
  ])('refuses %s as the body with 400', async (_, payload) => {
    const { auth, car } = await scene();
    const res = await post(path(car.id), payload, auth);
    expect(res.status).toBe(400);
    expect(await rows(car.id)).toEqual([]);
  });

  it.each([
    ['loggedBy', '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80'],
    ['updatedBy', '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80'],
    ['updatedByRole', 'garage'],
    ['sharedWithGarage', true],
    ['jobId', '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80'],
    ['carId', '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80'],
    ['deletedAt', '2026-01-01T00:00:00Z'],
    ['ownerId', '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80'],
  ])('refuses the unknown field %s', async (field, value) => {
    const { car, log } = await scene();
    const res = await log({ [field]: value });
    expect(res.status).toBe(400);
    expect(await rows(car.id)).toEqual([]);
  });

  it('refuses a __proto__ key', async () => {
    const { auth, car } = await scene();
    const raw = `{"what":"Ulei","garageName":"Service","doneOn":"${addDays(today(), -3)}","odometerKm":1,"__proto__":{"source":"motorfix"}}`;
    const res = await post(path(car.id), JSON.parse(raw), auth);
    expect([201, 400]).toContain(res.status);
    for (const row of await rows(car.id)) expect(row.source).toBe('logged');
  });

  it.each([
    ['odometerKm', '148250'],
    ['odometerKm', null],
    ['odometerKm', true],
    ['odometerKm', [1]],
    ['odometerKm', 1e21],
    ['costBani', '100'],
    ['costBani', true],
    ['costBani', [0]],
    ['what', 12345],
    ['what', ['Ulei']],
    ['what', null],
    ['garageName', 12345],
    ['garageName', null],
    ['doneOn', null],
    ['doneOn', 20261001],
    ['doneOn', '2026-1-5'],
    ['doneOn', '2026-10-01T00:00:00Z'],
    ['doneOn', ' 2026-10-01'],
    ['doneOn', '2026-10-01 '],
    ['doneOn', '2026-13-01'],
    ['doneOn', '2023-02-29'],
    ['doneOn', '0000-01-01'],
    ['doneOn', '10000-01-01'],
    ['doneOn', '２０２６-１０-０１'],
    ['confirm', null],
    ['confirm', 1],
    ['confirm', 'true'],
    ['confirm', []],
  ])('refuses %s = %p with 400 and no row', async (field, value) => {
    const { car, log } = await scene();
    const res = await log({ [field]: value });
    expect(res.status).toBe(400);
    expect(await rows(car.id)).toEqual([]);
  });

  it('refuses a garageId of null without a garage name rather than storing no name', async () => {
    const { auth, car } = await scene();
    const { garageName: _, ...rest } = body({ garageId: null });
    const res = await post(path(car.id), rest, auth);
    expect(res.status).toBe(400);
    expect(await rows(car.id)).toEqual([]);
  });

  it('accepts a garageId in capitals and stores the lower-case id', async () => {
    const { car, log } = await scene();
    const garage = await world.garage('Garaj Nordic');
    const res = await log({ garageId: garage.id.toUpperCase() });
    expect(res.status).toBe(201);
    expect(res.body.garageId).toBe(garage.id);
    expect((await rows(car.id))[0]?.garageId).toBe(garage.id);
  });

  it('refuses a five megabyte what with 400 or 413 and no row', async () => {
    const { car, log } = await scene();
    const res = await log({ what: 'x'.repeat(5_000_000) });
    expect([400, 413]).toContain(res.status);
    expect(await rows(car.id)).toEqual([]);
  });

  it('refuses a form-encoded body', async () => {
    const { auth, car } = await scene();
    const res = await post(path(car.id), 'what=Ulei&doneOn=2026-01-01', auth);
    expect(res.status).toBe(400);
    expect(await rows(car.id)).toEqual([]);
  });
});

describe('refusals leave nothing behind', () => {
  it.each([
    ['the future date', { doneOn: addDays(today(), 5) }, 409],
    ['the year', { doneOn: '2018-12-31' }, 422],
    [
      'an unknown garage',
      { garageId: '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80' },
      400,
    ],
    ['an edge limit', { odometerKm: -1 }, 400],
  ])('writes no row, audit entry or event for %s', async (_, over, status) => {
    const { car, log } = await scene();
    const res = await log(over);
    expect(res.status).toBe(status);
    expect(await rows(car.id)).toEqual([]);
    expect(await audits(car.id)).toBe(0);
    expect(await events(car.id)).toBe(0);
  });

  it('answers the edge 400 before the car 404', async () => {
    const { log } = await scene();
    const res = await log(
      { what: 'ab' },
      '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80',
    );
    expect(res.status).toBe(400);
  });

  it('answers confirm false like a missing confirm', async () => {
    const { car, log } = await scene();
    const res = await log({ confirm: false, doneOn: addDays(today(), 1) });
    expect(res.status).toBe(409);
    expect(await rows(car.id)).toEqual([]);
  });

  it('answers 404 to a car of the caller in capitals of its id only as the same car', async () => {
    const { car, log } = await scene();
    const res = await log({}, car.id.toUpperCase());
    expect(res.status).toBe(201);
  });
});

describe('many posts at once', () => {
  it('makes one row, one audit entry and one event per post of twelve in parallel', async () => {
    const { car, log } = await scene();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => log({ what: `Reparatie ${i}` })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
    expect(await rows(car.id)).toHaveLength(12);
    expect(await audits(car.id)).toBe(12);
    expect(await events(car.id)).toBe(12);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(12);
  });

  it('reads back the newest first when two share a day', async () => {
    const { auth, car, log } = await scene();
    const first = await log({ what: 'Prima' });
    const second = await log({ what: 'A doua' });
    const mine = await get(path(car.id), auth);
    expect(mine.body.items.map((r: { id: string }) => r.id)).toEqual([
      second.body.id,
      first.body.id,
    ]);
  });
});

describe('the odometer check reads only what it should', () => {
  const day = () => addDays(today(), -10);

  it('ignores a deleted repair', async () => {
    const { car, log } = await scene();
    await repairRow(car.id, {
      deletedAt: new Date(),
      doneOn: addDays(day(), -5),
      odometerKm: 900_000,
    });
    expect((await log()).status).toBe(201);
  });

  it('ignores a repair without an odometer', async () => {
    const { car, log } = await scene();
    await repairRow(car.id, { doneOn: addDays(day(), -5), odometerKm: null });
    expect((await log({ odometerKm: 0 })).status).toBe(201);
  });

  it('ignores another car’s higher reading', async () => {
    const { log } = await scene();
    const other = await world.car(await world.account('Maria Pop'));
    await reading(other.id, 900_000, addDays(day(), -5), 'reception');
    expect((await log()).status).toBe(201);
  });

  it('answers the highest of repairs and readings as earlierKm', async () => {
    const { car, log } = await scene();
    await repairRow(car.id, {
      doneOn: addDays(day(), -20),
      odometerKm: 150_000,
    });
    await reading(car.id, 160_000, addDays(day(), -10), 'driver');
    await reading(car.id, 155_000, addDays(day(), -3), 'reception');
    const res = await log({ odometerKm: 100 });
    expect(res.status).toBe(409);
    expect(res.body.earlierKm).toBe(160_000);
  });

  it('counts only readings on or before the day, not a higher one after it', async () => {
    const { car, log } = await scene();
    await reading(car.id, 150_000, addDays(day(), -5), 'reception');
    await reading(car.id, 170_000, addDays(day(), 1), 'reception');
    const low = await log({ odometerKm: 149_999 });
    expect(low.status).toBe(409);
    expect(low.body.earlierKm).toBe(150_000);
    expect((await log({ odometerKm: 155_000 })).status).toBe(201);
  });

  it('asks only the odometer question when the date is fine', async () => {
    const { car, log } = await scene();
    await reading(car.id, 150_000, addDays(day(), -5), 'driver');
    const res = await log({ odometerKm: 1 });
    expect(res.body.errors).toEqual([
      { code: 'odometer_below_earlier', field: 'odometerKm' },
    ]);
  });

  it('keeps earlierKm out of a date-only answer', async () => {
    const { log } = await scene();
    const res = await log({ doneOn: addDays(today(), 2) });
    expect(res.status).toBe(409);
    expect(res.body).not.toHaveProperty('earlierKm');
  });

  it('counts the first reading of a repair dated before it', async () => {
    const { car, log } = await scene();
    await reading(car.id, 1_000, '2019-01-01', 'driver');
    expect((await log({ doneOn: '2019-01-01', odometerKm: 999 })).status).toBe(
      409,
    );
    expect(
      (await log({ doneOn: '2019-01-01', odometerKm: 1_000 })).status,
    ).toBe(201);
  });
});

describe('today in Bucharest around the clock changes', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    [
      'just before midnight in summer time',
      '2027-07-10T20:59:00Z',
      '2027-07-10',
      '2027-07-11',
    ],
    [
      'at midnight in summer time',
      '2027-07-10T21:00:00Z',
      '2027-07-11',
      '2027-07-12',
    ],
    [
      'just before midnight in winter time',
      '2027-12-10T21:59:00Z',
      '2027-12-10',
      '2027-12-11',
    ],
    [
      'at midnight in winter time',
      '2027-12-10T22:00:00Z',
      '2027-12-11',
      '2027-12-12',
    ],
    [
      'the evening the clocks go back',
      '2027-10-30T21:30:00Z',
      '2027-10-31',
      '2027-11-01',
    ],
    [
      'the night the clocks go back, after the change',
      '2027-10-31T21:30:00Z',
      '2027-10-31',
      '2027-11-01',
    ],
    [
      'the night the clocks go forward',
      '2027-03-27T22:30:00Z',
      '2027-03-28',
      '2027-03-29',
    ],
  ])('%s: today saves, the next day asks', async (_, now, todayLocal, next) => {
    vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(new Date(now));
    const { log } = await scene();
    expect((await log({ doneOn: todayLocal })).status).toBe(201);
    expect((await log({ doneOn: next })).status).toBe(409);
  });
});

describe('the car’s year', () => {
  it('refuses 1 January of the year before and saves 31 December of the year', async () => {
    const { log } = await scene();
    expect((await log({ doneOn: '2019-12-31' })).status).toBe(201);
    expect((await log({ doneOn: '2018-01-01' })).status).toBe(422);
  });

  it('refuses a leap day long before the car’s year with 422, not 400', async () => {
    const { log } = await scene();
    expect((await log({ doneOn: '2000-02-29' })).status).toBe(422);
  });

  it('answers 422 before 409 for a date before the year with a lower odometer', async () => {
    const { car, log } = await scene();
    await reading(car.id, 150_000, '2010-01-01', 'driver');
    const res = await log({ doneOn: '2018-12-31', odometerKm: 1 });
    expect(res.status).toBe(422);
  });
});

describe('a sold car after a transfer', () => {
  it('lets the new owner log and refuses the seller', async () => {
    const { car, driverId, log } = await scene();
    const buyer = await world.account('Cumpărător Nou');
    const day = new Date(`${today()}T00:00:00Z`);
    await prisma.carOwnership.updateMany({
      data: {
        access: 'former_owner_read_only',
        closedAt: new Date(),
        toDate: day,
      },
      where: { accountId: driverId, carId: car.id },
    });
    await prisma.carOwnership.create({
      data: {
        access: 'owner',
        accountId: buyer,
        carId: car.id,
        fromDate: day,
        openedAt: new Date(),
      },
    });
    await prisma.car.update({
      data: { ownerId: buyer },
      where: { id: car.id },
    });
    expect((await log()).status).toBe(404);
    const res = await post(path(car.id), body(), bearer(buyer, 'driver'));
    expect(res.status).toBe(201);
    expect((await rows(car.id))[0]?.loggedBy).toBe(buyer);
  });
});
