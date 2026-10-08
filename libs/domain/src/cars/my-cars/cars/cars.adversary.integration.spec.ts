import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CarsModule } from './cars.module';
import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import type { Role } from '../../../auth/capabilities';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { localDay } from '../../../bucharest';
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

beforeEach(async () => {
  await reset();
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const today = localDay(new Date());
const yearsAhead = (n: number, shiftDays = 0) => {
  const d = new Date(
    `${Number(today.slice(0, 4)) + n}${today.slice(4)}T00:00:00Z`,
  );
  d.setUTCDate(d.getUTCDate() + shiftDays);
  return d.toISOString().slice(0, 10);
};

async function brand(name: string, active = true) {
  const key = `test-${name.toLowerCase()}`;
  return prisma.brand.upsert({
    create: { active, key, name, slug: key },
    update: { active },
    where: { name },
  });
}

const body = (brandId: string, extra: Record<string, unknown> = {}) => ({
  brandId,
  fuel: 'diesel',
  model: '320d',
  odometerKm: 148200,
  year: 2019,
  ...extra,
});

const post = (auth: string, payload: unknown, key: string | null) => {
  const call = http().post('/cars').set('Authorization', auth);
  if (key !== null) call.set('Idempotency-Key', key);
  return call.send(payload as object);
};

const cars = (ownerId: string) => prisma.car.count({ where: { ownerId } });

async function driver(name = 'andrei') {
  const id = await account(name, ['driver']);
  return { auth: bearer(id, 'driver'), id };
}

describe('POST /cars under hostile input', () => {
  it('answers 400 on idempotency-key when the header is missing and saves nothing', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');

    const res = await post(auth, body(brandId), null);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'required', field: 'idempotency-key' }),
    ]);
    expect(await cars(id)).toBe(0);
  });

  it.each([
    ['empty', ''],
    ['sixty-five characters', 'k'.repeat(65)],
  ])('answers 400 on idempotency-key when it is %s', async (_, key) => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');

    const res = await post(auth, body(brandId), key);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ field: 'idempotency-key' }),
    ]);
    expect(await cars(id)).toBe(0);
  });

  it('answers 400 unknown_brand for a brand that does not exist', async () => {
    const { auth, id } = await driver();

    const res = await post(auth, body(randomUUID()), randomUUID());

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'unknown_brand', field: 'brandId' }),
    ]);
    expect(await cars(id)).toBe(0);
  });

  it('answers 400 unknown_brand for a retired brand', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('Rover', false);

    const res = await post(auth, body(brandId), randomUUID());

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'unknown_brand', field: 'brandId' }),
    ]);
    expect(await cars(id)).toBe(0);
  });

  it('takes a date exactly five years ahead and refuses the day after', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');

    const edge = await post(
      auth,
      body(brandId, { itpUntil: yearsAhead(5) }),
      randomUUID(),
    );
    const past = await post(
      auth,
      body(brandId, {
        itpUntil: yearsAhead(5, 1),
        rcaUntil: yearsAhead(5, 1),
        rovinietaUntil: yearsAhead(5, 1),
      }),
      randomUUID(),
    );

    expect(edge.status).toBe(201);
    expect(past.status).toBe(400);
    // The contract names one offending date per refusal; each alone is
    // refused below.
    expect(past.body.errors).toHaveLength(1);
    expect(past.body.errors[0]).toEqual({
      code: 'too_far_ahead',
      field: expect.stringMatching(/^(itpUntil|rcaUntil|rovinietaUntil)$/),
    });
    expect(await cars(id)).toBe(1);
  });

  it.each(['rcaUntil', 'rovinietaUntil'])(
    'refuses %s more than five years ahead',
    async (field) => {
      const { auth, id } = await driver();
      const { id: brandId } = await brand('BMW');

      const res = await post(
        auth,
        body(brandId, { [field]: yearsAhead(5, 1) }),
        randomUUID(),
      );

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'too_far_ahead', field }),
      ]);
      expect(await cars(id)).toBe(0);
    },
  );

  it.each(['2026-02-30', '2026-13-01', '2026-00-10'])(
    'answers 400, never 500, for the impossible date %s',
    async (itpUntil) => {
      const { auth, id } = await driver();
      const { id: brandId } = await brand('BMW');

      const res = await post(auth, body(brandId, { itpUntil }), randomUUID());

      expect(res.status).toBe(400);
      expect(await cars(id)).toBe(0);
    },
  );

  it('refuses a field the contract does not name and saves nothing', async () => {
    const { auth, id } = await driver();
    const other = await account('maria', ['driver']);
    const { id: brandId } = await brand('BMW');

    const res = await post(
      auth,
      body(brandId, { ownerId: other }),
      randomUUID(),
    );

    expect(res.status).toBe(400);
    expect(await cars(other)).toBe(0);
    expect(await cars(id)).toBe(0);
  });

  it('answers 415 to a body that is not JSON', async () => {
    const { auth, id } = await driver();

    const res = await http()
      .post('/cars')
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain')
      .send('model=320d');

    expect(res.status).toBe(415);
    expect(await cars(id)).toBe(0);
  });

  it('answers 400 to a body that is an array or null', async () => {
    const { auth, id } = await driver();

    const array = await post(auth, [], randomUUID());
    const nul = await http()
      .post('/cars')
      .set('Authorization', auth)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send('null');

    expect([array.status, nul.status]).toEqual([400, 400]);
    expect(await cars(id)).toBe(0);
  });

  it('saves a model of unicode letters and a plate with its separators removed', async () => {
    const { auth } = await driver();
    const { id: brandId } = await brand('Škoda');

    const res = await post(
      auth,
      body(brandId, { model: 'Fabia Șport 😀', plate: ' cj-12 xyz ' }),
      randomUUID(),
    );

    expect(res.status).toBe(201);
    expect(res.body.model).toBe('Fabia Șport 😀');
    expect(res.body.plate).toBe('CJ12XYZ');
  });

  it('answers the first car for a repeated key even when the body differs', async () => {
    const { auth, id } = await driver();
    const { id: brandId } = await brand('BMW');
    const key = randomUUID();

    const first = await post(auth, body(brandId), key);
    const again = await post(
      auth,
      body(brandId, { model: 'X5', year: 2020 }),
      key,
    );

    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.model).toBe('320d');
    expect(await cars(id)).toBe(1);
  });

  it('does not give an account the car another account saved under the same key', async () => {
    const a = await driver('andrei');
    const b = await driver('maria');
    const { id: brandId } = await brand('BMW');
    const key = randomUUID();

    const first = await post(a.auth, body(brandId, { plate: 'B1ABC' }), key);
    const second = await post(b.auth, body(brandId, { model: 'X5' }), key);

    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.model).toBe('X5');
    expect(JSON.stringify(second.body)).not.toContain('B1ABC');
  });
});

describe('who may call the cars routes', () => {
  it.each([
    ['receptionist', ['receptionist']],
    ['mechanic', ['mechanic']],
  ] as const)('answers 404 to GET /cars for a %s', async (_, held) => {
    const id = await account('ioana', [...held]);

    const res = await http()
      .get('/cars')
      .set('Authorization', bearer(id, held[0]));

    expect(res.status).toBe(404);
  });

  it('answers 401 to a token signed with another secret', async () => {
    const id = await account('andrei', ['driver']);
    const forged = `Bearer ${signAccessToken({ accountId: id, role: 'driver' }, 'other-secret')}`;

    const res = await http().get('/cars').set('Authorization', forged);

    expect(res.status).toBe(401);
  });

  it('answers 401 to POST /cars without a session before it looks at the body', async () => {
    const res = await http().post('/cars').send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('lists only the actor cars when two accounts hold cars', async () => {
    const a = await driver('andrei');
    const b = await driver('maria');
    const { id: brandId } = await brand('BMW');
    await post(a.auth, body(brandId, { model: 'A' }), randomUUID());
    await post(b.auth, body(brandId, { model: 'B' }), randomUUID());

    const res = await http().get('/cars').set('Authorization', a.auth);

    expect(res.body.items.map((c: { model: string }) => c.model)).toEqual([
      'A',
    ]);
  });

  it('grants a garage-only owner the driver role beside the garage role with its first car', async () => {
    const id = await account('mihai', ['garage']);
    const { id: brandId } = await brand('BMW');
    const auth = bearer(id, 'garage');

    const first = await post(auth, body(brandId), randomUUID());
    const roles = (
      await prisma.accountRole.findMany({ where: { accountId: id } })
    ).map((r) => r.role);

    expect(first.status).toBe(201);
    expect(roles.sort()).toEqual(['driver', 'garage']);
  });
});
