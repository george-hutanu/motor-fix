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
import { addDays, localDay } from '../../../bucharest';
import { outboxMark } from '../../../events/outbox.testing';
import type { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../../notifications/notifications.testing';
import {
  type CarEvent,
  RemindersService,
} from '../../reminders/reminders.service';

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

// The catalogue outlives the reset, and a brand's name is unique.
async function brand(name: string) {
  const key = `test-${name.toLowerCase()}`;
  return prisma.brand.upsert({
    create: { active: true, key, name, slug: key },
    update: { active: true },
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

// A BMW 320d with its plate and an ITP date ten days ahead, added through the API.
async function saved(auth: string): Promise<Car> {
  const { id: brandId } = await brand('BMW');
  const res = await http()
    .post('/cars')
    .set('Authorization', auth)
    .set('Idempotency-Key', randomUUID())
    .send({
      brandId,
      fuel: 'diesel',
      itpUntil: addDays(today, 10),
      model: '320d',
      odometerKm: 148200,
      plate: 'B123ABC',
      year: 2019,
    });
  expect(res.status).toBe(201);
  return res.body;
}

const remove = (auth: string | null, id: string) => {
  const call = http().delete(`/cars/${id}`);
  return auth ? call.set('Authorization', auth) : call;
};

const row = (id: string) => prisma.car.findUnique({ where: { id } });

const removals = () =>
  prisma.outboxEvent.findMany({
    where: { id: { gt: mark }, kind: 'car.removed' },
  });

const carAudit = (subjectId: string) =>
  prisma.activityLog.findMany({
    where: { at: { gte: since }, subjectId, subjectType: 'car' },
  });

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

// @traces 092-FR-003
describe('DELETE /cars/:id', () => {
  it('answers 204 and marks the car removed, keeping its row', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await remove(auth, car.id);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const stored = await row(car.id);
    expect(stored).not.toBeNull();
    expect(stored?.removedAt).toBeInstanceOf(Date);
  });

  it('leaves the removed car out of the list', async () => {
    const { auth } = await driver();
    const kept = await saved(auth);
    const gone = await saved(auth);

    await remove(auth, gone.id);
    const list = await http().get('/cars').set('Authorization', auth);

    expect(list.status).toBe(200);
    expect(list.body.items.map((c: Car) => c.id)).toEqual([kept.id]);
  });

  it('frees a place under the 20-car limit', async () => {
    const { auth, id } = await driver();
    const first = await saved(auth);
    const { id: brandId } = await brand('BMW');
    await prisma.car.createMany({
      data: Array.from({ length: 19 }, (_, i) => ({
        brandId,
        fuel: 'petrol' as const,
        idempotencyKey: `held-${i}`,
        model: `Model ${i}`,
        odometerKm: 1000,
        ownerId: id,
        year: 2015,
      })),
    });
    const add = () =>
      http()
        .post('/cars')
        .set('Authorization', auth)
        .set('Idempotency-Key', randomUUID())
        .send({
          brandId,
          fuel: 'petrol',
          model: 'Seria 1',
          odometerKm: 1,
          year: 2020,
        });
    expect((await add()).status).toBe(409);

    expect((await remove(auth, first.id)).status).toBe(204);

    expect((await add()).status).toBe(201);
  });

  it.each(['done', 'closed'] as const)(
    'removes a car whose request is %s',
    async (status) => {
      const { auth, id } = await driver();
      const car = await saved(auth);
      await quoteRequest(id, car.id, status);

      expect((await remove(auth, car.id)).status).toBe(204);
    },
  );

  it('keeps the requests of a removed car stored', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);
    const done = await quoteRequest(id, car.id, 'done');

    await remove(auth, car.id);

    expect(
      await prisma.quoteRequest.findUnique({ where: { id: done.id } }),
    ).toMatchObject({ carId: car.id, status: 'done' });
  });
});

// @traces 092-FR-003
describe('a car with an open request', () => {
  // @traces 092-FR-003
  it('is refused when a request for it commits while the removal waits', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);
    let removal: Promise<request.Response> | undefined;
    let settled = false;

    // A request being sent holds the driver's account row, as sending one does.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM account WHERE id = ${id}::uuid FOR UPDATE`;
      removal = remove(auth, car.id).then((res) => {
        settled = true;
        return res;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await tx.quoteRequest.create({
        data: {
          carBrand: 'BMW',
          carFuel: 'diesel',
          carId: car.id,
          carModel: '320d',
          carYear: 2019,
          driverId: id,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          idempotencyKey: randomUUID(),
          status: 'sent',
        },
      });
    });
    const res = await removal;

    expect(res?.status).toBe(409);
    expect(res?.body.code).toBe('open_request');
    expect((await row(car.id))?.removedAt).toBeNull();
  });

  it.each(['sent', 'quoted', 'booked', 'in_work'] as const)(
    'is refused with 409 open_request while a request is %s, and stays',
    async (status) => {
      const { auth, id } = await driver();
      const car = await saved(auth);
      await quoteRequest(id, car.id, status);

      const res = await remove(auth, car.id);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('open_request');
      expect((await row(car.id))?.removedAt).toBeNull();
      expect(await removals()).toHaveLength(0);
      expect(
        (await carAudit(car.id)).filter((e) => e.action === 'delete'),
      ).toHaveLength(0);
    },
  );
});

// @traces 092-FR-014
describe('whose car a removal reaches', () => {
  it.each([
    ['another driver’s car', 'other'],
    ['a car already removed', 'removed'],
    ['an unknown id', 'unknown'],
  ])('answers 404 not_found for %s', async (_, which) => {
    const ana = await driver('ana');
    const car = await saved(ana.auth);
    const { auth } = which === 'other' ? await driver('bogdan') : ana;
    if (which === 'removed') {
      expect((await remove(auth, car.id)).status).toBe(204);
    }
    const id = which === 'unknown' ? randomUUID() : car.id;

    const res = await remove(auth, id);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(JSON.stringify(res.body)).not.toMatch(/B123ABC|320d/);
    if (which === 'other') expect((await row(car.id))?.removedAt).toBeNull();
  });

  it('answers 400 validation_failed to an id that is not one', async () => {
    const { auth } = await driver();

    const res = await remove(auth, 'not-an-id');

    expect(res.status).toBe(400);
  });

  it.each(['garage', 'admin'] as const)(
    'answers 404 to a %s, who holds no cars',
    async (role) => {
      const ana = await driver('ana');
      const car = await saved(ana.auth);
      const id = await account(`cont-${role}`, [role]);

      const res = await remove(bearer(id, role), car.id);

      expect(res.status).toBe(404);
      expect((await row(car.id))?.removedAt).toBeNull();
    },
  );

  it('answers 401 sign_in_required without a session', async () => {
    const ana = await driver('ana');
    const car = await saved(ana.auth);

    const res = await remove(null, car.id);

    expect(res.status).toBe(401);
    expect((await row(car.id))?.removedAt).toBeNull();
  });

  it('makes an edit on the version read before it answer 404', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const removed = await remove(auth, car.id);
    const edited = await http()
      .patch(`/cars/${car.id}`)
      .set('Authorization', auth)
      .send({ odometerKm: 150000, version: car.updatedAt });

    expect(removed.status).toBe(204);
    expect(edited.status).toBe(404);
    expect((await row(car.id))?.odometerKm).toBe(148200);
  });
});

// @traces 092-FR-004
// @traces 092-FR-005
describe('what a removal writes beside the car', () => {
  it('writes one delete entry for the car', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);

    await remove(auth, car.id);

    const entries = (await carAudit(car.id)).filter(
      (e) => e.action === 'delete',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: id,
      subjectId: car.id,
      subjectType: 'car',
    });
    expect(JSON.stringify(entries[0])).not.toMatch(/B123ABC/);
  });

  it('hands car.removed to the outbox with the car and its owner, no plate and no model', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);

    await remove(auth, car.id);

    const events = await removals();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subjectId: car.id });
    expect(events[0].payload).toEqual({ carId: car.id, ownerId: id });
  });

  it('removes nothing and hands nothing on when the history cannot be written', async () => {
    const { auth } = await driver();
    const car = await saved(auth);
    jest
      .spyOn(AuditService.prototype, 'record')
      .mockRejectedValue(new Error('history unavailable'));

    const res = await remove(auth, car.id);

    expect(res.status).toBe(500);
    expect((await row(car.id))?.removedAt).toBeNull();
    expect(await removals()).toHaveLength(0);
  });
});

// @traces 092-FR-007
// @traces 092-FR-012
describe('the reminders of a removed car', () => {
  it('are gone once car.removed is relayed, and the daily run sends nothing for it', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);
    const notify = jest.fn();
    const notifications = {
      notify,
      now: () => new Date(),
    } as unknown as NotificationsService;
    const reminders = new RemindersService(prisma, notifications);
    await reminders.setCarDue({
      accountId: id,
      carId: car.id,
      dueOn: addDays(today, 10),
      kind: 'itp',
      today,
    });

    await remove(auth, car.id);
    const [event] = await removals();
    const relayed: CarEvent = {
      id: String(event.id),
      kind: event.kind,
      payload: event.payload as CarEvent['payload'],
      subjectId: event.subjectId,
    };
    await reminders.onCarEvent(relayed);
    await reminders.onCarEvent(relayed);

    expect(await prisma.reminder.count({ where: { carId: car.id } })).toBe(0);
    expect(await reminders.run(today)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends nothing for a removed car whose reminder is still stored', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);
    const notify = jest.fn();
    const reminders = new RemindersService(prisma, {
      notify,
      now: () => new Date(),
    } as unknown as NotificationsService);
    await reminders.setCarDue({
      accountId: id,
      carId: car.id,
      dueOn: addDays(today, 10),
      kind: 'itp',
      today,
    });

    await remove(auth, car.id);

    expect(await reminders.run(today)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});
