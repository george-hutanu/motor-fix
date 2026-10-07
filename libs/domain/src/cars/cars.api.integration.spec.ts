import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CarsModule } from './cars.module';
import { AuditService } from '../audit/audit.service';
import { signAccessToken } from '../auth/access-token';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { serialDatabase } from '../auth/serial-db.testing';
import { localDay } from '../bucharest';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(15);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
// The history and the outbox are never emptied: each test reads its own.
let since: Date;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      CarsModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
});

afterEach(() => {
  jest.restoreAllMocks();
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const today = localDay(new Date());
const yearsAhead = (n: number) =>
  `${Number(today.slice(0, 4)) + n}${today.slice(4)}`;
const nextYear = Number(today.slice(0, 4)) + 1;

// The catalogue outlives the reset, and a brand's name is unique.
async function brand(name: string, active = true) {
  const key = `test-${name.toLowerCase()}`;
  return prisma.brand.upsert({
    create: { active, key, name, slug: key },
    update: { active },
    where: { name },
  });
}

const bmw320d = (brandId: string, extra: Record<string, unknown> = {}) => ({
  brandId,
  fuel: 'diesel',
  model: '320d',
  odometerKm: 148200,
  year: 2019,
  ...extra,
});

const add = (
  auth: string | null,
  body: Record<string, unknown>,
  key: string | null = randomUUID(),
) => {
  const call = http().post('/cars').send(body);
  if (auth) call.set('Authorization', auth);
  if (key !== null) call.set('Idempotency-Key', key);
  return call;
};

const list = (auth: string | null) => {
  const call = http().get('/cars');
  return auth ? call.set('Authorization', auth) : call;
};

const cars = (ownerId: string) => prisma.car.count({ where: { ownerId } });

async function driver(name = 'andrei') {
  const id = await account(name, ['driver']);
  return { auth: bearer(id, 'driver'), id };
}

// Cars inserted directly, as an account that already holds some would have.
async function holding(ownerId: string, brandId: string, n: number) {
  await prisma.car.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      brandId,
      fuel: 'petrol' as const,
      idempotencyKey: `held-${i}`,
      model: `Model ${i}`,
      odometerKm: 1000,
      ownerId,
      year: 2015,
    })),
  });
}

describe('POST /cars', () => {
  it('saves the car for the driver and answers it as the owner sees it', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');

    const res = await add(
      auth,
      bmw320d(brandId, {
        engine: '  2.0 TDI ',
        itpUntil: '2026-11-13',
        model: '  320d ',
        plate: 'b 123 abc',
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      brandId,
      brandName: 'BMW',
      createdAt: expect.any(String),
      engine: '2.0 TDI',
      fuel: 'diesel',
      id: expect.any(String),
      itpUntil: '2026-11-13',
      model: '320d',
      odometerKm: 148200,
      plate: 'B123ABC',
      rcaUntil: null,
      rovinietaUntil: null,
      year: 2019,
    });
    const row = await prisma.car.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row).toMatchObject({
      nextServiceKm: null,
      ownerId: id,
      plate: 'B123ABC',
      removedAt: null,
    });
  });

  it('leaves the optional fields empty when none is sent', async () => {
    const { auth } = await driver();
    const { id: brandId } = await brand('Dacia');

    const res = await add(auth, bmw320d(brandId));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      engine: null,
      itpUntil: null,
      plate: null,
      rcaUntil: null,
      rovinietaUntil: null,
    });
  });

  it.each([
    ['an empty model', { model: '   ' }],
    ['a model of 41 characters', { model: 'x'.repeat(41) }],
    ['a model with a control character', { model: '320\u0007d' }],
    ['year 1949', { year: 1949 }],
    ['the year after next', { year: nextYear + 1 }],
    ['a year that is not whole', { year: 2019.5 }],
    ['-1 km', { odometerKm: -1 }],
    ['2 000 001 km', { odometerKm: 2_000_001 }],
    ['an unknown fuel', { fuel: 'lpg' }],
    ['an engine of 31 characters', { engine: 'x'.repeat(31) }],
    ['a plate of 1 character', { plate: 'B' }],
    ['a plate of 13 characters', { plate: 'B123ABCDEFGHI' }],
    ['a plate with other characters', { plate: 'B 123 ĂBC' }],
    ['a date that is not a date', { itpUntil: '2026-02-30' }],
    ['a date with a time', { rcaUntil: '2026-11-13T10:00:00Z' }],
    ['a brand that is not an id', { brandId: 'bmw' }],
    ['an unknown field', { colour: 'red' }],
  ])('refuses %s and saves nothing', async (_, change) => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');

    const res = await add(auth, { ...bmw320d(brandId), ...change });

    expect(res.status).toBe(400);
    expect(await cars(id)).toBe(0);
  });

  it.each(['brandId', 'model', 'year', 'odometerKm', 'fuel'])(
    'refuses a car without %s',
    async (field) => {
      const { auth, id } = await driver();
      const { id: brandId } = await brand('BMW');
      const body: Record<string, unknown> = bmw320d(brandId);
      delete body[field];

      expect((await add(auth, body)).status).toBe(400);
      expect(await cars(id)).toBe(0);
    },
  );

  it('takes the limits themselves', async () => {
    const { auth } = await driver();
    const { id: brandId } = await brand('BMW');

    const low = await add(auth, {
      ...bmw320d(brandId),
      engine: 'x'.repeat(30),
      model: 'x',
      odometerKm: 0,
      plate: 'B1',
      year: 1950,
    });
    const high = await add(auth, {
      ...bmw320d(brandId),
      itpUntil: yearsAhead(5),
      model: 'x'.repeat(40),
      odometerKm: 2_000_000,
      plate: 'ABCDEF123456',
      rcaUntil: '2001-01-01',
      year: nextYear,
    });

    expect([low.status, high.status]).toEqual([201, 201]);
  });

  it.each(['itpUntil', 'rcaUntil', 'rovinietaUntil'])(
    'refuses %s more than five years ahead as too_far_ahead',
    async (field) => {
      const { auth, id } = await driver();
      const { id: brandId } = await brand('BMW');
      const tooFar = `${yearsAhead(5).slice(0, 8)}${today.slice(8)}`;
      const after = new Date(`${tooFar}T12:00:00Z`);
      after.setUTCDate(after.getUTCDate() + 1);

      const res = await add(auth, {
        ...bmw320d(brandId),
        [field]: after.toISOString().slice(0, 10),
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'validation_failed',
        errors: [{ code: 'too_far_ahead', field }],
      });
      expect(await cars(id)).toBe(0);
    },
  );

  it('accepts a date in the past', async () => {
    const { auth } = await driver();
    const { id: brandId } = await brand('BMW');

    const res = await add(auth, {
      ...bmw320d(brandId),
      itpUntil: '2020-03-01',
    });

    expect(res.status).toBe(201);
    expect(res.body.itpUntil).toBe('2020-03-01');
  });

  it.each([
    ['an unknown brand', async () => randomUUID()],
    ['a retired brand', async () => (await brand('Marcă retrasă', false)).id],
  ])('refuses %s as unknown_brand', async (_, brandOf) => {
    const { auth, id } = await driver();

    const res = await add(auth, bmw320d(await brandOf()));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'unknown_brand', field: 'brandId' }],
    });
    expect(await cars(id)).toBe(0);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const { id: brandId } = await brand('BMW');

    const res = await add(null, bmw320d(brandId));

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });
});

describe('the 20-car limit', () => {
  it('refuses the 21st car with car_limit', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');
    await holding(id, brandId, 19);

    const twentieth = await add(auth, bmw320d(brandId));
    const twentyFirst = await add(auth, bmw320d(brandId));

    expect(twentieth.status).toBe(201);
    expect(twentyFirst.status).toBe(409);
    expect(twentyFirst.body.code).toBe('car_limit');
    expect(await cars(id)).toBe(20);
  });

  it('counts only the cars not removed', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');
    await holding(id, brandId, 20);
    await prisma.car.updateMany({
      data: { removedAt: new Date() },
      where: { idempotencyKey: 'held-0', ownerId: id },
    });

    expect((await add(auth, bmw320d(brandId))).status).toBe(201);
  });

  it('creates one car, not two, from two parallel saves at 19 cars', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');
    await holding(id, brandId, 19);

    const answers = await Promise.all([
      add(auth, bmw320d(brandId)),
      add(auth, bmw320d(brandId)),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await cars(id)).toBe(20);
  });

  it("does not count another account's cars", async () => {
    const { auth } = await driver();
    const other = await driver('maria');
    const { id: brandId } = await brand('BMW');
    await holding(other.id, brandId, 20);

    expect((await add(auth, bmw320d(brandId))).status).toBe(201);
  });
});

describe('the Idempotency-Key header', () => {
  it('answers the first car again for the same key and creates nothing', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');
    const key = randomUUID();

    const first = await add(auth, bmw320d(brandId), key);
    const again = await add(auth, bmw320d(brandId), key);

    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.body).toEqual(first.body);
    expect(await cars(id)).toBe(1);
  });

  it('creates a second car for a different key', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');

    const first = await add(auth, bmw320d(brandId));
    const second = await add(auth, bmw320d(brandId));

    expect(second.body.id).not.toBe(first.body.id);
    expect(await cars(id)).toBe(2);
  });

  it('gives each account its own car for the same key', async () => {
    const andrei = await driver();
    const maria = await driver('maria');
    const { id: brandId } = await brand('BMW');
    const key = randomUUID();

    const a = await add(andrei.auth, bmw320d(brandId), key);
    const m = await add(maria.auth, bmw320d(brandId), key);

    expect([a.status, m.status]).toEqual([201, 201]);
    expect(m.body.id).not.toBe(a.body.id);
    expect(await cars(maria.id)).toBe(1);
  });

  it('answers the same car to two parallel saves with one key', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');
    const key = randomUUID();

    const [a, b] = await Promise.all([
      add(auth, bmw320d(brandId), key),
      add(auth, bmw320d(brandId), key),
    ]);

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.id).toBe(a.body.id);
    expect(await cars(id)).toBe(1);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['of 65 characters', 'k'.repeat(65)],
  ])('refuses a key that is %s', async (_, key) => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');

    const res = await add(auth, bmw320d(brandId), key);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ field: 'idempotency-key' }],
    });
    expect(await cars(id)).toBe(0);
  });

  it('takes a key of 64 characters', async () => {
    const { auth } = await driver();
    const { id: brandId } = await brand('BMW');

    expect((await add(auth, bmw320d(brandId), 'k'.repeat(64))).status).toBe(
      201,
    );
  });
});

describe('what a save writes beside the car', () => {
  const carAudit = (subjectId: string) =>
    prisma.activityLog.findMany({
      where: { at: { gte: since }, subjectId, subjectType: 'car' },
    });
  const added = () =>
    prisma.outboxEvent.findMany({
      where: { createdAt: { gte: since }, kind: 'car.added' },
    });

  it('writes one "car added" entry with the new values', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');

    const res = await add(
      auth,
      bmw320d(brandId, { itpUntil: '2026-11-13', plate: 'B123ABC' }),
    );

    const entries = await carAudit(res.body.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: id,
      actorRole: 'driver',
      carId: res.body.id,
      subjectType: 'car',
    });
    expect(entries[0].newValue).toMatchObject({
      brandId,
      fuel: 'diesel',
      itpUntil: '2026-11-13',
      model: '320d',
      odometerKm: 148200,
      year: 2019,
    });
  });

  it('hands car.added to the outbox with ids and small facts, no plate and no model', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');

    const res = await add(
      auth,
      bmw320d(brandId, { itpUntil: '2026-11-13', plate: 'B123ABC' }),
    );

    const events = await added();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: [`account:${id}`],
      subjectId: res.body.id,
    });
    expect(events[0].payload).toEqual({
      brandId,
      carId: res.body.id,
      fuel: 'diesel',
      itpUntil: '2026-11-13',
      odometerKm: 148200,
      ownerId: id,
      rcaUntil: null,
      rovinietaUntil: null,
      year: 2019,
    });
    expect(JSON.stringify(events[0].payload)).not.toMatch(/B123ABC|320d/);
  });

  it('writes nothing again for a repeated key', async () => {
    const { auth } = await driver();
    const { id: brandId } = await brand('BMW');
    const key = randomUUID();

    const res = await add(auth, bmw320d(brandId), key);
    await add(auth, bmw320d(brandId), key);

    expect(await carAudit(res.body.id)).toHaveLength(1);
    expect(await added()).toHaveLength(1);
  });

  it('leaves no car, no event and no role when the history cannot be written', async () => {
    const id = await account('mihai', ['garage']);
    const { id: brandId } = await brand('BMW');
    jest
      .spyOn(AuditService.prototype, 'record')
      .mockRejectedValue(new Error('history unavailable'));

    const res = await add(bearer(id, 'garage'), bmw320d(brandId));

    expect(res.status).toBe(500);
    expect(await cars(id)).toBe(0);
    expect(await added()).toHaveLength(0);
    expect(
      await prisma.accountRole.count({
        where: { accountId: id, role: 'driver' },
      }),
    ).toBe(0);
  });
});

describe('a garage-side account adding a car', () => {
  const roleAudit = (subjectId: string) =>
    prisma.activityLog.findMany({
      where: { action: 'update', at: { gte: since }, field: 'role', subjectId },
    });
  const roles = async (accountId: string) =>
    (await prisma.accountRole.findMany({ where: { accountId } }))
      .map((r) => r.role)
      .sort();

  it('makes a garage-only owner a driver once, with one role entry after two cars', async () => {
    const id = await account('mihai', ['garage']);
    const { id: brandId } = await brand('BMW');

    const first = await add(bearer(id, 'garage'), bmw320d(brandId));
    // Its garage role no longer adds cars once it is a driver.
    const second = await add(
      bearer(id, 'driver'),
      bmw320d(brandId, { model: 'X3' }),
    );

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body).not.toHaveProperty('roleAdded');
    expect(await roles(id)).toEqual(['driver', 'garage']);
    const entries = await roleAudit(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      newValue: 'driver',
      subjectType: 'account',
    });
    expect(await cars(id)).toBe(2);
  });

  it("lists the garage owner's car once it signs in as a driver", async () => {
    const id = await account('mihai', ['garage']);
    const { id: brandId } = await brand('BMW');
    const res = await add(bearer(id, 'garage'), bmw320d(brandId));

    const mine = await list(bearer(id, 'driver'));

    expect(mine.status).toBe(200);
    expect(mine.body.items.map((c: { id: string }) => c.id)).toEqual([
      res.body.id,
    ]);
  });

  it('adds no role to a driver', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');

    await add(auth, bmw320d(brandId));

    expect(await roleAudit(id)).toHaveLength(0);
    expect(await roles(id)).toEqual(['driver']);
  });

  it.each([
    ['a receptionist', ['receptionist'], 'receptionist'],
    ['a mechanic', ['mechanic'], 'mechanic'],
    ['an admin', ['admin'], 'admin'],
    ['a driver and owner in its garage role', ['driver', 'garage'], 'garage'],
  ] as const)('answers 404 to %s and saves nothing', async (_, held, using) => {
    const id = await account('ioana', [...held]);
    const { id: brandId } = await brand('BMW');

    const res = await add(bearer(id, using), bmw320d(brandId));

    expect(res.status).toBe(404);
    expect(await cars(id)).toBe(0);
    expect(await roles(id)).toEqual([...held].sort());
  });
});

describe('GET /cars', () => {
  it("answers the driver's own cars, newest first, without the removed ones", async () => {
    const { auth, id } = await driver();
    const other = await driver('maria');
    const { id: brandId } = await brand('Škoda');
    const old = await add(auth, bmw320d(brandId, { model: 'Fabia' }));
    const gone = await add(auth, bmw320d(brandId, { model: 'Rapid' }));
    const fresh = await add(auth, bmw320d(brandId, { model: 'Octavia' }));
    await add(other.auth, bmw320d(brandId, { model: 'Superb' }));
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: gone.body.id },
    });

    const res = await list(auth);

    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { model: string }) => c.model)).toEqual([
      'Octavia',
      'Fabia',
    ]);
    expect(res.body.items[0]).toEqual(fresh.body);
    expect(res.body.items[1].id).toBe(old.body.id);
    expect(res.body.items[0].brandName).toBe('Škoda');
    expect(await cars(id)).toBe(3);
  });

  it('answers an empty list to a driver with no car', async () => {
    const { auth } = await driver();

    const res = await list(auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it.each(['garage', 'receptionist', 'mechanic', 'admin'] as const)(
    'answers 404 to a %s',
    async (role) => {
      const id = await account(`cont-${role}`, [role]);

      expect((await list(bearer(id, role))).status).toBe(404);
    },
  );

  it('answers 401 sign_in_required without a session', async () => {
    const res = await list(null);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });
});

describe("the plate stays the owner's", () => {
  async function andreisCar() {
    const andrei = await driver();
    const { id: brandId } = await brand('BMW');
    const res = await add(
      andrei.auth,
      bmw320d(brandId, { plate: 'B 123 ABC' }),
    );
    return { andrei, car: res.body as { id: string; plate: string } };
  }

  it('shows the plate in the owner answers', async () => {
    const { andrei, car } = await andreisCar();

    expect(car.plate).toBe('B123ABC');
    expect((await list(andrei.auth)).body.items[0].plate).toBe('B123ABC');
  });

  it("answers nobody else with the owner's car", async () => {
    const { car } = await andreisCar();
    const maria = await driver('maria');
    const owner = await account('mihai', ['garage']);
    const mechanic = await account('vlad', ['mechanic']);
    const callers = [
      maria.auth,
      bearer(owner, 'garage'),
      bearer(mechanic, 'mechanic'),
    ];

    for (const auth of callers) {
      const theirs = await list(auth);
      expect(JSON.stringify(theirs.body)).not.toContain(car.id);
      expect(JSON.stringify(theirs.body)).not.toContain('B123ABC');
    }
    expect((await list(maria.auth)).body).toEqual({ items: [] });
    expect((await list(null)).status).toBe(401);
  });

  it('keeps the plate out of the event', async () => {
    const { car } = await andreisCar();

    const events = await prisma.outboxEvent.findMany({
      where: { subjectId: car.id },
    });

    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0].payload)).not.toContain('B123ABC');
  });

  it('saves two cars with the same plate', async () => {
    const { andrei } = await andreisCar();
    const { id: brandId } = await brand('Dacia');

    const res = await add(
      andrei.auth,
      bmw320d(brandId, { plate: 'b-123-abc' }),
    );

    expect(res.status).toBe(201);
    expect(await cars(andrei.id)).toBe(2);
  });
});
