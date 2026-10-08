import { randomUUID } from 'node:crypto';

import { HttpException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { writeGaragePayments } from './write-garage-payments';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
// The history and the outbox are never emptied: each test reads its own.
// The outbox is cut by id: its time is the client's clock, not the database's.
let since: Date;
let lastEvent: bigint;

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
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
  await checkpoint();
});

async function checkpoint() {
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  since = at;
  const [{ id }] = await prisma.$queryRaw<
    { id: bigint }[]
  >`SELECT COALESCE(MAX(id), 0)::bigint AS id FROM outbox_event`;
  lastEvent = id;
}

const stored = (garageId: string) =>
  prisma.garage.findUniqueOrThrow({
    select: {
      courtesyCarPaid: true,
      courtesyCarPricePerDayBani: true,
      paymentCard: true,
      paymentCash: true,
      paymentTransfer: true,
    },
    where: { id: garageId },
  });

const history = (garageId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { at: { gte: since }, garageId, subjectType: 'garage' },
  });

const events = (garageId: string) =>
  prisma.outboxEvent.findMany({
    where: {
      id: { gt: lastEvent },
      kind: 'garage.updated',
      subjectId: garageId,
    },
  });

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
};

describe("writing a garage's payment methods and courtesy car from step 5", () => {
  let garageId: string;

  beforeEach(async () => {
    ({ id: garageId } = await prisma.garage.create({
      data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
    }));
  });

  const write = (section: Record<string, unknown>) =>
    prisma.$transaction((tx) => writeGaragePayments(tx, garageId, section));

  it('starts a garage with no payment method and no courtesy car price', async () => {
    expect(await stored(garageId)).toEqual({
      courtesyCarPaid: false,
      courtesyCarPricePerDayBani: null,
      paymentCard: false,
      paymentCash: false,
      paymentTransfer: false,
    });
  });

  it('writes the ticked payment methods and a paid courtesy car with its price', async () => {
    await write({
      courtesyCar: { paid: true, pricePerDayBani: 15000 },
      facilities: ['courtesy_car'],
      payments: ['cash', 'transfer'],
    });

    expect(await stored(garageId)).toEqual({
      courtesyCarPaid: true,
      courtesyCarPricePerDayBani: 15000,
      paymentCard: false,
      paymentCash: true,
      paymentTransfer: true,
    });
  });

  it('writes a free courtesy car with no price', async () => {
    await write({
      courtesyCar: { paid: false },
      facilities: ['courtesy_car'],
      payments: ['card'],
    });

    expect(await stored(garageId)).toMatchObject({
      courtesyCarPaid: false,
      courtesyCarPricePerDayBani: null,
      paymentCard: true,
    });
  });

  it('clears the paid courtesy car when the section no longer lists the facility', async () => {
    await write({
      courtesyCar: { paid: true, pricePerDayBani: 15000 },
      facilities: ['courtesy_car'],
      payments: ['cash'],
    });

    await write({
      courtesyCar: { paid: true, pricePerDayBani: 15000 },
      facilities: ['waiting_area'],
      payments: ['cash'],
    });

    expect(await stored(garageId)).toMatchObject({
      courtesyCarPaid: false,
      courtesyCarPricePerDayBani: null,
    });
  });

  it('replaces the payment methods whole on a second write', async () => {
    await write({ payments: ['cash', 'card'] });

    await write({ payments: ['transfer'] });

    expect(await stored(garageId)).toMatchObject({
      paymentCard: false,
      paymentCash: false,
      paymentTransfer: true,
    });
  });

  it.each([
    ['a section with no payment method', { facilities: [] }],
    ['an empty payment list', { payments: [] }],
    ['an unknown payment method', { payments: ['cheque'] }],
    ['a payment method twice', { payments: ['cash', 'cash'] }],
    [
      'a paid courtesy car without a price',
      {
        courtesyCar: { paid: true },
        facilities: ['courtesy_car'],
        payments: ['cash'],
      },
    ],
    [
      'a price of 50 bani',
      {
        courtesyCar: { paid: true, pricePerDayBani: 50 },
        facilities: ['courtesy_car'],
        payments: ['cash'],
      },
    ],
    [
      'a price of 200,100 bani',
      {
        courtesyCar: { paid: true, pricePerDayBani: 200_100 },
        facilities: ['courtesy_car'],
        payments: ['cash'],
      },
    ],
    [
      'a price that is not whole lei',
      {
        courtesyCar: { paid: true, pricePerDayBani: 150 },
        facilities: ['courtesy_car'],
        payments: ['cash'],
      },
    ],
    [
      'a courtesy car with an extra key',
      {
        courtesyCar: { paid: false, seats: 5 },
        facilities: ['courtesy_car'],
        payments: ['cash'],
      },
    ],
  ])('refuses %s whole and keeps what was there', async (_, section) => {
    await write({
      courtesyCar: { paid: true, pricePerDayBani: 15000 },
      facilities: ['courtesy_car'],
      payments: ['card'],
    });
    const before = await stored(garageId);

    const refused = await refusalOf(write(section));

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    expect(await stored(garageId)).toEqual(before);
  });

  it('writes nothing to the history or the outbox', async () => {
    const entries = await prisma.activityLog.count();
    const saved = await prisma.outboxEvent.count();

    await write({
      courtesyCar: { paid: true, pricePerDayBani: 15000 },
      facilities: ['courtesy_car'],
      payments: ['cash'],
    });

    expect(await prisma.activityLog.count()).toBe(entries);
    expect(await prisma.outboxEvent.count()).toBe(saved);
  });
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

// Service Auto Nord (approved) with its owner Mihai, a receptionist and a
// mechanic; Atelier Dinamo with its owner Radu; a driver and an admin.
async function world({ courtesyCar = true } = {}) {
  const nord = await prisma.garage.create({
    data: {
      name: 'Service Auto Nord',
      slug: `nord-${randomUUID()}`,
      status: 'approved',
    },
  });
  if (courtesyCar) {
    await prisma.garageFacility.create({
      data: { facility: 'courtesy_car', garageId: nord.id },
    });
  }
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: nord.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: nord.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic']);
  await prisma.mechanic.create({
    data: { accountId: vlad, garageId: nord.id, name: 'Mecanic' },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: dinamo.id, role: 'owner' },
  });
  const andrei = await account('andrei', ['driver']);
  const ana = await account('ana', ['admin']);
  return {
    admin: bearer(ana, 'admin'),
    driver: bearer(andrei, 'driver'),
    mechanic: bearer(vlad, 'mechanic'),
    mihai,
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const patch = (w: World, body: object, as: string | null = w.owner) => {
  const req = http().patch(`/garages/${w.nord.id}`).send(body);
  return as ? req.set('Authorization', as) : req;
};

const cashAndCard = { card: true, cash: true, transfer: false };

describe('PATCH /garages/:garageId', () => {
  it('stores the payment methods and a paid courtesy car and answers what is stored', async () => {
    const w = await world();

    const res = await patch(w, {
      courtesyCar: { paid: true, pricePerDayBani: 12000 },
      paymentMethods: cashAndCard,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      courtesyCar: { paid: true, pricePerDayBani: 12000 },
      paymentMethods: cashAndCard,
    });
    expect(await stored(w.nord.id)).toEqual({
      courtesyCarPaid: true,
      courtesyCarPricePerDayBani: 12000,
      paymentCard: true,
      paymentCash: true,
      paymentTransfer: false,
    });
  });

  it('changes what the public garage page shows', async () => {
    const w = await world();
    await patch(w, {
      courtesyCar: { paid: true, pricePerDayBani: 12000 },
      paymentMethods: cashAndCard,
    });

    await patch(w, { paymentMethods: { ...cashAndCard, card: false } });

    const page = await http().get(`/garages/${w.nord.slug}`);
    expect(page.status).toBe(200);
    expect(page.body.paymentMethods).toEqual({
      card: false,
      cash: true,
      transfer: false,
    });
    expect(page.body.courtesyCar).toEqual({
      paid: true,
      pricePerDayBani: 12000,
    });
  });

  it('answers a free courtesy car without a price and clears the stored one', async () => {
    const w = await world();
    await patch(w, { courtesyCar: { paid: true, pricePerDayBani: 12000 } });

    const res = await patch(w, { courtesyCar: { paid: false } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      courtesyCar: { paid: false },
      paymentMethods: { card: false, cash: false, transfer: false },
    });
    expect(await stored(w.nord.id)).toMatchObject({
      courtesyCarPaid: false,
      courtesyCarPricePerDayBani: null,
    });
  });

  it('answers no courtesy car for a garage that does not list one', async () => {
    const w = await world({ courtesyCar: false });

    const res = await patch(w, { paymentMethods: cashAndCard });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ paymentMethods: cashAndCard });
  });

  it('records one history entry per changed field, by the owner', async () => {
    const w = await world();

    await patch(w, {
      courtesyCar: { paid: true, pricePerDayBani: 12000 },
      paymentMethods: cashAndCard,
    });

    const entries = await history(w.nord.id);
    expect(
      entries.map((e) => [e.field, e.oldValue, e.newValue]).sort(),
    ).toEqual([
      ['courtesy_car_paid', false, true],
      ['courtesy_car_price_per_day_bani', null, 12000],
      ['payment_card', false, true],
      ['payment_cash', false, true],
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        actorId: w.mihai,
        actorRole: 'owner',
        garageId: w.nord.id,
        subjectId: w.nord.id,
      });
    }
  });

  it('saves one garage.updated event naming the payment methods, for the garage, its page and search', async () => {
    const w = await world();

    await patch(w, { paymentMethods: cashAndCard });

    const saved = await events(w.nord.id);
    expect(saved).toHaveLength(1);
    expect(saved[0].payload).toMatchObject({
      fields: ['payment_methods'],
      garageId: w.nord.id,
    });
    expect([...saved[0].audience].sort()).toEqual(
      [
        `garage:${w.nord.id}`,
        `public:garage:${w.nord.id}`,
        'public:search',
      ].sort(),
    );
  });

  it('names only the courtesy car, for the garage and its page, when only that changed', async () => {
    const w = await world();

    await patch(w, { courtesyCar: { paid: true, pricePerDayBani: 12000 } });

    const saved = await events(w.nord.id);
    expect(saved).toHaveLength(1);
    expect(saved[0].payload).toMatchObject({ fields: ['courtesy_car'] });
    expect([...saved[0].audience].sort()).toEqual(
      [`garage:${w.nord.id}`, `public:garage:${w.nord.id}`].sort(),
    );
  });

  it('names both in one event when both changed', async () => {
    const w = await world();

    await patch(w, {
      courtesyCar: { paid: true, pricePerDayBani: 12000 },
      paymentMethods: cashAndCard,
    });

    const saved = await events(w.nord.id);
    expect(saved).toHaveLength(1);
    expect(
      [...(saved[0].payload as { fields: string[] }).fields].sort(),
    ).toEqual(['courtesy_car', 'payment_methods']);
  });

  it('records nothing and emits nothing when the body changes nothing', async () => {
    const w = await world();
    const body = {
      courtesyCar: { paid: true, pricePerDayBani: 12000 },
      paymentMethods: cashAndCard,
    };
    await patch(w, body);
    await checkpoint();

    const res = await patch(w, body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(await history(w.nord.id)).toEqual([]);
    expect(await events(w.nord.id)).toEqual([]);
  });

  it.each([
    ['an empty body', {}],
    [
      'no payment method ticked',
      { paymentMethods: { card: false, cash: false, transfer: false } },
    ],
    [
      'a payment method left out',
      { paymentMethods: { card: true, cash: true } },
    ],
    [
      'a price on a free courtesy car',
      { courtesyCar: { paid: false, pricePerDayBani: 12000 } },
    ],
    ['a paid courtesy car without a price', { courtesyCar: { paid: true } }],
    [
      'a price that is not whole lei',
      { courtesyCar: { paid: true, pricePerDayBani: 12050 } },
    ],
    [
      'a price of 50 bani',
      { courtesyCar: { paid: true, pricePerDayBani: 50 } },
    ],
    [
      'a price of 200,100 bani',
      { courtesyCar: { paid: true, pricePerDayBani: 200_100 } },
    ],
  ])('answers 400 to %s and changes nothing', async (_, body) => {
    const w = await world();
    const before = await stored(w.nord.id);

    const res = await patch(w, body);

    expect(res.status).toBe(400);
    expect(await stored(w.nord.id)).toEqual(before);
    expect(await events(w.nord.id)).toEqual([]);
  });

  it('answers 400 validation_failed naming the courtesy car when the garage does not list one', async () => {
    const w = await world({ courtesyCar: false });

    const res = await patch(w, {
      courtesyCar: { paid: true, pricePerDayBani: 12000 },
      paymentMethods: cashAndCard,
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [expect.objectContaining({ field: 'courtesyCar' })],
    });
    expect(await stored(w.nord.id)).toMatchObject({
      courtesyCarPaid: false,
      paymentCash: false,
    });
    expect(await events(w.nord.id)).toEqual([]);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const w = await world();

    const res = await patch(w, { paymentMethods: cashAndCard }, null);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it("answers 403 forbidden to the garage's own receptionist and mechanic", async () => {
    const w = await world();

    for (const as of [w.receptionist, w.mechanic]) {
      const res = await patch(w, { paymentMethods: cashAndCard }, as);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    }
    expect((await stored(w.nord.id)).paymentCash).toBe(false);
  });

  it("answers 404 not_found to another garage's owner, a driver and an admin", async () => {
    const w = await world();

    for (const as of [w.other, w.driver, w.admin]) {
      const res = await patch(w, { paymentMethods: cashAndCard }, as);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
    expect((await stored(w.nord.id)).paymentCash).toBe(false);
    expect(await events(w.nord.id)).toEqual([]);
  });

  it('answers 404 for a garage that does not exist', async () => {
    const w = await world();

    const res = await http()
      .patch(`/garages/${randomUUID()}`)
      .set('Authorization', w.owner)
      .send({ paymentMethods: cashAndCard });

    expect(res.status).toBe(404);
  });
});
