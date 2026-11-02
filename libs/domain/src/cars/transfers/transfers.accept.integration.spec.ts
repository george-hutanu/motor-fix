import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import {
  acceptTransfer,
  sendTransfer,
  tokenOf,
  transfersApp,
  transfersWorld,
} from './transfers.testing';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { localDay } from '../../bucharest';
import { CacheService, cacheKey } from '../../cache/cache.service';
import { outbox } from '../../events/event.port';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { databaseUrl } from '../../notifications/notifications.testing';

// @traces 1265-FR-003 1265-FR-004 1265-FR-005 1265-FR-006 1265-FR-007 1265-FR-008 1265-FR-013 1265-FR-014 1265-FR-015 1265-FR-016

const SELLER_PHONE = '+40733000111';
const BUYER_PHONE = '+40722123456';
const world = transfersWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;
let restore: () => void;
let since: Date;
let mark: bigint;

beforeAll(async () => {
  await brevo.start();
  ({ app, restore } = await transfersApp(brevo));
});

afterAll(async () => {
  await app.close();
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await world.reset();
  brevo.reset();
  restore();
  ({ mark, since } = await world.marks());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const http = () => request(app.getHttpServer());
const open = (token: string, auth?: string) => {
  const call = http().get(`/car-transfers/${token}`);
  return auth ? call.set('Authorization', auth) : call;
};
const accept = (auth: string | null, token: string) =>
  acceptTransfer(app, auth, token);
const today = localDay(new Date());
const day = (value: string) => new Date(`${value}T00:00:00Z`);

// Andrei's car, with the dates and the plate a sale clears or keeps, and a
// link sent to the buyer with `ticked` passed on.
async function offered(
  options: { name?: string; ticked?: string[]; language?: 'ro' | 'en' } = {},
) {
  const seller = await world.driver(options.name ?? 'Andrei Marin', {
    language: options.language,
    phone: SELLER_PHONE,
  });
  const car = await world.car(seller.id);
  await prisma.car.update({
    data: {
      itpUntil: day('2027-03-01'),
      nextServiceKm: 95_000,
      rcaUntil: day('2027-01-15'),
      rovinietaUntil: day('2026-12-31'),
    },
    where: { id: car.id },
  });
  return { car, seller, ...(await sent(seller.auth, car.id, options.ticked)) };
}

async function sent(auth: string, carId: string, repairIds: string[] = []) {
  const res = await sendTransfer(app, auth, carId, {
    buyerPhone: BUYER_PHONE,
    repairIds,
  });
  expect(res.status).toBe(201);
  return { token: tokenOf(res.body.link), transferId: res.body.transfer.id };
}

const buyer = (name = 'Maria Ionescu') =>
  world.driver(name, { phone: BUYER_PHONE });

// What a refusal must leave as it was.
async function snapshot(carId: string, transferId: string) {
  return {
    car: await prisma.car.findUniqueOrThrow({ where: { id: carId } }),
    ownerships: await world.ownerships(carId),
    transfer: await prisma.carTransfer.findUniqueOrThrow({
      where: { id: transferId },
    }),
  };
}

describe('GET /car-transfers/:token with a session', () => {
  it('answers only the status to nobody signed in', async () => {
    const { token } = await offered();

    const res = await open(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'sent' });
  });

  it('shows another account the car, the repairs passed on and the seller’s short name, nothing private', async () => {
    const seller = await world.driver('Andrei Marin', { phone: SELLER_PHONE });
    const car = await world.car(seller.id);
    await world.throughMotorFix(seller.id, car.id);
    const kept = await world.logged(car.id, { what: 'Ticked kept' });
    const dropped = await world.logged(car.id, { what: 'Ticked deleted' });
    await world.logged(car.id, { what: 'Not ticked' });
    const { token } = await sent(seller.auth, car.id, [kept.id, dropped.id]);
    await prisma.repair.update({
      data: { deletedAt: new Date() },
      where: { id: dropped.id },
    });
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: car.brandId },
    });
    const maria = await buyer();

    const res = await open(token, maria.auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      car: { brand: brand.name, model: 'Cooper S', year: 2019 },
      repairCount: 2,
      sellerName: 'Andrei M.',
      status: 'sent',
    });
    const body = JSON.stringify(res.body);
    for (const secret of [
      BUYER_PHONE,
      SELLER_PHONE,
      'B123ABC',
      seller.id,
      token,
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  it.each([
    ['', null],
    ['Andrei', 'Andrei'],
    ['Andrei Marin', 'Andrei M.'],
    ['Andrei Ion Marin', 'Andrei M.'],
  ])('shortens the seller name %j to %j', async (name, short) => {
    const { seller, token } = await offered();
    await prisma.account.update({ data: { name }, where: { id: seller.id } });
    const maria = await buyer();

    const res = await open(token, maria.auth);

    expect(res.body.sellerName).toBe(short);
  });

  it('answers the seller 403 own_transfer, and 410 once the link is cancelled', async () => {
    const { car, seller, token, transferId } = await offered();

    const own = await open(token, seller.auth);
    expect(own.status).toBe(403);
    expect(own.body.code).toBe('own_transfer');

    await http()
      .post(`/cars/${car.id}/transfers/${transferId}/cancel`)
      .set('Authorization', seller.auth)
      .expect(204);
    const gone = await open(token, seller.auth);
    expect(gone.status).toBe(410);
    expect(gone.body.code).toBe('transfer_cancelled');
  });

  it('answers 410 transfer_accepted once taken over, signed in or not', async () => {
    const { token } = await offered();
    const maria = await buyer();
    await accept(maria.auth, token).expect(200);

    for (const auth of [undefined, maria.auth]) {
      const res = await open(token, auth);
      expect(res.status).toBe(410);
      expect(res.body.code).toBe('transfer_accepted');
    }
  });

  it('answers 404 to a signed-in account for an unknown link', async () => {
    const maria = await buyer();

    const res = await open('x'.repeat(43), maria.auth);

    expect(res.status).toBe(404);
  });
});

describe('POST /car-transfers/:token/accept', () => {
  it('answers 401 sign_in_required to nobody signed in', async () => {
    const { token } = await offered();

    const res = await accept(null, token);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it.each(['x'.repeat(43), 'short'])(
    'answers 404 not_found for the unknown link %s',
    async (token) => {
      const maria = await buyer();

      const res = await accept(maria.auth, token);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    },
  );

  it('gives the car to the buyer, clearing the plate, RCA, rovinietă and the add key, keeping the rest', async () => {
    const { car, seller, token, transferId } = await offered();
    const maria = await buyer();

    const res = await accept(maria.auth, token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ carId: car.id });
    const after = await prisma.car.findUniqueOrThrow({
      where: { id: car.id },
    });
    expect(after).toMatchObject({
      idempotencyKey: null,
      itpUntil: day('2027-03-01'),
      nextServiceKm: 95_000,
      odometerKm: 84_000,
      ownerId: maria.id,
      plate: null,
      rcaUntil: null,
      rovinietaUntil: null,
    });
    const transfer = await prisma.carTransfer.findUniqueOrThrow({
      where: { id: transferId },
    });
    expect(transfer).toMatchObject({
      buyerId: maria.id,
      saleDate: day(today),
      status: 'accepted',
    });
    const [sold, bought] = await world.ownerships(car.id);
    expect(sold).toMatchObject({
      access: 'former_owner_read_only',
      accountId: seller.id,
      toDate: day(today),
      transferId: null,
    });
    expect(sold?.closedAt).toBeInstanceOf(Date);
    expect(bought).toMatchObject({
      access: 'owner',
      accountId: maria.id,
      closedAt: null,
      fromDate: day(today),
      toDate: null,
      transferId,
    });
    expect(bought?.openedAt.getTime()).toBe(sold?.closedAt?.getTime());
  });

  it('moves the reminders with their ids and stages, and drops RCA and rovinietă', async () => {
    const { car, seller, token } = await offered();
    const reminder = (kind: string, sent30 = false) =>
      prisma.reminder.create({
        data: {
          accountId: seller.id,
          carId: car.id,
          dueOn: day('2027-01-15'),
          kind: kind as never,
          sent30,
        },
      });
    const itp = await reminder('itp', true);
    const service = await reminder('service');
    const tyres = await reminder('tyres_winter');
    await reminder('rca', true);
    await reminder('rovinieta');
    const maria = await buyer();

    await accept(maria.auth, token).expect(200);

    const rows = await prisma.reminder.findMany({
      orderBy: { kind: 'asc' },
      where: { carId: car.id },
    });
    expect(
      rows.map(({ accountId, id, kind, sent30 }) => ({
        accountId,
        id,
        kind,
        sent30,
      })),
    ).toEqual(
      expect.arrayContaining([
        { accountId: maria.id, id: itp.id, kind: 'itp', sent30: true },
        { accountId: maria.id, id: service.id, kind: 'service', sent30: false },
        {
          accountId: maria.id,
          id: tyres.id,
          kind: 'tyres_winter',
          sent30: false,
        },
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it('records the step and each changed car field as the buyer, with no phone, token or plate', async () => {
    const { car, seller, token, transferId } = await offered();
    const maria = await buyer();

    await accept(maria.auth, token).expect(200);

    const step = (await world.transferAudit(since)).filter(
      (e) => e.subjectId === transferId && e.action === 'update',
    );
    expect(step).toEqual([
      expect.objectContaining({
        actorId: maria.id,
        actorRole: 'driver',
        carId: car.id,
        field: 'status',
        newValue: 'accepted',
        oldValue: 'sent',
      }),
    ]);
    const entries = await prisma.activityLog.findMany({
      where: { at: { gte: since }, subjectId: car.id, subjectType: 'car' },
    });
    const byField = Object.fromEntries(
      entries.map((e) => [e.field, [e.oldValue, e.newValue]]),
    );
    expect(byField).toEqual({
      ownerId: [seller.id, maria.id],
      plate: [null, null],
      rcaUntil: ['2027-01-15', null],
      rovinietaUntil: ['2026-12-31', null],
    });
    for (const entry of entries) {
      expect(entry).toMatchObject({
        action: 'update',
        actorId: maria.id,
        actorRole: 'driver',
      });
    }
    const all = JSON.stringify(await world.transferAudit(since));
    const cars = JSON.stringify(entries);
    for (const secret of [BUYER_PHONE, token, 'B123ABC']) {
      expect(all).not.toContain(secret);
      expect(cars).not.toContain(secret);
    }
  });

  it('hands car_transfer.accepted to both accounts, and no car.updated', async () => {
    const { car, seller, token, transferId } = await offered();
    ({ mark } = await world.marks());
    const maria = await buyer();

    await accept(maria.auth, token).expect(200);

    const events = await world.transferEvents(mark);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: [`account:${seller.id}`, `account:${maria.id}`],
      kind: 'car_transfer.accepted',
      subjectId: transferId,
    });
    expect(events[0]?.payload).toEqual({
      buyerAccountId: maria.id,
      carId: car.id,
      sellerAccountId: seller.id,
      status: 'accepted',
      transferId,
    });
    expect(
      await prisma.outboxEvent.count({
        where: { id: { gt: mark }, kind: 'car.updated' },
      }),
    ).toBe(0);
  });

  it.each([
    [
      'the history',
      () =>
        vi
          .spyOn(AuditService.prototype, 'recordChanges')
          .mockRejectedValue(new Error('history unavailable')),
    ],
    [
      'the event',
      () =>
        vi
          .spyOn(outbox, 'record')
          .mockRejectedValue(new Error('outbox unavailable')),
    ],
  ])('changes nothing when %s cannot be written', async (_, fail) => {
    const { car, token, transferId } = await offered();
    const before = await snapshot(car.id, transferId);
    const maria = await buyer();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fail();

    const res = await accept(maria.auth, token);

    expect(res.status).toBe(500);
    expect(await snapshot(car.id, transferId)).toEqual(before);
  });

  it('answers a second accept 410 transfer_accepted and changes nothing', async () => {
    const { car, token, transferId } = await offered();
    const maria = await buyer();
    await accept(maria.auth, token).expect(200);
    const before = await snapshot(car.id, transferId);
    const ana = await world.driver('Ana Pop');

    for (const auth of [maria.auth, ana.auth]) {
      const res = await accept(auth, token);
      expect(res.status).toBe(410);
      expect(res.body.code).toBe('transfer_accepted');
    }
    expect(await snapshot(car.id, transferId)).toEqual(before);
  });

  it('lets one of two parallel accepts through and answers the other 410', async () => {
    const { car, token } = await offered();
    const maria = await buyer();
    const ana = await world.driver('Ana Pop');

    const answers = await Promise.all([
      accept(maria.auth, token),
      accept(ana.auth, token),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(answers.find((r) => r.status === 410)?.body.code).toBe(
      'transfer_accepted',
    );
    const open = (await world.ownerships(car.id)).filter((o) => !o.toDate);
    expect(open).toHaveLength(1);
  });

  it('waits for a request the seller is sending, then refuses with open_request', async () => {
    const { car, seller, token, transferId } = await offered();
    const maria = await buyer();
    let pending: Promise<request.Response> | undefined;

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM account WHERE id = ${seller.id}::uuid FOR UPDATE`;
      pending = accept(maria.auth, token).then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await tx.quoteRequest.create({
        data: {
          carBrand: 'Mini',
          carFuel: 'petrol',
          carId: car.id,
          carModel: 'Cooper S',
          carYear: 2019,
          driverId: seller.id,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          idempotencyKey: `held-${seller.id}`,
          status: 'sent',
        },
      });
    });
    const res = await pending;

    expect(res?.status).toBe(409);
    expect(res?.body.code).toBe('open_request');
    expect(
      (
        await prisma.carTransfer.findUniqueOrThrow({
          where: { id: transferId },
        })
      ).status,
    ).toBe('sent');
  });
});

describe('an accept that cannot go through', () => {
  const refused = async (
    res: request.Response,
    status: number,
    error: string,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(error);
  };

  it.each([
    ['cancelled', { status: 'cancelled' }, 'transfer_cancelled'],
    ['expired', { status: 'expired' }, 'transfer_expired'],
    [
      'sent but past its time',
      { expiresAt: new Date(Date.now() - 1000), sentAt: new Date(0) },
      'transfer_expired',
    ],
  ] as const)(
    'answers a %s transfer 410 and writes nothing',
    async (_, change, error) => {
      const { car, token, transferId } = await offered();
      await prisma.carTransfer.update({
        data: change,
        where: { id: transferId },
      });
      const before = await snapshot(car.id, transferId);
      ({ mark, since } = await world.marks());
      const maria = await buyer();

      await refused(await accept(maria.auth, token), 410, error);

      expect(await snapshot(car.id, transferId)).toEqual(before);
      expect(await world.transferEvents(mark)).toEqual([]);
      expect(await world.transferAudit(since)).toEqual([]);
    },
  );

  it('answers a removed car’s transfer 410 transfer_cancelled', async () => {
    const { car, token } = await offered();
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: car.id },
    });
    const maria = await buyer();

    await refused(await accept(maria.auth, token), 410, 'transfer_cancelled');
  });

  it('answers the seller 403 own_transfer', async () => {
    const { car, seller, token, transferId } = await offered();
    const before = await snapshot(car.id, transferId);

    await refused(await accept(seller.auth, token), 403, 'own_transfer');
    expect(await snapshot(car.id, transferId)).toEqual(before);
  });

  it('answers the seller of an expired link 410, not 403', async () => {
    const { seller, token, transferId } = await offered();
    await prisma.carTransfer.update({
      data: { status: 'expired' },
      where: { id: transferId },
    });

    await refused(await accept(seller.auth, token), 410, 'transfer_expired');
  });

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

  it('answers a buyer holding 20 cars 409 car_limit', async () => {
    const { car, token, transferId } = await offered();
    const maria = await buyer();
    await holding(maria.id, car.brandId, 20);
    const before = await snapshot(car.id, transferId);

    await refused(await accept(maria.auth, token), 409, 'car_limit');
    expect(await snapshot(car.id, transferId)).toEqual(before);
  });

  it('lets a buyer with 19 cars and a removed one take the 20th', async () => {
    const { car, token } = await offered();
    const maria = await buyer();
    await holding(maria.id, car.brandId, 20);
    await prisma.car.updateMany({
      data: { removedAt: new Date() },
      where: { idempotencyKey: 'held-0', ownerId: maria.id },
    });

    const res = await accept(maria.auth, token);

    expect(res.status).toBe(200);
  });

  it.each(['sent', 'quoted', 'booked', 'in_work'] as const)(
    'answers 409 open_request while the car has a %s request',
    async (status) => {
      const { car, seller, token, transferId } = await offered();
      const maria = await buyer();
      // The request comes after the send, as one could by another device.
      await world.request(seller.id, { carId: car.id, status });
      const before = await snapshot(car.id, transferId);

      await refused(await accept(maria.auth, token), 409, 'open_request');
      expect(await snapshot(car.id, transferId)).toEqual(before);
    },
  );

  it.each(['done', 'closed'] as const)(
    'lets the car go with a %s request',
    async (status) => {
      const { car, seller, token } = await offered();
      await world.request(seller.id, { carId: car.id, status });
      const maria = await buyer();

      expect((await accept(maria.auth, token)).status).toBe(200);
    },
  );

  it('answers car_limit before open_request', async () => {
    const { car, seller, token } = await offered();
    const maria = await buyer();
    await holding(maria.id, car.brandId, 20);
    await world.request(seller.id, { carId: car.id, status: 'sent' });

    await refused(await accept(maria.auth, token), 409, 'car_limit');
  });
});

describe('a buyer without the driver role', () => {
  const roleEntries = (accountId: string) =>
    prisma.activityLog.findMany({
      where: {
        action: 'update',
        at: { gte: since },
        field: 'role',
        subjectId: accountId,
      },
    });

  it('makes a garage-only account a driver, with one role entry', async () => {
    const { token } = await offered();
    const id = await world.account('Ion Garage', ['garage']);

    const res = await accept(world.bearer(id, 'garage'), token);

    expect(res.status).toBe(200);
    expect(
      await prisma.accountRole.count({
        where: { accountId: id, role: 'driver' },
      }),
    ).toBe(1);
    expect(await roleEntries(id)).toHaveLength(1);
  });

  it('grants nothing to a driver acting as a garage', async () => {
    const { token } = await offered();
    const id = await world.account('Ion Both', ['driver', 'garage']);

    const res = await accept(world.bearer(id, 'garage'), token);

    expect(res.status).toBe(200);
    expect(await roleEntries(id)).toHaveLength(0);
  });
});

describe('the car after it changed hands', () => {
  it('answers the seller 404 on every car route, and lists the car only for the buyer', async () => {
    const { car, seller, token, transferId } = await offered();
    const maria = await buyer();
    await accept(maria.auth, token).expect(200);
    const as = (call: request.Test) => call.set('Authorization', seller.auth);

    // Built one at a time: supertest closes the shared server after each call.
    for (const call of [
      () => as(http().get(`/cars/${car.id}/sale`)),
      () =>
        as(
          http()
            .patch(`/cars/${car.id}`)
            .send({ model: 'Altul', version: new Date().toISOString() }),
        ),
      () => as(http().delete(`/cars/${car.id}`)),
      () => as(http().post(`/cars/${car.id}/transfers/${transferId}/cancel`)),
      () =>
        as(
          http()
            .post(`/cars/${car.id}/transfers`)
            .send({ buyerPhone: BUYER_PHONE, repairIds: [] }),
        ),
    ]) {
      expect((await call()).status).toBe(404);
    }
    const theirs = await http().get('/cars').set('Authorization', seller.auth);
    expect(theirs.body.items).toEqual([]);
    const mine = await http().get('/cars').set('Authorization', maria.auth);
    expect(mine.body.items).toEqual([
      expect.objectContaining({
        id: car.id,
        plate: null,
        rcaUntil: null,
        rovinietaUntil: null,
      }),
    ]);
  });

  it('drops both warm car lists', async () => {
    const { car, seller, token } = await offered();
    const maria = await buyer();
    const cache = app.get(CacheService, { strict: false });
    for (const [id, items] of [
      [seller.id, [{ id: car.id }]],
      [maria.id, []],
    ] as const) {
      await cache.read({
        key: cacheKey('driver-home', id, 'cars'),
        read: async () => ({ tags: [], value: { items } }),
        soft: 90,
        stale: false,
      });
    }

    await accept(maria.auth, token).expect(200);

    const theirs = await http().get('/cars').set('Authorization', seller.auth);
    expect(theirs.body.items).toEqual([]);
    const mine = await http().get('/cars').set('Authorization', maria.auth);
    expect(mine.body.items.map((c: { id: string }) => c.id)).toEqual([car.id]);
  });

  it('offers the next sale only what the buyer can read: never the first seller’s unticked repairs', async () => {
    const seller = await world.driver('Andrei Marin', { phone: SELLER_PHONE });
    const car = await world.car(seller.id);
    const ticked = await world.logged(car.id, { what: 'Ticked' });
    const kept = await world.logged(car.id, { what: 'Not ticked' });
    const { token } = await sent(seller.auth, car.id, [ticked.id]);
    const maria = await world.driver('Maria Ionescu', {
      phone: '+40744000222',
    });
    await accept(maria.auth, token).expect(200);
    const hers = await world.logged(car.id, { what: 'Logged by Maria' });

    const sale = await http()
      .get(`/cars/${car.id}/sale`)
      .set('Authorization', maria.auth);

    expect(sale.status).toBe(200);
    expect(sale.body.repairs.map((r: { id: string }) => r.id).sort()).toEqual(
      [ticked.id, hers.id].sort(),
    );
    const refused = await sendTransfer(app, maria.auth, car.id, {
      buyerPhone: SELLER_PHONE,
      repairIds: [kept.id],
    });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('repair_not_tickable');
    const passed = await sendTransfer(app, maria.auth, car.id, {
      buyerPhone: SELLER_PHONE,
      repairIds: [ticked.id, hers.id],
    });
    expect(passed.status).toBe(201);
  });
});

describe('what an accept counts and logs', () => {
  it('counts the accept and each refusal by outcome', async () => {
    const reader = countedMetrics();
    const total = (outcome: string) =>
      counterTotal(reader, 'motorfix_car_transfer_accepts_total', { outcome });
    const { seller, token } = await offered();
    const maria = await buyer();
    const before = {
      accepted: await total('accepted'),
      not_found: await total('not_found'),
      own_transfer: await total('own_transfer'),
      transfer_accepted: await total('transfer_accepted'),
    };

    await accept(maria.auth, 'x'.repeat(43));
    await accept(seller.auth, token);
    await accept(maria.auth, token);
    await accept(maria.auth, token);

    expect(await total('not_found')).toBe(before.not_found + 1);
    expect(await total('own_transfer')).toBe(before.own_transfer + 1);
    expect(await total('accepted')).toBe(before.accepted + 1);
    expect(await total('transfer_accepted')).toBe(before.transfer_accepted + 1);
  });

  it('logs no phone, token or plate', async () => {
    const { token } = await offered();
    const maria = await buyer();
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(((
        message: unknown,
      ) => {
        lines.push(String(message));
      }) as never);
    }

    await accept(maria.auth, token).expect(200);

    const text = lines.join('\n');
    expect(text).toContain('accepted');
    for (const secret of [BUYER_PHONE, SELLER_PHONE, token, 'B123ABC']) {
      expect(text).not.toContain(secret);
    }
  });
});
