import type { Role } from '@motor-fix/contracts/capabilities';

import { LogRepairModule } from './log-repair.module';
import { addDays, localDay } from '../../bucharest';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { CarHistoryModule } from '../history/history.module';
import { RepairsModule } from '../repairs/repairs.module';

// @traces 062-FR-001 062-FR-002 062-FR-003 062-FR-004 062-FR-005 062-FR-006 062-FR-012

const { bearer, get, post, world } = quotesApp([
  LogRepairModule,
  CarHistoryModule,
  RepairsModule,
]);
const { prisma } = world;

const path = (carId: string) => `/cars/${carId}/repairs`;
const missing = '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80';
const today = () => localDay(new Date());

const body = (over: Record<string, unknown> = {}) => ({
  doneOn: addDays(today(), -10),
  garageName: 'Service Popescu',
  odometerKm: 148_250,
  what: 'Schimb plăcuțe frână',
  ...over,
});

// A driver with a car of 2019 that has no reading or repair yet.
async function scene() {
  const driverId = await world.account('Andrei Ion Marin');
  const car = await world.car(driverId);
  const auth = bearer(driverId, 'driver');
  const log = (over: Record<string, unknown> = {}, carId = car.id) =>
    post(path(carId), body(over), auth);
  return { auth, car, driverId, log };
}

const rows = (carId: string) => prisma.repair.findMany({ where: { carId } });

const reading = (carId: string, km: number, day: string, source: string) =>
  prisma.odometerReading.create({
    data: {
      carId,
      km,
      readOn: new Date(`${day}T00:00:00Z`),
      source: source as 'driver' | 'reception' | 'repair',
    },
  });

const loggedRepair = (
  carId: string,
  over: { createdAt?: Date; doneOn: string; odometerKm: number },
) =>
  prisma.repair.create({
    data: {
      carId,
      createdAt: over.createdAt,
      doneOn: new Date(`${over.doneOn}T00:00:00Z`),
      garageName: 'Service Ionescu',
      odometerKm: over.odometerKm,
      source: 'logged',
      what: 'Revizie',
    },
  });

describe('logging a repair', () => {
  it('answers the saved row as the history reads shape it', async () => {
    const { car, log } = await scene();
    const doneOn = addDays(today(), -10);

    const res = await log({ costBani: 45_000, doneOn });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      car: {
        brandName: expect.any(String),
        id: car.id,
        model: 'Cooper S',
        year: 2019,
      },
      correctedBy: null,
      costBani: 45_000,
      doneOn,
      fromPreviousOwner: false,
      garageId: null,
      garageName: 'Service Popescu',
      id: expect.any(String),
      mechanicName: null,
      odometerKm: 148_250,
      review: null,
      source: 'logged',
      what: 'Schimb plăcuțe frână',
    });
  });

  it('lists the row in both history reads, in date order', async () => {
    const { auth, car, log } = await scene();
    const older = await log({ doneOn: addDays(today(), -30), what: 'Ulei' });
    const newer = await log({ doneOn: addDays(today(), -2), what: 'Frâne' });

    const all = await get('/repairs', auth);
    const mine = await get(path(car.id), auth);

    expect(all.body.items.map((r: { id: string }) => r.id)).toEqual([
      newer.body.id,
      older.body.id,
    ]);
    expect(mine.body.items.map((r: { id: string }) => r.id)).toEqual([
      newer.body.id,
      older.body.id,
    ]);
  });

  it('stores no amount when it is left out or null', async () => {
    const { log } = await scene();
    const left = await log();
    const cleared = await log({ costBani: null });

    expect(left.status).toBe(201);
    expect(left.body.costBani).toBeNull();
    expect(cleared.body.costBani).toBeNull();
  });

  it('makes two rows of two identical posts', async () => {
    const { car, log } = await scene();
    await log();
    await log();
    expect(await rows(car.id)).toHaveLength(2);
  });
});

describe('the edge', () => {
  it.each([
    ['what', 'abc'],
    ['what', 'x'.repeat(120)],
    ['garageName', 'AB'],
    ['garageName', 'x'.repeat(80)],
    ['odometerKm', 0],
    ['odometerKm', 2_000_000],
    ['costBani', 0],
    ['costBani', 100_000_000],
  ])('saves %s at its limit (%p)', async (field, value) => {
    const { log } = await scene();
    const res = await log({ confirm: true, [field]: value });
    expect(res.status).toBe(201);
  });

  it.each([
    ['what', 'ab'],
    ['what', 'x'.repeat(121)],
    ['garageName', 'A'],
    ['garageName', 'x'.repeat(81)],
    ['garageId', 'not-a-uuid'],
    ['doneOn', '2025-02-30'],
    ['doneOn', '01.10.2026'],
    ['odometerKm', -1],
    ['odometerKm', 2_000_001],
    ['odometerKm', 1.5],
    ['costBani', -1],
    ['costBani', 100_000_001],
    ['costBani', 10.5],
    ['confirm', 'yes'],
    ['source', 'motorfix'],
  ])('refuses %s = %p and saves nothing', async (field, value) => {
    const { car, log } = await scene();
    const res = await log({ [field]: value });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain(field);
    expect(await rows(car.id)).toEqual([]);
  });

  it.each(['what', 'doneOn', 'odometerKm', 'garageName'] as const)(
    'refuses a body without %s',
    async (field) => {
      const { auth, car } = await scene();
      const { [field]: _, ...rest } = body();
      const res = await post(path(car.id), rest, auth);
      expect(res.status).toBe(400);
      expect(await rows(car.id)).toEqual([]);
    },
  );

  it('refuses a path id that is not a uuid', async () => {
    const { log } = await scene();
    expect((await log({}, 'golf')).status).toBe(400);
  });
});

describe('who may log', () => {
  it('asks a visitor to sign in', async () => {
    const { car } = await scene();
    const res = await post(path(car.id), body());
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it.each(['garage', 'receptionist', 'mechanic', 'admin'] as Role[])(
    'answers 404 to the %s role, before the edge',
    async (role) => {
      const { car } = await scene();
      const other = await world.account(`Other ${role}`, [role]);
      const res = await post(path(car.id), { what: 'x' }, bearer(other, role));
      expect(res.status).toBe(404);
      expect(await rows(car.id)).toEqual([]);
    },
  );

  it.each(['another driver’s', 'a removed', 'a sold', 'an unknown'])(
    'answers one 404 for %s car and saves nothing',
    async (which) => {
      const { car, driverId, log } = await scene();
      let carId = car.id;
      if (which === 'another driver’s') {
        carId = (await world.car(await world.account('Maria Pop'))).id;
      } else if (which === 'a removed') {
        await prisma.car.update({
          data: { removedAt: new Date() },
          where: { id: car.id },
        });
      } else if (which === 'a sold') {
        const day = new Date(`${today()}T00:00:00Z`);
        await prisma.carOwnership.updateMany({
          data: {
            access: 'former_owner_read_only',
            closedAt: new Date(),
            toDate: day,
          },
          where: { accountId: driverId, carId: car.id },
        });
      } else {
        carId = missing;
      }

      const res = await log({}, carId);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        code: 'not_found',
        message: 'Nu există această mașină',
      });
      expect(await prisma.repair.count()).toBe(0);
    },
  );
});

describe('the garage from the list', () => {
  it('stores the garage’s own name and ignores the typed one', async () => {
    const { log } = await scene();
    const garage = await world.garage('Garaj Nordic');

    const res = await log({ garageId: garage.id, garageName: 'Altceva' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      garageId: garage.id,
      garageName: 'Garaj Nordic',
    });
  });

  it('takes a garage from the list without a typed name', async () => {
    const { auth, car } = await scene();
    const garage = await world.garage('Garaj Nordic');
    const { garageName: _, ...rest } = body({ garageId: garage.id });
    expect((await post(path(car.id), rest, auth)).status).toBe(201);
  });

  it.each(['draft', 'suspended', 'unknown'])(
    'refuses a %s garage alike',
    async (status) => {
      const { car, log } = await scene();
      let garageId = missing;
      if (status !== 'unknown') {
        const garage = await world.garage(`Garaj ${status}`);
        await prisma.garage.update({
          data: { status: status as 'draft' | 'suspended' },
          where: { id: garage.id },
        });
        garageId = garage.id;
      }

      const res = await log({ garageId });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'validation_failed',
        errors: [{ code: 'unknown_garage', field: 'garageId' }],
      });
      expect(await rows(car.id)).toEqual([]);
    },
  );

  it('bounds a typed name beside a garage id', async () => {
    const { log } = await scene();
    const garage = await world.garage('Garaj Nordic');
    expect(
      (await log({ garageId: garage.id, garageName: 'x'.repeat(81) })).status,
    ).toBe(400);
  });
});

describe('the date before the car’s year', () => {
  it('refuses 31 December of the year before, whatever confirm', async () => {
    const { car, log } = await scene();
    for (const confirm of [undefined, true]) {
      const res = await log({ confirm, doneOn: '2018-12-31' });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'date_before_car_year',
        message: 'Data e înainte de anul mașinii',
      });
    }
    expect(await rows(car.id)).toEqual([]);
  });

  it('saves 1 January of the car’s year', async () => {
    const { log } = await scene();
    expect((await log({ doneOn: '2019-01-01' })).status).toBe(201);
  });
});

describe('the future date', () => {
  afterEach(() => vi.useRealTimers());

  it('saves today', async () => {
    const { log } = await scene();
    expect((await log({ doneOn: today() })).status).toBe(201);
  });

  it.each([
    ['tomorrow', 1],
    ['far ahead', 400],
  ])('asks to check %s, then saves with confirm', async (_, days) => {
    const { car, log } = await scene();
    const doneOn = addDays(today(), days);

    const asked = await log({ doneOn });
    expect(asked.status).toBe(409);
    expect(asked.body).toEqual({
      code: 'check_needed',
      errors: [{ code: 'future_date', field: 'doneOn' }],
      message: 'Data e în viitor. Verifică, te rog.',
    });
    expect(await rows(car.id)).toEqual([]);

    expect((await log({ confirm: true, doneOn })).status).toBe(201);
  });

  it('reads today in Bucharest, not in UTC', async () => {
    // 22:30 UTC is 00:30 the next day in Bucharest.
    vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(
      new Date('2027-03-10T22:30:00Z'),
    );
    const { log } = await scene();
    expect((await log({ doneOn: '2027-03-11' })).status).toBe(201);
    expect((await log({ doneOn: '2027-03-12' })).status).toBe(409);
  });
});

describe('the lower odometer', () => {
  const day = () => addDays(today(), -10);

  it.each([
    ['a reception reading', 'reception'],
    ['a driver’s edit reading', 'driver'],
  ])('asks to check a value below %s', async (_, source) => {
    const { car, log } = await scene();
    await reading(car.id, 150_000, addDays(day(), -5), source);

    const res = await log({ odometerKm: 149_999 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: 'check_needed',
      earlierKm: 150_000,
      errors: [{ code: 'odometer_below_earlier', field: 'odometerKm' }],
      message:
        'Kilometrajul e mai mic decât o citire mai veche (150.000 km). Verifică, te rog.',
    });
    expect(await rows(car.id)).toEqual([]);
    expect((await log({ confirm: true, odometerKm: 149_999 })).status).toBe(
      201,
    );
  });

  it('asks to check a value below a repair’s odometer', async () => {
    const { car, log } = await scene();
    await loggedRepair(car.id, {
      doneOn: addDays(day(), -5),
      odometerKm: 150_000,
    });
    const res = await log({ odometerKm: 140_000 });
    expect(res.status).toBe(409);
    expect(res.body.earlierKm).toBe(150_000);
  });

  it('asks to check a value below the car’s first reading', async () => {
    const { car, log } = await scene();
    await reading(car.id, 84_000, addDays(day(), -400), 'driver');
    expect((await log({ odometerKm: 83_000 })).status).toBe(409);
  });

  it('counts a same-day higher reading', async () => {
    const { car, log } = await scene();
    await reading(car.id, 150_000, day(), 'reception');
    expect((await log({ odometerKm: 149_000 })).status).toBe(409);
  });

  it.each([
    ['an equal reading', 148_250, -5],
    ['a later higher reading', 160_000, 5],
  ])('saves beside %s', async (_, km, offset) => {
    const { car, log } = await scene();
    await reading(car.id, km, addDays(day(), offset), 'reception');
    expect((await log({ odometerKm: 148_250 })).status).toBe(201);
  });

  it('saves with no earlier reading at all', async () => {
    const { log } = await scene();
    expect((await log({ odometerKm: 10 })).status).toBe(201);
  });

  it('ignores a previous owner’s hidden logged repair', async () => {
    const { car, log } = await scene();
    await loggedRepair(car.id, {
      createdAt: new Date(Date.now() - 365 * 86_400_000),
      doneOn: addDays(day(), -400),
      odometerKm: 900_000,
    });
    expect((await log({ odometerKm: 148_250 })).status).toBe(201);
  });
});

describe('both checks and the order', () => {
  it('names both checks in one answer, the date’s message first', async () => {
    const { car, log } = await scene();
    await reading(car.id, 150_000, addDays(today(), -5), 'reception');

    const res = await log({ doneOn: addDays(today(), 3), odometerKm: 1_000 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: 'check_needed',
      earlierKm: 150_000,
      errors: [
        { code: 'future_date', field: 'doneOn' },
        { code: 'odometer_below_earlier', field: 'odometerKm' },
      ],
      message: 'Data e în viitor. Verifică, te rog.',
    });
  });

  it('answers the 404 before the garage, the garage before the year', async () => {
    const { car, log } = await scene();
    const other = (await world.car(await world.account('Maria Pop'))).id;
    const late = { doneOn: '2010-01-01', garageId: missing };

    expect((await log(late, other)).status).toBe(404);
    expect((await log(late, car.id)).status).toBe(400);
    expect((await log({ doneOn: '2010-01-01' }, car.id)).status).toBe(422);
  });

  it('answers the year before the checks', async () => {
    const { car, log } = await scene();
    await reading(car.id, 150_000, '2010-01-01', 'reception');
    expect((await log({ doneOn: '2018-06-01', odometerKm: 1 })).status).toBe(
      422,
    );
  });
});
