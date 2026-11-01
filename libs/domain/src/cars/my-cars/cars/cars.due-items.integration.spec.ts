// @traces 093-FR-001 093-FR-002 093-FR-003 093-FR-005 093-FR-006 093-FR-013
import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CarsModule } from './cars.module';
import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import { serialDatabase } from '../../../auth/serial-db.testing';
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

// Only the clock moves; timers stay real for the database and HTTP. 09:00Z is
// noon in Bucharest on 8 October 2026.
beforeEach(async () => {
  await reset();
  vi.useFakeTimers({
    now: new Date('2026-10-08T09:00:00Z'),
    toFake: ['Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

async function driver(name = 'andrei') {
  const id = await account(name, ['driver']);
  return { auth: bearer(id, 'driver'), id };
}

// The catalogue outlives the reset, and a brand's name is unique.
async function brandId(name: string) {
  const key = `test-${name.toLowerCase()}`;
  const { id } = await prisma.brand.upsert({
    create: { active: true, key, name, slug: key },
    update: { active: true },
    where: { name },
  });
  return id;
}

async function add(
  auth: string,
  brand: string,
  model: string,
  extra: Record<string, unknown> = {},
) {
  const res = await http()
    .post('/cars')
    .set('Authorization', auth)
    .set('Idempotency-Key', randomUUID())
    .send({
      brandId: await brandId(brand),
      fuel: 'petrol',
      model,
      odometerKm: 148_200,
      year: 2019,
      ...extra,
    });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

const read = (auth: string | null) => {
  const call = http().get('/cars/due-items');
  return auth ? call.set('Authorization', auth) : call;
};

const bmw = (auth: string, extra: Record<string, unknown> = {}) =>
  add(auth, 'BMW', '320d', {
    itpUntil: '2026-11-13',
    nextServiceKm: 152_000,
    plate: 'B123ABC',
    ...extra,
  });
const mini = (auth: string, itpUntil = '2027-06-30') =>
  add(auth, 'Mini', 'Cooper S', { itpUntil });

const rows = (res: request.Response) =>
  res.body.items.map(
    (i: { kind: string; carName: string; state: string }) =>
      `${i.kind} ${i.carName} ${i.state}`,
  );

describe('GET /cars/due-items', () => {
  it("answers the driver's rows soonest first with the counts", async () => {
    const { auth } = await driver();
    const b = await bmw(auth);
    const m = await mini(auth);

    const res = await read(auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      carCount: 2,
      dueSoonCount: 1,
      items: [
        {
          carId: b.id,
          carName: 'BMW 320d',
          daysLeft: 36,
          dueKm: null,
          dueOn: '2026-11-13',
          kind: 'itp',
          kmLeft: null,
          passed: false,
          state: 'amber',
        },
        {
          carId: b.id,
          carName: 'BMW 320d',
          daysLeft: 116,
          dueKm: 152_000,
          dueOn: '2027-02-01',
          kind: 'oil',
          kmLeft: 3800,
          passed: false,
          state: 'green',
        },
        {
          carId: m.id,
          carName: 'Mini Cooper S',
          daysLeft: 265,
          dueKm: null,
          dueOn: '2027-06-30',
          kind: 'itp',
          kmLeft: null,
          passed: false,
          state: 'green',
        },
      ],
    });
  });

  it('names the car by brand and model, never by its plate', async () => {
    const { auth } = await driver();
    await bmw(auth);

    const res = await read(auth);

    expect(JSON.stringify(res.body)).not.toContain('B123ABC');
  });

  it('puts a passed ITP first, red and passed, and counts it', async () => {
    const { auth } = await driver();
    await bmw(auth);
    await mini(auth, '2026-10-01');

    const res = await read(auth);

    expect(res.body.items[0]).toMatchObject({
      carName: 'Mini Cooper S',
      daysLeft: -7,
      passed: true,
      state: 'red',
    });
    expect(res.body.dueSoonCount).toBe(2);
  });

  it('puts a car with no ITP date last, grey with no day', async () => {
    const { auth } = await driver();
    await bmw(auth);
    await mini(auth);
    await add(auth, 'Dacia', 'Logan');

    const res = await read(auth);

    expect(res.body.items.at(-1)).toMatchObject({
      carName: 'Dacia Logan',
      daysLeft: null,
      dueOn: null,
      kind: 'itp',
      state: 'grey',
    });
    expect(res.body.dueSoonCount).toBe(1);
  });

  it('answers the oil row red with the kilometres over and no day once they are reached', async () => {
    const { auth } = await driver();
    await bmw(auth, { nextServiceKm: 150_000, odometerKm: 150_300 });

    const res = await read(auth);

    expect(res.body.items[0]).toMatchObject({
      daysLeft: null,
      dueKm: 150_000,
      dueOn: null,
      kind: 'oil',
      kmLeft: -300,
      passed: true,
      state: 'red',
    });
  });

  it('orders rows on one day by car name, ITP before the oil service', async () => {
    const { auth } = await driver();
    // 1,000 km at the default pace is 30 days: 7 November 2026.
    await add(auth, 'Mini', 'Cooper S', { itpUntil: '2026-11-07' });
    await add(auth, 'Audi', 'A4', {
      itpUntil: '2026-11-07',
      nextServiceKm: 149_200,
    });

    expect(rows(await read(auth))).toEqual([
      'itp Audi A4 amber',
      'oil Audi A4 amber',
      'itp Mini Cooper S amber',
    ]);
  });

  it('counts the days in Bucharest, whatever the UTC day', async () => {
    const { auth } = await driver();
    await mini(auth, '2026-10-15');

    vi.setSystemTime(new Date('2026-10-07T20:30:00Z'));
    const before = await read(auth);
    vi.setSystemTime(new Date('2026-10-07T22:30:00Z'));
    const after = await read(auth);

    expect(before.body.items[0].daysLeft).toBe(8);
    expect(after.body.items[0].daysLeft).toBe(7);
    expect([before.body.items[0].state, after.body.items[0].state]).toEqual([
      'amber',
      'red',
    ]);
  });

  it('drops a removed car from the rows and the counts', async () => {
    const { auth } = await driver();
    const b = await bmw(auth);
    await mini(auth);

    const gone = await http()
      .delete(`/cars/${b.id}`)
      .set('Authorization', auth);
    const res = await read(auth);

    expect(gone.status).toBe(204);
    expect(res.body.carCount).toBe(1);
    expect(res.body.dueSoonCount).toBe(0);
    expect(rows(res)).toEqual(['itp Mini Cooper S green']);
  });

  it('answers twenty cars in one answer with nothing due soon', async () => {
    const { auth } = await driver();
    for (let n = 0; n < 20; n++) await mini(auth);

    const res = await read(auth);

    expect(res.body.carCount).toBe(20);
    expect(res.body.dueSoonCount).toBe(0);
    expect(res.body.items).toHaveLength(20);
  });

  it("answers only the caller's own cars", async () => {
    const andrei = await driver();
    const maria = await driver('maria');
    await bmw(andrei.auth);
    await mini(andrei.auth, '2026-10-01');
    const own = await add(maria.auth, 'Dacia', 'Logan', {
      itpUntil: '2026-12-01',
    });

    const res = await read(maria.auth);

    expect(res.body.carCount).toBe(1);
    expect(res.body.dueSoonCount).toBe(1);
    expect(res.body.items.map((i: { carId: string }) => i.carId)).toEqual([
      own.id,
    ]);
  });

  it('answers an empty list to a driver with no car', async () => {
    const { auth } = await driver();

    const res = await read(auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ carCount: 0, dueSoonCount: 0, items: [] });
  });

  it('answers 401 sign_in_required without a session', async () => {
    const res = await read(null);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it.each(['garage', 'receptionist', 'mechanic', 'admin'] as const)(
    'answers 404 to a %s',
    async (role) => {
      const id = await account(`cont-${role}`, [role]);

      const res = await read(bearer(id, role));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    },
  );
});
