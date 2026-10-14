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
import { addDays, localDay } from '../../../bucharest';
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

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const today = localDay(new Date());
const yearsAhead = (n: number) =>
  `${Number(today.slice(0, 4)) + n}${today.slice(4)}`;

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
  id: string;
  updatedAt: string;
  [field: string]: unknown;
}

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
      itpUntil: addDays(today, 40),
      model: '320d',
      odometerKm: 148200,
      plate: 'B123ABC',
      year: 2019,
      ...extra,
    });
  expect(res.status).toBe(201);
  return res.body;
}

const edit = (auth: string | null, id: string, body: unknown) => {
  const call = http()
    .patch(`/cars/${id}`)
    .send(body as object);
  return auth ? call.set('Authorization', auth) : call;
};
const remove = (auth: string | null, id: string) => {
  const call = http().delete(`/cars/${id}`);
  return auth ? call.set('Authorization', auth) : call;
};

const row = (id: string) => prisma.car.findUniqueOrThrow({ where: { id } });
const audit = (subjectId: string) =>
  prisma.activityLog.findMany({
    where: { at: { gte: since }, subjectId, subjectType: 'car' },
  });
const events = (kind: string) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { id: { gt: mark }, kind },
  });

const unchanged = async (car: Car) => {
  expect((await row(car.id)).updatedAt.toISOString()).toBe(car.updatedAt);
  expect(await events('car.updated')).toHaveLength(0);
  expect(
    (await audit(car.id)).filter((e) => e.action === 'update'),
  ).toHaveLength(0);
};

function quoteRequest(
  driverId: string,
  carId: string,
  status: 'sent' | 'quoted' | 'booked' | 'in_work' | 'done' | 'closed',
) {
  return prisma.quoteRequest.create({
    data: {
      carBrand: 'BMW',
      carFuel: 'diesel',
      carId,
      carModel: '320d',
      carYear: 2019,
      driverId,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      idempotencyKey: randomUUID(),
      status,
      ...(status === 'closed' && {
        closedAt: new Date(),
        closedReason: 'cancelled' as const,
      }),
    },
  });
}

// @traces 092-FR-001
describe('PATCH /cars/:id with fields it cannot take', () => {
  it.each(['brandId', 'model', 'year', 'odometerKm', 'fuel'])(
    'refuses an explicit null for the required %s and changes nothing',
    async (field) => {
      const { auth } = await driver();
      const car = await saved(auth);

      const res = await edit(auth, car.id, {
        [field]: null,
        version: car.updatedAt,
      });

      expect(res.status).toBe(400);
      await unchanged(car);
    },
  );

  it.each([
    ['ownerId', randomUUID()],
    ['removedAt', '2026-01-01T00:00:00.000Z'],
    ['id', randomUUID()],
    ['createdAt', '2020-01-01T00:00:00.000Z'],
    ['updatedAt', '2020-01-01T00:00:00.000Z'],
    ['idempotencyKey', 'k'],
  ])(
    'refuses the field %s the contract does not name',
    async (field, value) => {
      const { auth } = await driver();
      const car = await saved(auth);

      const res = await edit(auth, car.id, {
        [field]: value,
        model: 'M3',
        version: car.updatedAt,
      });

      expect(res.status).toBe(400);
      expect((await row(car.id)).model).toBe('320d');
      await unchanged(car);
    },
  );

  it.each([
    ['whitespace only model', { model: '     ' }],
    ['a 41 character model', { model: 'x'.repeat(41) }],
    ['a model with a bell character', { model: 'a\u0007b' }],
    ['an empty plate', { plate: '' }],
    ['a one character plate', { plate: 'A' }],
    ['a 13 character plate', { plate: 'A'.repeat(13) }],
    ['a plate with a diacritic', { plate: 'ȘĂ123' }],
    ['an engine of 31 characters', { engine: 'x'.repeat(31) }],
    ['a kilometre reading past the cap', { odometerKm: 2_000_001 }],
    ['a negative reading', { odometerKm: -1 }],
    ['a fractional year', { year: 2019.5 }],
    ['a date with a time', { itpUntil: '2026-12-01T00:00:00Z' }],
    ['a 30 February', { rcaUntil: '2027-02-30' }],
    ['a date as a number', { rovinietaUntil: 20261201 }],
    [
      'an ITP date a day past five years',
      { itpUntil: addDays(yearsAhead(5), 1) },
    ],
  ])(
    'refuses %s with the fields named and changes nothing',
    async (_, body) => {
      const { auth } = await driver();
      const car = await saved(auth);

      const res = await edit(auth, car.id, { ...body, version: car.updatedAt });

      expect(res.status).toBe(400);
      await unchanged(car);
    },
  );

  it('takes an ITP date exactly five years ahead and clears it with null', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const far = await edit(auth, car.id, {
      itpUntil: yearsAhead(5),
      version: car.updatedAt,
    });
    const cleared = await edit(auth, car.id, {
      itpUntil: null,
      version: far.body.updatedAt,
    });

    expect(far.status).toBe(200);
    expect(far.body.itpUntil).toBe(yearsAhead(5));
    expect(cleared.status).toBe(200);
    expect(cleared.body.itpUntil).toBeNull();
    const payloads = (await events('car.updated')).map((e) => e.payload);
    // The event names the cleared field; the worker reads the date from the car.
    expect(payloads[1]).toMatchObject({ changed: ['itpUntil'] });
    expect(payloads[1]).not.toHaveProperty('itpUntil');
  });

  it.each([[[1, 2]], ['text'], [null]])(
    'answers 400 to a body that is %j',
    async (body) => {
      const { auth } = await driver();
      const car = await saved(auth);

      const res = await http()
        .patch(`/cars/${car.id}`)
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(body));

      expect(res.status).toBe(400);
      await unchanged(car);
    },
  );
});

// @traces 092-FR-002
describe('the version of an edit', () => {
  it.each([
    ['text', 'yesterday'],
    ['a number', 1760000000000],
    ['null', null],
    ['an empty string', ''],
    ['an array', ['2026-10-11T08:00:00.000Z']],
    ['an object', { at: 1 }],
  ])('refuses a version that is %s with 400', async (_, version) => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, { model: 'M3', version });

    expect(res.status).toBe(400);
    await unchanged(car);
  });

  it.each([
    '2026-W41-3',
    '2026-02-30T00:00:00Z',
    '2026-10-11T08:00:00.000+99:00',
    '+275760-09-14T00:00:00.000Z',
    '2026-10-11',
    '2026-284',
  ])(
    'answers 400 or 409, never a server error, to the version %s',
    async (version) => {
      const { auth } = await driver();
      const car = await saved(auth);

      const res = await edit(auth, car.id, { model: 'M3', version });

      expect([400, 409]).toContain(res.status);
      await unchanged(car);
    },
  );

  it('refuses a version cut to whole seconds as stale', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, {
      model: 'M3',
      version: car.updatedAt.replace(/\.\d+Z$/, 'Z'),
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('stale_version');
    await unchanged(car);
  });

  it('takes the version of the same instant written with a UTC offset', async () => {
    const { auth } = await driver();
    const car = await saved(auth);
    const offset = new Date(Date.parse(car.updatedAt) + 3 * 3_600_000)
      .toISOString()
      .replace('Z', '+03:00');

    const res = await edit(auth, car.id, { model: 'M3', version: offset });

    expect(res.status).toBe(200);
    expect(res.body.model).toBe('M3');
  });

  it('lets five edits follow each other, each on the version the last answer carried', async () => {
    const { auth } = await driver();
    let car = await saved(auth);
    const seen = new Set([car.updatedAt]);

    for (let km = 150_000; km < 150_005; km += 1) {
      const res = await edit(auth, car.id, {
        odometerKm: km,
        version: car.updatedAt,
      });
      expect(res.status).toBe(200);
      seen.add(res.body.updatedAt);
      car = res.body;
    }

    expect(seen.size).toBe(6);
    const listed = await http().get('/cars').set('Authorization', auth);
    expect(listed.body.items[0].updatedAt).toBe(car.updatedAt);
  });

  it('answers 409 to the first version once the second edit went through', async () => {
    const { auth } = await driver();
    const first = await saved(auth);
    const second = await edit(auth, first.id, {
      model: 'M3',
      version: first.updatedAt,
    });

    const stale = await edit(auth, first.id, {
      model: 'M4',
      version: first.updatedAt,
    });

    expect(second.status).toBe(200);
    expect(stale.status).toBe(409);
    expect((await row(first.id)).model).toBe('M3');
  });

  it('lets exactly one of eight edits sent on one version through, with one entry and one event', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        edit(auth, car.id, { odometerKm: 160_000 + i, version: car.updatedAt }),
      ),
    );

    expect(results.map((r) => r.status).sort()).toEqual([
      200, 409, 409, 409, 409, 409, 409, 409,
    ]);
    expect(await events('car.updated')).toHaveLength(1);
    expect(
      (await audit(car.id)).filter((e) => e.action === 'update'),
    ).toHaveLength(1);
  });
});

// @traces 092-FR-001
describe('an edit that changes nothing', () => {
  it('writes nothing for a version alone', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, { version: car.updatedAt });

    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBe(car.updatedAt);
    await unchanged(car);
  });

  it('writes nothing for the plate typed with spaces, hyphens and lower case', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, {
      plate: ' b-123 abc ',
      version: car.updatedAt,
    });

    expect(res.status).toBe(200);
    expect(res.body.plate).toBe('B123ABC');
    await unchanged(car);
  });

  it('writes nothing for the model padded with spaces and the date it already has', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, {
      itpUntil: car['itpUntil'],
      model: '  320d  ',
      version: car.updatedAt,
    });

    expect(res.status).toBe(200);
    await unchanged(car);
  });

  it('writes nothing for a null sent to a field that is already empty', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { engine: undefined, rcaUntil: undefined });

    const res = await edit(auth, car.id, {
      engine: null,
      rcaUntil: null,
      version: car.updatedAt,
    });

    expect(res.status).toBe(200);
    await unchanged(car);
  });
});

// @traces 092-FR-001
describe('what an edit may not leak', () => {
  it('keeps the old and the new plate out of every audit value and every event', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car.id, {
      plate: 'cj 99 xyz',
      version: car.updatedAt,
    });

    expect(res.body.plate).toBe('CJ99XYZ');
    const everything = JSON.stringify(
      [await audit(car.id), await events('car.updated')],
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    expect(everything).not.toMatch(/B123ABC|CJ99XYZ|cj 99 xyz/i);
    const plate = (await audit(car.id)).filter((e) => e.field === 'plate');
    expect(plate).toHaveLength(1);
    expect(
      JSON.stringify(plate[0], (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    ).toMatch(/null/);
  });

  it('keeps the model out of the event when the model is what changed', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    await edit(auth, car.id, { model: 'Zebra-Unique', version: car.updatedAt });

    const [event] = await events('car.updated');
    expect(JSON.stringify(event.payload)).not.toMatch(/Zebra-Unique|320d/);
    expect((event.payload as { changed: string[] }).changed).toEqual(['model']);
  });

  it('answers another driver with 404, not 409, even on a stale version', async () => {
    const ana = await driver('ana');
    const bogdan = await driver('bogdan');
    const car = await saved(ana.auth);

    const res = await edit(bogdan.auth, car.id, {
      model: 'M3',
      version: '2000-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(JSON.stringify(res.body)).not.toMatch(/B123ABC|320d/);
  });

  it('answers another driver with 404 for an unknown brand, not 400', async () => {
    const ana = await driver('ana');
    const bogdan = await driver('bogdan');
    const car = await saved(ana.auth);

    const res = await edit(bogdan.auth, car.id, {
      brandId: randomUUID(),
      version: car.updatedAt,
    });

    expect(res.status).toBe(404);
  });

  it.each(['mechanic', 'receptionist'] as const)(
    'refuses a %s session an edit and a removal',
    async (role) => {
      const ana = await driver('ana');
      const car = await saved(ana.auth);
      const id = await account('staff', [role]);
      const auth = bearer(id, role);

      const patched = await edit(auth, car.id, {
        model: 'M3',
        version: car.updatedAt,
      });
      const deleted = await remove(auth, car.id);

      expect([403, 404]).toContain(patched.status);
      expect([403, 404]).toContain(deleted.status);
      expect(await row(car.id)).toMatchObject({
        model: '320d',
        removedAt: null,
      });
    },
  );
});

// @traces 092-FR-001
describe('the brand of an edit', () => {
  it.each([
    ['unknown', async () => randomUUID()],
    ['retired', async () => (await brand('Saab', false)).id],
  ])(
    'answers 400 unknown_brand for a %s brand and changes nothing',
    async (_, pick) => {
      const { auth } = await driver();
      const car = await saved(auth);

      const res = await edit(auth, car.id, {
        brandId: await pick(),
        version: car.updatedAt,
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        errors: [{ code: 'unknown_brand', field: 'brandId' }],
      });
      await unchanged(car);
    },
  );

  it('moves the car to another active brand and reports it by id in the audit', async () => {
    const { auth } = await driver();
    const car = await saved(auth);
    const audi = await brand('Audi');

    const res = await edit(auth, car.id, {
      brandId: audi.id,
      version: car.updatedAt,
    });

    expect(res.status).toBe(200);
    const entry = (await audit(car.id)).find((e) => e.field === 'brandId');
    expect(
      JSON.stringify(entry, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    ).toContain(audi.id);
  });
});

// @traces 092-FR-003
describe('DELETE /cars/:id against open requests', () => {
  it('is allowed when every request of the car is done or closed', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);
    await quoteRequest(id, car.id, 'done');
    await quoteRequest(id, car.id, 'closed');

    const res = await remove(auth, car.id);

    expect(res.status).toBe(204);
    expect((await row(car.id)).removedAt).not.toBeNull();
  });

  it('is refused when one request is done and another is open', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);
    await quoteRequest(id, car.id, 'done');
    await quoteRequest(id, car.id, 'quoted');

    const res = await remove(auth, car.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('open_request');
  });

  it('is refused for a request on a car of the same driver only for that car', async () => {
    const { auth, id } = await driver();
    const busy = await saved(auth);
    const free = await saved(auth);
    await quoteRequest(id, busy.id, 'sent');

    expect((await remove(auth, free.id)).status).toBe(204);
    expect((await remove(auth, busy.id)).status).toBe(409);
  });

  it('answers 404 for another driver’s car even when it has an open request', async () => {
    const ana = await driver('ana');
    const bogdan = await driver('bogdan');
    const car = await saved(ana.auth);
    await quoteRequest(ana.id, car.id, 'booked');

    const res = await remove(bogdan.auth, car.id);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('is allowed again once the open request closes', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);
    const open = await quoteRequest(id, car.id, 'in_work');
    expect((await remove(auth, car.id)).status).toBe(409);

    await prisma.quoteRequest.update({
      data: {
        closedAt: new Date(),
        closedReason: 'cancelled',
        status: 'closed',
      },
      where: { id: open.id },
    });

    expect((await remove(auth, car.id)).status).toBe(204);
  });
});

// @traces 092-FR-003
describe('removals racing', () => {
  it('lets one of five parallel removals through, with one entry and one event', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => remove(auth, car.id)),
    );

    expect(results.map((r) => r.status).sort()).toEqual([
      204, 404, 404, 404, 404,
    ]);
    expect(await events('car.removed')).toHaveLength(1);
    expect(
      (await audit(car.id)).filter((e) => e.action === 'delete'),
    ).toHaveLength(1);
  });

  it('settles an edit racing a removal on a removed car, with only 200 or 404 for the edit', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const [patched, deleted] = await Promise.all([
      edit(auth, car.id, { model: 'M3', version: car.updatedAt }),
      remove(auth, car.id),
    ]);

    expect(deleted.status).toBe(204);
    expect([200, 404]).toContain(patched.status);
    expect((await row(car.id)).removedAt).not.toBeNull();
    const listed = await http().get('/cars').set('Authorization', auth);
    expect(listed.body.items).toEqual([]);
  });

  it('answers 404 to an edit of a removed car whatever its body says', async () => {
    const { auth } = await driver();
    const car = await saved(auth);
    await remove(auth, car.id);

    const res = await edit(auth, car.id, {
      model: 'M3',
      version: car.updatedAt,
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect((await row(car.id)).model).toBe('320d');
  });

  it('keeps the other cars of the driver listed and counted after one removal', async () => {
    const { auth, id } = await driver();
    const gone = await saved(auth);
    const kept = await saved(auth);

    await remove(auth, gone.id);

    const listed = await http().get('/cars').set('Authorization', auth);
    expect(listed.body.items.map((c: Car) => c.id)).toEqual([kept.id]);
    expect(await prisma.car.count({ where: { ownerId: id } })).toBe(2);
  });
});
