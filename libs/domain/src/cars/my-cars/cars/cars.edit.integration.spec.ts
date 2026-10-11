import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CarsModule } from './cars.module';
import { AuditService } from '../../../audit/audit.service';
import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import type { Role } from '../../../auth/capabilities';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { localDay } from '../../../bucharest';
import { outboxMark } from '../../../events/outbox.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../../notifications/notifications.testing';

const redisUrl = redisUrlFor(15);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
// The history and the outbox are never emptied: each test reads its own.
let since: Date;
let mark: bigint;

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
  mark = await outboxMark(prisma);
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

async function driver(name = 'andrei') {
  const id = await account(name, ['driver']);
  return { auth: bearer(id, 'driver'), id };
}

interface Car {
  createdAt: string;
  id: string;
  updatedAt: string;
  [field: string]: unknown;
}

// A BMW 320d with every optional field set, added through the API.
async function saved(
  auth: string,
  extra: Record<string, unknown> = {},
): Promise<Car> {
  const { id: brandId } = await brand('BMW');
  const res = await http()
    .post('/cars')
    .set('Authorization', auth)
    .set('Idempotency-Key', randomUUID())
    .send({
      brandId,
      engine: '2.0 TDI',
      fuel: 'diesel',
      itpUntil: '2026-11-13',
      model: '320d',
      odometerKm: 148200,
      plate: 'B123ABC',
      rcaUntil: '2026-10-20',
      rovinietaUntil: '2027-03-01',
      year: 2019,
      ...extra,
    });
  expect(res.status).toBe(201);
  return res.body;
}

const edit = (
  auth: string | null,
  id: string,
  body: Record<string, unknown>,
) => {
  const call = http().patch(`/cars/${id}`).send(body);
  return auth ? call.set('Authorization', auth) : call;
};

const row = (id: string) => prisma.car.findUniqueOrThrow({ where: { id } });

const carAudit = (subjectId: string) =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    where: { at: { gte: since }, subjectId, subjectType: 'car' },
  });
const updates = () =>
  prisma.outboxEvent.findMany({
    where: { id: { gt: mark }, kind: 'car.updated' },
  });

// What an edit may not touch, read before and after a refusal.
const untouched = async (car: Car) => {
  const stored = await row(car.id);
  expect(stored.updatedAt.toISOString()).toBe(car.updatedAt);
  expect(await updates()).toHaveLength(0);
};

// @traces 092-edit-remove-car-FR-001
describe('PATCH /cars/:id', () => {
  it('changes the fields sent, keeps the rest and answers the car with a new version', async () => {
    const { auth } = await driver();
    const car = await saved(auth);
    const { id: brandId } = await brand('Dacia');

    const res = await edit(auth, car.id, {
      brandId,
      engine: ' 1.5 dCi ',
      fuel: 'petrol',
      itpUntil: '2027-11-13',
      model: ' Logan ',
      odometerKm: 151000,
      plate: 'cj-12 abc',
      rcaUntil: '2027-01-20',
      rovinietaUntil: '2027-06-01',
      version: car.updatedAt,
      year: 2020,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brandId,
      brandName: 'Dacia',
      createdAt: car.createdAt,
      engine: '1.5 dCi',
      fuel: 'petrol',
      id: car.id,
      itpUntil: '2027-11-13',
      model: 'Logan',
      odometerKm: 151000,
      plate: 'CJ12ABC',
      rcaUntil: '2027-01-20',
      rovinietaUntil: '2027-06-01',
      updatedAt: expect.any(String),
      year: 2020,
    });
    expect(res.body.updatedAt).not.toBe(car.updatedAt);
    expect((await row(car.id)).updatedAt.toISOString()).toBe(
      res.body.updatedAt,
    );
  });

  it('keeps every field it is not sent', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, {
      odometerKm: 150000,
      version: car.updatedAt,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...car,
      odometerKm: 150000,
      updatedAt: res.body.updatedAt,
    });
  });

  // @traces 092-edit-remove-car-FR-014
  it.each(['engine', 'plate', 'itpUntil', 'rcaUntil', 'rovinietaUntil'])(
    'clears %s sent as null',
    async (field) => {
      const { auth } = await driver();
      const car = await saved(auth);

      const res = await edit(auth, car.id, {
        [field]: null,
        version: car.updatedAt,
      });

      expect(res.status).toBe(200);
      expect(res.body[field]).toBeNull();
      expect((await row(car.id))[field as 'plate']).toBeNull();
    },
  );

  it('clears the engine sent empty, as the add dialog does', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, {
      engine: '   ',
      version: car.updatedAt,
    });

    expect(res.status).toBe(200);
    expect(res.body.engine).toBeNull();
  });

  it('adds a plate to a car without one', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { plate: undefined });

    const res = await edit(auth, car.id, {
      plate: 'B 77 XYZ',
      version: car.updatedAt,
    });

    expect(res.status).toBe(200);
    expect(res.body.plate).toBe('B77XYZ');
  });

  it('takes the limits themselves', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const low = await edit(auth, car.id, {
      engine: 'x'.repeat(30),
      model: 'x',
      odometerKm: 0,
      plate: 'B1',
      version: car.updatedAt,
      year: 1950,
    });
    expect(low.status).toBe(200);
    const high = await edit(auth, car.id, {
      itpUntil: yearsAhead(5),
      model: 'x'.repeat(40),
      odometerKm: 2_000_000,
      plate: 'ABCDEF123456',
      rcaUntil: '2001-01-01',
      version: low.body.updatedAt,
      year: nextYear,
    });
    expect(high.status).toBe(200);
  });

  it.each([
    ['an empty model', { model: '   ' }, 'model'],
    ['a model of 41 characters', { model: 'x'.repeat(41) }, 'model'],
    ['year 1949', { year: 1949 }, 'year'],
    ['the year after next', { year: nextYear + 1 }, 'year'],
    ['-1 km', { odometerKm: -1 }, 'odometerKm'],
    ['2 000 001 km', { odometerKm: 2_000_001 }, 'odometerKm'],
    ['an unknown fuel', { fuel: 'lpg' }, 'fuel'],
    ['an engine of 31 characters', { engine: 'x'.repeat(31) }, 'engine'],
    ['a plate of 1 character', { plate: 'B' }, 'plate'],
    ['a date that is not a date', { itpUntil: '2026-02-30' }, 'itpUntil'],
    ['a brand that is not an id', { brandId: 'bmw' }, 'brandId'],
    ['a null model', { model: null }, 'model'],
    ['a null year', { year: null }, 'year'],
    ['an unknown field', { colour: 'red' }, 'colour'],
  ])('refuses %s and changes nothing', async (_, change, field) => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, { ...change, version: car.updatedAt });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
    await untouched(car);
  });

  it('refuses an edit without a version', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, { odometerKm: 150000 });

    expect(res.status).toBe(400);
    await untouched(car);
  });

  it.each(['itpUntil', 'rcaUntil', 'rovinietaUntil'])(
    'refuses %s more than five years ahead as too_far_ahead',
    async (field) => {
      const { auth } = await driver();
      const car = await saved(auth);
      const after = new Date(`${yearsAhead(5)}T12:00:00Z`);
      after.setUTCDate(after.getUTCDate() + 1);

      const res = await edit(auth, car.id, {
        [field]: after.toISOString().slice(0, 10),
        version: car.updatedAt,
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'validation_failed',
        errors: [{ code: 'too_far_ahead', field }],
      });
      await untouched(car);
    },
  );

  it.each([
    ['an unknown brand', async () => randomUUID()],
    ['a retired brand', async () => (await brand('Marcă retrasă', false)).id],
  ])('refuses %s as unknown_brand', async (_, brandOf) => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, {
      brandId: await brandOf(),
      version: car.updatedAt,
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'unknown_brand', field: 'brandId' }],
    });
    await untouched(car);
  });
});

// @traces 092-edit-remove-car-FR-002
describe('an edit of a car changed in the meantime', () => {
  it('refuses a version that is not the car’s as stale_version', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, {
      odometerKm: 150000,
      version: new Date(Date.parse(car.updatedAt) - 1000).toISOString(),
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('stale_version');
    await untouched(car);
  });

  it('refuses the same version sent a second time', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const first = await edit(auth, car.id, {
      odometerKm: 150000,
      version: car.updatedAt,
    });
    const second = await edit(auth, car.id, {
      odometerKm: 152000,
      version: car.updatedAt,
    });

    expect([first.status, second.status]).toEqual([200, 409]);
    expect(second.body.code).toBe('stale_version');
    expect((await row(car.id)).odometerKm).toBe(150000);
  });

  it('lets one of two edits racing on one version through', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const answers = await Promise.all([
      edit(auth, car.id, { odometerKm: 150000, version: car.updatedAt }),
      edit(auth, car.id, { odometerKm: 152000, version: car.updatedAt }),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect(await updates()).toHaveLength(1);
  });
});

// @traces 092-edit-remove-car-FR-001
describe('an edit that changes nothing', () => {
  it('writes nothing and answers the car as stored', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, {
      engine: ' 2.0 TDI ',
      itpUntil: '2026-11-13',
      model: ' 320d ',
      odometerKm: 148200,
      plate: 'b-123 abc',
      version: car.updatedAt,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(car);
    expect(await carAudit(car.id)).toHaveLength(1);
    await untouched(car);
  });

  it('treats an empty engine as the missing one it is', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { engine: undefined });

    const res = await edit(auth, car.id, {
      engine: '',
      version: car.updatedAt,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(car);
    await untouched(car);
  });
});

// @traces 092-edit-remove-car-FR-004
describe('whose car an edit reaches', () => {
  it.each([
    ['another driver’s car', 'other'],
    ['a removed car', 'removed'],
    ['an unknown id', 'unknown'],
  ])('answers 404 not_found for %s', async (_, which) => {
    const ana = await driver('ana');
    const car = await saved(ana.auth);
    const { auth } = which === 'other' ? await driver('bogdan') : ana;
    if (which === 'removed') {
      await prisma.car.update({
        data: { removedAt: new Date() },
        where: { id: car.id },
      });
    }
    const id = which === 'unknown' ? randomUUID() : car.id;

    const res = await edit(auth, id, {
      odometerKm: 1,
      version: car.updatedAt,
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(JSON.stringify(res.body)).not.toMatch(/B123ABC|320d/);
    expect((await row(car.id)).odometerKm).toBe(148200);
  });

  it('answers 400 validation_failed to an id that is not one', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, 'not-an-id', {
      odometerKm: 1,
      version: car.updatedAt,
    });

    expect(res.status).toBe(400);
  });

  it.each(['garage', 'admin'] as const)(
    'answers 404 to a %s, who holds no cars',
    async (role) => {
      const ana = await driver('ana');
      const car = await saved(ana.auth);
      const id = await account(`cont-${role}`, [role]);

      const res = await edit(bearer(id, role), car.id, {
        odometerKm: 1,
        version: car.updatedAt,
      });

      expect(res.status).toBe(404);
      expect((await row(car.id)).odometerKm).toBe(148200);
    },
  );

  it('answers 401 sign_in_required without a session', async () => {
    const ana = await driver('ana');
    const car = await saved(ana.auth);

    const res = await edit(null, car.id, {
      odometerKm: 1,
      version: car.updatedAt,
    });

    expect(res.status).toBe(401);
  });

  it('edits a car with an open request', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);
    await prisma.quoteRequest.create({
      data: {
        carBrand: 'BMW',
        carFuel: 'diesel',
        carId: car.id,
        carModel: '320d',
        carYear: 2019,
        driverId: id,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        idempotencyKey: randomUUID(),
      },
    });

    const res = await edit(auth, car.id, {
      odometerKm: 150000,
      version: car.updatedAt,
    });

    expect(res.status).toBe(200);
  });
});

// @traces 092-edit-remove-car-FR-005
describe('what an edit writes beside the car', () => {
  it('writes one update entry per changed field, as the car answer shows it', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);

    await edit(auth, car.id, {
      itpUntil: '2027-11-13',
      odometerKm: 151000,
      plate: 'CJ12ABC',
      rcaUntil: null,
      version: car.updatedAt,
    });

    const entries = (await carAudit(car.id)).filter(
      (e) => e.action === 'update',
    );
    expect(
      entries.map((e) => [e.field, e.oldValue, e.newValue]).sort(),
    ).toEqual(
      [
        ['itpUntil', '2026-11-13', '2027-11-13'],
        ['odometerKm', 148200, 151000],
        ['plate', null, null],
        ['rcaUntil', '2026-10-20', null],
      ].sort(),
    );
    for (const entry of entries) {
      expect(entry).toMatchObject({
        actorId: id,
        actorRole: 'driver',
        carId: car.id,
        subjectType: 'car',
      });
    }
    expect(JSON.stringify(entries)).not.toMatch(/B123ABC|CJ12ABC/);
  });

  it('hands car.updated to the outbox with the changed fields and the three dates, no plate and no model', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);

    await edit(auth, car.id, {
      itpUntil: '2027-11-13',
      model: 'X3',
      plate: null,
      version: car.updatedAt,
    });

    const events = await updates();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: [`account:${id}`],
      subjectId: car.id,
    });
    expect(events[0].payload).toEqual({
      carId: car.id,
      changed: expect.arrayContaining(['itpUntil', 'model', 'plate']),
      itpUntil: '2027-11-13',
      ownerId: id,
      rcaUntil: '2026-10-20',
      rovinietaUntil: '2027-03-01',
    });
    expect((events[0].payload as { changed: string[] }).changed).toHaveLength(
      3,
    );
    expect(JSON.stringify(events[0].payload)).not.toMatch(/B123ABC|X3|320d/);
  });

  it('changes nothing and hands nothing on when the history cannot be written', async () => {
    const { auth } = await driver();
    const car = await saved(auth);
    jest
      .spyOn(AuditService.prototype, 'recordChanges')
      .mockRejectedValue(new Error('history unavailable'));
    jest
      .spyOn(AuditService.prototype, 'record')
      .mockRejectedValue(new Error('history unavailable'));

    const res = await edit(auth, car.id, {
      odometerKm: 151000,
      version: car.updatedAt,
    });

    expect(res.status).toBe(500);
    expect((await row(car.id)).odometerKm).toBe(148200);
    await untouched(car);
  });
});
