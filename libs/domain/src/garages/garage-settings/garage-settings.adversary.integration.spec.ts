import { randomUUID } from 'node:crypto';

import { HttpException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { writeGaragePayments } from './write-garage-payments';
import { AuditService } from '../../audit/audit.service';
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
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { writeGarageBrands } from '../garage-brands/write-garage-brands';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
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
      StorageModule.register(UNUSED_STORAGE),
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
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  since = at;
  const [{ id }] = await prisma.$queryRaw<
    { id: bigint }[]
  >`SELECT COALESCE(MAX(id), 0)::bigint AS id FROM outbox_event`;
  lastEvent = id;
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

async function brand(name: string) {
  const key = `${name.toLowerCase()}-${randomUUID()}`;
  return prisma.brand.create({
    data: { active: true, key, name, slug: key },
  });
}

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
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: nord.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: nord.id, role: 'receptionist' },
  });
  const radu = await account('radu', ['garage']);
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: dinamo.id, role: 'owner' },
  });
  return {
    bmw: await brand('BMW'),
    dacia: await brand('Dacia'),
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    ownerId: mihai,
    receptionist: bearer(ioana, 'receptionist'),
    tesla: await brand('Tesla'),
  };
}
type World = Awaited<ReturnType<typeof world>>;

const patch = (w: World, body: unknown, as: string | null = w.owner) => {
  const req = http()
    .patch(`/garages/${w.nord.id}`)
    .send(body as object);
  return as ? req.set('Authorization', as) : req;
};
const put = (w: World, body: unknown, as: string | null = w.owner) => {
  const req = http()
    .put(`/garages/${w.nord.id}/brands`)
    .send(body as object);
  return as ? req.set('Authorization', as) : req;
};

const stored = (w: World) =>
  prisma.garage.findUniqueOrThrow({
    select: {
      courtesyCarPaid: true,
      courtesyCarPricePerDayBani: true,
      paymentCard: true,
      paymentCash: true,
      paymentTransfer: true,
    },
    where: { id: w.nord.id },
  });
const history = (w: World, subjectType: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { at: { gte: since }, garageId: w.nord.id, subjectType },
  });
const events = (w: World) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: {
      id: { gt: lastEvent },
      kind: 'garage.updated',
      subjectId: w.nord.id,
    },
  });
const fieldsOf = (e: { payload: unknown }) =>
  (e.payload as { fields: string[] }).fields;
const fuelsOf = (w: World, brandId: string) =>
  prisma.garageBrand.findUniqueOrThrow({
    select: { diesel: true, electric: true, hybrid: true, petrol: true },
    where: { garageId_brandId: { brandId, garageId: w.nord.id } },
  });

const all = { diesel: true, electric: true, hybrid: true, petrol: true };
const none = { diesel: false, electric: false, hybrid: false, petrol: false };
const cash = { card: false, cash: true, transfer: false };

describe('PATCH /garages/:garageId under hostile input', () => {
  it.each([
    [
      'a payment flag as a string',
      { paymentMethods: { card: 'true', cash: true, transfer: false } },
    ],
    [
      'a payment flag as 1',
      { paymentMethods: { card: 1, cash: true, transfer: false } },
    ],
    [
      'a payment flag as null',
      { paymentMethods: { card: null, cash: true, transfer: false } },
    ],
    ['an extra payment key', { paymentMethods: { ...cash, crypto: true } }],
    ['paymentMethods as null', { paymentMethods: null }],
    ['paymentMethods as an array', { paymentMethods: [cash] }],
    ['paymentMethods as a string', { paymentMethods: 'cash' }],
    ['courtesyCar as null', { courtesyCar: null }],
    ['courtesyCar as a string', { courtesyCar: 'free' }],
    ['courtesyCar paid as a string', { courtesyCar: { paid: 'false' } }],
    ['courtesyCar with no paid', { courtesyCar: {} }],
    [
      'courtesyCar with another key',
      { courtesyCar: { note: 'x', paid: false } },
    ],
    [
      'a paid price as a string',
      { courtesyCar: { paid: true, pricePerDayBani: '12000' } },
    ],
    [
      'a paid price as a fraction',
      { courtesyCar: { paid: true, pricePerDayBani: 12000.5 } },
    ],
    [
      'a paid price of null',
      { courtesyCar: { paid: true, pricePerDayBani: null } },
    ],
    [
      'a paid price of zero',
      { courtesyCar: { paid: true, pricePerDayBani: 0 } },
    ],
    [
      'a negative price',
      { courtesyCar: { paid: true, pricePerDayBani: -100 } },
    ],
    [
      'a free price of zero',
      { courtesyCar: { paid: false, pricePerDayBani: 0 } },
    ],
    [
      'a free price of null',
      { courtesyCar: { paid: false, pricePerDayBani: null } },
    ],
    ['an unknown top-level key', { paymentMethods: cash, status: 'approved' }],
    ['a body that is an array', [{ paymentMethods: cash }]],
  ])('answers 400 to %s and writes nothing', async (_label, body) => {
    const w = await world();
    const before = await stored(w);

    const res = await patch(w, body);

    expect(res.status).toBe(400);
    expect(await stored(w)).toEqual(before);
    expect(await events(w)).toEqual([]);
    expect(await history(w, 'garage')).toEqual([]);
  });

  it('answers 400 to a garage id that is not a uuid', async () => {
    const w = await world();
    const res = await http()
      .patch('/garages/not-a-uuid')
      .set('Authorization', w.owner)
      .send({ paymentMethods: cash });
    expect(res.status).toBe(400);
  });

  it('refuses a body that is not JSON and writes nothing', async () => {
    const w = await world();
    const res = await http()
      .patch(`/garages/${w.nord.id}`)
      .set('Authorization', w.owner)
      .type('form')
      .send('paymentMethods=cash');
    expect([400, 415]).toContain(res.status);
    expect((await stored(w)).paymentCash).toBe(false);
  });

  it('refuses malformed JSON with 400', async () => {
    const w = await world();
    const res = await http()
      .patch(`/garages/${w.nord.id}`)
      .set('Authorization', w.owner)
      .set('Content-Type', 'application/json')
      .send('{"paymentMethods": ');
    expect(res.status).toBe(400);
  });

  it.each([
    [100, 100],
    [200_000, 200_000],
  ])(
    'accepts a price of %s bani and answers it back',
    async (price, answered) => {
      const w = await world();
      const res = await patch(w, {
        courtesyCar: { paid: true, pricePerDayBani: price },
      });
      expect(res.status).toBe(200);
      expect(res.body.courtesyCar).toEqual({
        paid: true,
        pricePerDayBani: answered,
      });
      expect((await stored(w)).courtesyCarPricePerDayBani).toBe(answered);
    },
  );

  it.each([99, 101, 199_999, 200_001, 200_100])(
    'refuses a price of %s bani',
    async (price) => {
      const w = await world();
      const res = await patch(w, {
        courtesyCar: { paid: true, pricePerDayBani: price },
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('courtesyCar.pricePerDayBani');
    },
  );

  it('names paymentMethods in the errors when none is ticked', async () => {
    const w = await world();
    const res = await patch(w, {
      paymentMethods: { card: false, cash: false, transfer: false },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('paymentMethods');
  });

  it('refuses a courtesy car for a garage that lists none even when it is free', async () => {
    const w = await world({ courtesyCar: false });
    const res = await patch(w, { courtesyCar: { paid: false } });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ field: 'courtesyCar' }),
    ]);
  });

  it('refuses the whole body when the payment part is good and the courtesy part is bad', async () => {
    const w = await world();
    const res = await patch(w, {
      courtesyCar: { paid: true },
      paymentMethods: cash,
    });
    expect(res.status).toBe(400);
    expect((await stored(w)).paymentCash).toBe(false);
  });

  it('answers the same stored values and records nothing on a second identical call', async () => {
    const w = await world();
    const body = {
      courtesyCar: { paid: true, pricePerDayBani: 15_000 },
      paymentMethods: { card: true, cash: false, transfer: true },
    };
    const first = await patch(w, body);
    const entries = (await history(w, 'garage')).length;
    const saved = (await events(w)).length;

    const second = await patch(w, body);

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(first.body).toEqual(body);
    expect((await history(w, 'garage')).length).toBe(entries);
    expect((await events(w)).length).toBe(saved);
  });

  it('clears the stored price when the courtesy car goes back to free', async () => {
    const w = await world();
    await patch(w, { courtesyCar: { paid: true, pricePerDayBani: 12_000 } });

    const res = await patch(w, { courtesyCar: { paid: false } });

    expect(res.body.courtesyCar).toEqual({ paid: false });
    expect(await stored(w)).toMatchObject({
      courtesyCarPaid: false,
      courtesyCarPricePerDayBani: null,
    });
    const entries = await history(w, 'garage');
    expect(entries.map((e) => [e.field, e.oldValue, e.newValue])).toEqual([
      ['courtesy_car_paid', false, true],
      ['courtesy_car_price_per_day_bani', null, 12_000],
      ['courtesy_car_paid', true, false],
      ['courtesy_car_price_per_day_bani', 12_000, null],
    ]);
  });

  it('leaves the payment flags alone when only the courtesy car is sent', async () => {
    const w = await world();
    await patch(w, {
      paymentMethods: { card: true, cash: true, transfer: true },
    });
    const res = await patch(w, {
      courtesyCar: { paid: true, pricePerDayBani: 12_000 },
    });

    expect(res.body.paymentMethods).toEqual({
      card: true,
      cash: true,
      transfer: true,
    });
    const last = (await events(w)).at(-1);
    expect(fieldsOf(last as never)).toEqual(['courtesy_car']);
  });

  it('records a price change at the same paid state as one price entry and a courtesy_car event', async () => {
    const w = await world();
    await patch(w, { courtesyCar: { paid: true, pricePerDayBani: 12_000 } });
    const before = (await history(w, 'garage')).length;

    await patch(w, { courtesyCar: { paid: true, pricePerDayBani: 13_000 } });

    const added = (await history(w, 'garage')).slice(before);
    expect(added.map((e) => [e.field, e.oldValue, e.newValue])).toEqual([
      ['courtesy_car_price_per_day_bani', 12_000, 13_000],
    ]);
  });

  it('keeps the last write consistent with its history under ten concurrent patches', async () => {
    const w = await world();
    const bodies = Array.from({ length: 10 }, (_, i) => ({
      paymentMethods: { card: i % 2 === 0, cash: i % 3 === 0, transfer: true },
    }));

    const results = await Promise.all(bodies.map((b) => patch(w, b)));

    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const row = await stored(w);
    const entries = await history(w, 'garage');
    for (const field of ['payment_card', 'payment_cash', 'payment_transfer']) {
      const mine = entries.filter((e) => e.field === field);
      const last = mine.at(-1);
      const column = {
        payment_card: row.paymentCard,
        payment_cash: row.paymentCash,
        payment_transfer: row.paymentTransfer,
      }[field];
      if (last) expect(last.newValue).toBe(column);
      for (let i = 1; i < mine.length; i++) {
        expect(mine[i].oldValue).toBe(mine[i - 1].newValue);
      }
    }
  });

  it('answers 403 to the receptionist, 404 to another owner, and 401 with a garbage token', async () => {
    const w = await world();
    expect(
      (await patch(w, { paymentMethods: cash }, w.receptionist)).status,
    ).toBe(403);
    expect((await patch(w, { paymentMethods: cash }, w.other)).status).toBe(
      404,
    );
    expect(
      (await patch(w, { paymentMethods: cash }, 'Bearer nonsense')).status,
    ).toBe(401);
    expect((await patch(w, { paymentMethods: cash }, null)).status).toBe(401);
  });

  it("judges a receptionist's empty body before who sent it, as every route does", async () => {
    const w = await world();
    const before = await stored(w);
    const res = await patch(w, {}, w.receptionist);
    expect(res.status).toBe(400);
    expect(await stored(w)).toEqual(before);
  });
});

describe('the public garage read carrying the new values', () => {
  const read = (w: World) => http().get(`/garages/${w.nord.slug}`);

  it('shows all payment flags false and no courtesy car for a garage that lists none', async () => {
    const w = await world({ courtesyCar: false });
    const res = await read(w);
    expect(res.status).toBe(200);
    expect(res.body.paymentMethods).toEqual({
      card: false,
      cash: false,
      transfer: false,
    });
    expect(res.body).not.toHaveProperty('courtesyCar');
  });

  it('leaves the courtesy car out when the facility is not listed even if stale paid values are stored', async () => {
    const w = await world({ courtesyCar: false });
    await prisma.garage.update({
      data: { courtesyCarPaid: true, courtesyCarPricePerDayBani: 12_000 },
      where: { id: w.nord.id },
    });
    const res = await read(w);
    expect(res.body).not.toHaveProperty('courtesyCar');
  });

  it('shows a free courtesy car without a price key', async () => {
    const w = await world();
    const res = await read(w);
    expect(res.body.courtesyCar).toEqual({ paid: false });
    expect(res.body.courtesyCar).not.toHaveProperty('pricePerDayBani');
  });

  it('shows the stored price of a paid courtesy car in bani', async () => {
    const w = await world();
    await patch(w, { courtesyCar: { paid: true, pricePerDayBani: 12_000 } });
    const res = await read(w);
    expect(res.body.courtesyCar).toEqual({
      paid: true,
      pricePerDayBani: 12_000,
    });
  });

  it('lists each taken brand with its fuels in the fixed order and refused brands without fuels', async () => {
    const w = await world();
    await put(w, {
      brands: [
        {
          brandId: w.dacia.id,
          fuels: ['electric', 'petrol'],
          stance: 'works_on',
        },
        { brandId: w.bmw.id, fuels: [], stance: 'works_on' },
        { brandId: w.tesla.id, stance: 'does_not_take' },
      ],
    });

    const res = await read(w);

    const byName = Object.fromEntries(
      res.body.worksOn.map((b: { name: string; fuels: string[] }) => [
        b.name,
        b.fuels,
      ]),
    );
    expect(byName).toEqual({ BMW: [], Dacia: ['petrol', 'electric'] });
    expect(res.body.doesNotTake).toHaveLength(1);
    expect(res.body.doesNotTake[0]).not.toHaveProperty('fuels');
  });
});

describe('PUT /garages/:garageId/brands with fuels under hostile input', () => {
  it.each([
    ['a duplicate kind', ['petrol', 'petrol']],
    ['an unknown kind', ['lpg']],
    ['a capitalised kind', ['Petrol']],
    ['a string', 'petrol'],
    ['an object', { petrol: true }],
    ['null', null],
    ['a number inside', [1]],
    ['a nested list', [['petrol']]],
  ])(
    'answers 400 to fuels given as %s and writes nothing',
    async (_label, fuels) => {
      const w = await world();
      const res = await put(w, {
        brands: [{ brandId: w.dacia.id, fuels, stance: 'works_on' }],
      });
      expect(res.status).toBe(400);
      expect(
        await prisma.garageBrand.count({ where: { garageId: w.nord.id } }),
      ).toBe(0);
      expect(await events(w)).toEqual([]);
    },
  );

  it('refuses an empty fuels list on a refused brand and keeps the earlier brands', async () => {
    const w = await world();
    await put(w, { brands: [{ brandId: w.dacia.id, stance: 'works_on' }] });
    const before = (await events(w)).length;

    const res = await put(w, {
      brands: [
        { brandId: w.dacia.id, fuels: ['petrol'], stance: 'works_on' },
        { brandId: w.tesla.id, fuels: [], stance: 'does_not_take' },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ field: 'brands[1].fuels' }),
    ]);
    expect(await fuelsOf(w, w.dacia.id)).toEqual(all);
    expect((await events(w)).length).toBe(before);
  });

  it('answers 403 to a receptionist and 404 to another owner sending fuels', async () => {
    const w = await world();
    const body = {
      brands: [{ brandId: w.dacia.id, fuels: [], stance: 'works_on' }],
    };
    expect((await put(w, body, w.receptionist)).status).toBe(403);
    expect((await put(w, body, w.other)).status).toBe(404);
    expect(
      await prisma.garageBrand.count({ where: { garageId: w.nord.id } }),
    ).toBe(0);
  });

  it('starts a brand taken again at all four after a refusal that followed unticked fuels', async () => {
    const w = await world();
    await put(w, {
      brands: [{ brandId: w.dacia.id, fuels: ['petrol'], stance: 'works_on' }],
    });
    await put(w, {
      brands: [{ brandId: w.dacia.id, stance: 'does_not_take' }],
    });
    expect(await fuelsOf(w, w.dacia.id)).toEqual(none);

    await put(w, { brands: [{ brandId: w.dacia.id, stance: 'works_on' }] });

    expect(await fuelsOf(w, w.dacia.id)).toEqual(all);
  });

  it('records nothing for the same fuels sent again in another order', async () => {
    const w = await world();
    await put(w, {
      brands: [
        {
          brandId: w.dacia.id,
          fuels: ['petrol', 'electric'],
          stance: 'works_on',
        },
      ],
    });
    const entries = (await history(w, 'garage_brand')).length;
    const saved = (await events(w)).length;

    const res = await put(w, {
      brands: [
        {
          brandId: w.dacia.id,
          fuels: ['electric', 'petrol'],
          stance: 'works_on',
        },
      ],
    });

    expect(res.status).toBe(200);
    expect((await history(w, 'garage_brand')).length).toBe(entries);
    expect((await events(w)).length).toBe(saved);
  });

  it('records one entry per changed fuel, with old and new values, and brand_fuels only', async () => {
    const w = await world();
    await put(w, { brands: [{ brandId: w.dacia.id, stance: 'works_on' }] });
    const before = (await history(w, 'garage_brand')).length;
    const eventsBefore = (await events(w)).length;

    await put(w, {
      brands: [
        {
          brandId: w.dacia.id,
          fuels: ['petrol', 'diesel', 'hybrid'],
          stance: 'works_on',
        },
      ],
    });

    const added = (await history(w, 'garage_brand')).slice(before);
    expect(added.map((e) => [e.field, e.oldValue, e.newValue])).toEqual([
      ['electric', true, false],
    ]);
    const newEvents = (await events(w)).slice(eventsBefore);
    expect(newEvents.map(fieldsOf)).toEqual([['brand_fuels']]);
  });

  it('names both brands and brand_fuels when a stance and a fuel change together', async () => {
    const w = await world();
    await put(w, { brands: [{ brandId: w.dacia.id, stance: 'works_on' }] });
    const eventsBefore = (await events(w)).length;

    await put(w, {
      brands: [
        { brandId: w.dacia.id, fuels: ['diesel'], stance: 'works_on' },
        { brandId: w.bmw.id, stance: 'works_on' },
      ],
    });

    const [event] = (await events(w)).slice(eventsBefore);
    expect([...fieldsOf(event)].sort()).toEqual(['brand_fuels', 'brands']);
  });

  it('leaves a brand left out of the body switched off with all four fuels cleared', async () => {
    const w = await world();
    await put(w, {
      brands: [
        { brandId: w.dacia.id, stance: 'works_on' },
        { brandId: w.bmw.id, stance: 'works_on' },
      ],
    });
    await put(w, { brands: [{ brandId: w.dacia.id, stance: 'works_on' }] });
    expect(
      await prisma.garageBrand.count({
        where: { brandId: w.bmw.id, garageId: w.nord.id, petrol: true },
      }),
    ).toBe(0);
  });

  it('survives two concurrent writes leaving rows that satisfy the fuel check', async () => {
    const w = await world();
    const a = put(w, {
      brands: [{ brandId: w.dacia.id, fuels: [], stance: 'works_on' }],
    });
    const b = put(w, {
      brands: [{ brandId: w.dacia.id, stance: 'does_not_take' }],
    });
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const row = await prisma.garageBrand.findFirstOrThrow({
      where: { garageId: w.nord.id },
    });
    if (row.stance === 'does_not_take') {
      expect([row.petrol, row.diesel, row.hybrid, row.electric]).toEqual([
        false,
        false,
        false,
        false,
      ]);
    }
  });
});

describe('writing payments from a step 5 section', () => {
  const write = (w: World, section: Record<string, unknown>) =>
    prisma.$transaction((tx) => writeGaragePayments(tx, w.nord.id, section));
  const refused = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    if (!(error instanceof HttpException)) throw new Error('not refused');
    return error.getStatus();
  };

  it.each([
    ['payments missing', { facilities: [] }],
    ['payments empty', { payments: [] }],
    ['payments with a duplicate', { payments: ['cash', 'cash'] }],
    ['payments with an unknown key', { payments: ['crypto'] }],
    [
      'a listed paid courtesy car at 150 bani',
      {
        courtesyCar: { paid: true, pricePerDayBani: 150 },
        facilities: ['courtesy_car'],
        payments: ['cash'],
      },
    ],
    [
      'a listed paid courtesy car with no price',
      {
        courtesyCar: { paid: true },
        facilities: ['courtesy_car'],
        payments: ['cash'],
      },
    ],
    [
      'a listed paid courtesy car over the cap',
      {
        courtesyCar: { paid: true, pricePerDayBani: 200_100 },
        facilities: ['courtesy_car'],
        payments: ['cash'],
      },
    ],
  ])(
    'refuses %s with 400 and keeps what was stored',
    async (_label, section) => {
      const w = await world();
      await write(w, { payments: ['transfer'] });
      const before = await stored(w);

      expect(await refused(write(w, section))).toBe(400);
      expect(await stored(w)).toEqual(before);
    },
  );

  it('writes a free courtesy car as not paid with no price even when a price rides along', async () => {
    const w = await world();
    await write(w, {
      courtesyCar: { paid: false, pricePerDayBani: 12_000 },
      facilities: ['courtesy_car'],
      payments: ['card'],
    });
    expect(await stored(w)).toEqual({
      courtesyCarPaid: false,
      courtesyCarPricePerDayBani: null,
      paymentCard: true,
      paymentCash: false,
      paymentTransfer: false,
    });
  });

  it('writes a paid price at the cap and ignores a paid courtesy car whose facility is not listed', async () => {
    const w = await world();
    await write(w, {
      courtesyCar: { paid: true, pricePerDayBani: 200_000 },
      facilities: ['courtesy_car'],
      payments: ['cash'],
    });
    expect((await stored(w)).courtesyCarPricePerDayBani).toBe(200_000);

    await write(w, {
      courtesyCar: { paid: true, pricePerDayBani: 200_000 },
      facilities: ['waiting_area'],
      payments: ['cash'],
    });
    expect(await stored(w)).toMatchObject({
      courtesyCarPaid: false,
      courtesyCarPricePerDayBani: null,
    });
  });

  it('refuses a section that is not an object', async () => {
    const w = await world();
    expect(await refused(write(w, null as never))).toBe(400);
    expect(await refused(write(w, [] as never))).toBe(400);
  });
});

describe('the garage table refusing impossible courtesy car rows', () => {
  const setRaw = (w: World, paid: boolean, price: number | null) =>
    prisma.garage.update({
      data: { courtesyCarPaid: paid, courtesyCarPricePerDayBani: price },
      where: { id: w.nord.id },
    });

  it.each([
    ['a price without paid', false, 12_000],
    ['paid without a price', true, null],
    ['a price of 99 bani', true, 99],
    ['a price of 150 bani', true, 150],
    ['a price of 200,100 bani', true, 200_100],
    ['a price of zero', true, 0],
    ['a negative price', true, -100],
  ])('refuses %s', async (_label, paid, price) => {
    const w = await world();
    await expect(setRaw(w, paid, price)).rejects.toThrow();
    expect(await stored(w)).toMatchObject({
      courtesyCarPaid: false,
      courtesyCarPricePerDayBani: null,
    });
  });

  it('accepts the bounds 100 and 200,000', async () => {
    const w = await world();
    await setRaw(w, true, 100);
    await setRaw(w, true, 200_000);
    expect((await stored(w)).courtesyCarPricePerDayBani).toBe(200_000);
  });
});

describe('writing brands from a step 2 section', () => {
  const write = (w: World, section: Record<string, unknown>) =>
    prisma.$transaction((tx) =>
      writeGarageBrands(tx, w.nord.id, section, {
        actorId: w.ownerId,
        audit: new AuditService(),
        jobs: [],
      }),
    );
  const refused = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    if (!(error instanceof HttpException)) throw new Error('not refused');
    return error.getStatus();
  };

  it('refuses fuels on a refused brand and leaves earlier rows in place', async () => {
    const w = await world();
    await write(w, {
      brands: [{ brandId: w.dacia.id, name: 'Dacia', stance: 'works_on' }],
    });

    const status = await refused(
      write(w, {
        brands: [
          {
            brandId: w.dacia.id,
            fuels: ['petrol'],
            name: 'Dacia',
            stance: 'works_on',
          },
          {
            brandId: w.tesla.id,
            fuels: [],
            name: 'Tesla',
            stance: 'does_not_take',
          },
        ],
      }),
    );

    expect(status).toBe(400);
    expect(await fuelsOf(w, w.dacia.id)).toEqual(all);
    expect(
      await prisma.garageBrand.count({ where: { garageId: w.nord.id } }),
    ).toBe(1);
  });

  it('writes an empty fuels list as all four off and an absent one as all four on', async () => {
    const w = await world();
    await write(w, {
      brands: [
        { brandId: w.dacia.id, fuels: [], name: 'Dacia', stance: 'works_on' },
        { brandId: w.bmw.id, name: 'BMW', stance: 'works_on' },
      ],
    });
    expect(await fuelsOf(w, w.dacia.id)).toEqual(none);
    expect(await fuelsOf(w, w.bmw.id)).toEqual(all);
  });

  it('writes an upper-case brand id as the same brand', async () => {
    const w = await world();
    await write(w, {
      brands: [
        {
          brandId: w.dacia.id.toUpperCase(),
          name: 'Dacia',
          stance: 'works_on',
        },
      ],
    });
    expect(await fuelsOf(w, w.dacia.id)).toEqual(all);
  });

  it('refuses the same brand listed twice in different case', async () => {
    const w = await world();
    const status = await refused(
      write(w, {
        brands: [
          { brandId: w.dacia.id, name: 'Dacia', stance: 'works_on' },
          {
            brandId: w.dacia.id.toUpperCase(),
            name: 'Dacia',
            stance: 'does_not_take',
          },
        ],
      }),
    );
    expect(status).toBe(400);
  });

  it('refuses a section with no brands key and one that is empty of keys', async () => {
    const w = await world();
    expect(await refused(write(w, {}))).toBe(400);
    expect(await refused(write(w, { brandNote: 'x' }))).toBe(400);
  });

  it('clears the old texts when the section carries none', async () => {
    const w = await world();
    await write(w, { brandNote: 'note', brands: [], refusalPhrase: 'phrase' });
    await write(w, { brands: [] });
    const row = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect([row.brandNote, row.refusalPhrase]).toEqual([null, null]);
  });
});
