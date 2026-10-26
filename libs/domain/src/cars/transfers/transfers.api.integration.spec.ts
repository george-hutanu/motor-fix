import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import {
  sendTransfer,
  tokenOf,
  transfersApp,
  transfersWorld,
  WEB_URL,
} from './transfers.testing';
import { serialDatabase } from '../../auth/serial-db.testing';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { databaseUrl } from '../../notifications/notifications.testing';

const BUYER = '+40722123456';
const world = transfersWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;
let restore: () => void;

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
});

afterEach(() => {
  jest.restoreAllMocks();
});

const http = () => request(app.getHttpServer());
const sale = (auth: string | null, carId: string) => {
  const call = http().get(`/cars/${carId}/sale`);
  return auth ? call.set('Authorization', auth) : call;
};
const send = (auth: string, carId: string, body: Record<string, unknown>) =>
  sendTransfer(app, auth, carId, body);
const cancel = (auth: string | null, carId: string, transferId: string) => {
  const call = http().post(`/cars/${carId}/transfers/${transferId}/cancel`);
  return auth ? call.set('Authorization', auth) : call;
};
const open = (token: string) => http().get(`/car-transfers/${token}`);

async function seller(name = 'andrei', language: 'ro' | 'en' = 'ro') {
  const who = await world.driver(name, { language, phone: '+40733000111' });
  const car = await world.car(who.id);
  return { ...who, car };
}

// @traces 415-FR-003
describe('GET /cars/:id/sale', () => {
  it('answers the repairs newest first, the sale open and no transfer', async () => {
    const { auth, car, id } = await seller();
    const older = await world.logged(car.id, { daysAgo: 90, what: 'Ulei' });
    const newer = await world.logged(car.id, { daysAgo: 10, what: 'Frâne' });
    const ours = await world.throughMotorFix(id, car.id);
    await world.logged(car.id, { deleted: true, what: 'Șters' });

    const res = await sale(auth, car.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      canStart: true,
      reason: null,
      repairs: [
        expect.objectContaining({ id: ours.id, source: 'motorfix' }),
        expect.objectContaining({
          garageName: 'Service Popescu',
          id: newer.id,
          source: 'logged',
          what: 'Frâne',
        }),
        expect.objectContaining({ id: older.id, what: 'Ulei' }),
      ],
      transfer: null,
    });
    expect(Object.keys(res.body.repairs[0]).sort()).toEqual([
      'doneOn',
      'garageName',
      'id',
      'source',
      'what',
    ]);
    expect(res.body.repairs[1].doneOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('orders repairs of the same day by when they were added, newest first', async () => {
    const { auth, car } = await seller();
    const first = await world.logged(car.id, { daysAgo: 5, what: 'Întâi' });
    const second = await world.logged(car.id, { daysAgo: 5, what: 'Apoi' });

    const res = await sale(auth, car.id);

    expect(res.body.repairs.map((r: { id: string }) => r.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('answers the sent transfer with its expiry and the phone, never the link', async () => {
    const { auth, car } = await seller();
    const sent = await send(auth, car.id, {
      buyerPhone: '0722 123 456',
      repairIds: [],
    });

    const res = await sale(auth, car.id);

    expect(res.body.transfer).toEqual({
      buyerPhone: BUYER,
      expiresAt: sent.body.transfer.expiresAt,
      id: sent.body.transfer.id,
    });
    expect(JSON.stringify(res.body)).not.toContain(tokenOf(sent.body.link));
  });

  it('answers no transfer once the sent one is past its time, before any sweep', async () => {
    const { auth, car } = await seller();
    const sent = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });
    await prisma.carTransfer.update({
      data: { expiresAt: new Date(Date.now() - 1000), sentAt: new Date(0) },
      where: { id: sent.body.transfer.id },
    });

    expect((await sale(auth, car.id)).body.transfer).toBeNull();
  });

  it.each(['sent', 'quoted', 'booked', 'in_work'] as const)(
    'answers canStart false with open_request while a request is %s',
    async (status) => {
      const { auth, car, id } = await seller();
      await world.request(id, { carId: car.id, status });

      const res = await sale(auth, car.id);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        canStart: false,
        reason: 'open_request',
      });
    },
  );

  it.each(['done', 'closed'] as const)(
    'lets the sale start when the request is %s',
    async (status) => {
      const { auth, car, id } = await seller();
      await world.request(id, { carId: car.id, status });

      expect((await sale(auth, car.id)).body).toMatchObject({
        canStart: true,
        reason: null,
      });
    },
  );

  it.each([
    ['another driver’s car', 'other'],
    ['a removed car', 'removed'],
    ['an unknown id', 'unknown'],
  ])('answers 404 not_found for %s', async (_, which) => {
    const ana = await seller('ana');
    const bogdan = await world.driver('bogdan');
    if (which === 'removed') {
      await prisma.car.update({
        data: { removedAt: new Date() },
        where: { id: ana.car.id },
      });
    }
    const auth = which === 'other' ? bogdan.auth : ana.auth;
    const id = which === 'unknown' ? randomUUID() : ana.car.id;

    const res = await sale(auth, id);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 401 without a session', async () => {
    const { car } = await seller();

    expect((await sale(null, car.id)).status).toBe(401);
  });

  it('answers 404 to a garage account, which holds no cars', async () => {
    const { car } = await seller();
    const id = await world.account('garaj', ['garage']);

    const res = await sale(world.bearer(id, 'garage'), car.id);

    expect(res.status).toBe(404);
  });
});

// @traces 415-FR-004
// @traces 415-FR-005
describe('POST /cars/:id/transfers', () => {
  it('answers 201 with the transfer, its expiry in 7 days and the link in the seller’s language', async () => {
    const { auth, car } = await seller('andrei', 'en');
    const before = Date.now();

    const res = await send(auth, car.id, {
      buyerPhone: '0722 123 456',
      repairIds: [],
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      link: expect.stringMatching(
        new RegExp(`^${WEB_URL}/en/transfer/[A-Za-z0-9_-]{43}$`),
      ),
      transfer: { expiresAt: expect.any(String), id: expect.any(String) },
      whatsapp: 'sent',
    });
    const expires = Date.parse(res.body.transfer.expiresAt);
    expect(expires - before).toBeGreaterThanOrEqual(7 * 86_400_000 - 5000);
    expect(expires - before).toBeLessThanOrEqual(7 * 86_400_000 + 5000);
  });

  it('gives each transfer a different token, stored only as its hash', async () => {
    const { auth, car } = await seller();
    const first = await send(auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });
    const second = await send(auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });

    const a = tokenOf(first.body.link);
    const b = tokenOf(second.body.link);
    expect(a).not.toBe(b);
    const rows = await prisma.carTransfer.findMany();
    expect(JSON.stringify(rows)).not.toContain(a);
    expect(JSON.stringify(rows)).not.toContain(b);
  });

  it.each([
    ['', 'invalid_phone'],
    ['12', 'invalid_phone'],
    ['nu e un număr', 'invalid_phone'],
  ])('refuses the phone %p with 400 %s', async (buyerPhone, code) => {
    const { auth, car } = await seller();

    const res = await send(auth, car.id, { buyerPhone, repairIds: [] });

    expect(res.status).toBe(400);
    if (buyerPhone !== '') expect(res.body.code).toBe(code);
    expect(await prisma.carTransfer.count()).toBe(0);
  });

  it('refuses the seller’s own phone, in any writing, with 400 own_phone', async () => {
    const { auth, car } = await seller();

    const res = await send(auth, car.id, {
      buyerPhone: '0733 000 111',
      repairIds: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('own_phone');
    expect(await prisma.carTransfer.count()).toBe(0);
  });

  it('sends when the seller’s account has no phone', async () => {
    const who = await world.driver('fara-telefon');
    const car = await world.car(who.id);

    const res = await send(who.auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });

    expect(res.status).toBe(201);
  });

  it('refuses 409 open_request while a request is open, storing nothing', async () => {
    const { auth, car, id } = await seller();
    await world.request(id, { carId: car.id, status: 'quoted' });

    const res = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('open_request');
    expect(await prisma.carTransfer.count()).toBe(0);
    expect(brevo.whatsapp()).toHaveLength(0);
  });

  it('answers 400 to repair ids that are not ids, and to more than 200', async () => {
    const { auth, car } = await seller();

    const bad = await send(auth, car.id, {
      buyerPhone: BUYER,
      repairIds: ['nu-e-id'],
    });
    const many = await send(auth, car.id, {
      buyerPhone: BUYER,
      repairIds: Array.from({ length: 201 }, () => randomUUID()),
    });

    expect(bad.status).toBe(400);
    expect(many.status).toBe(400);
  });

  it('answers 404 for another driver’s car', async () => {
    const ana = await seller('ana');
    const bogdan = await world.driver('bogdan');

    const res = await send(bogdan.auth, ana.car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 401 without a session', async () => {
    const { car } = await seller();

    const res = await http()
      .post(`/cars/${car.id}/transfers`)
      .send({ buyerPhone: BUYER, repairIds: [] });

    expect(res.status).toBe(401);
  });
});

// @traces 415-FR-006
describe('the WhatsApp message to the buyer', () => {
  it('goes to the buyer in the seller’s language with the car, the link and the days', async () => {
    const { auth, car } = await seller('andrei', 'ro');

    const res = await send(auth, car.id, {
      buyerPhone: '0040722123456',
      repairIds: [],
    });

    const [call] = brevo.whatsapp();
    expect(call.body).toMatchObject({
      contactNumbers: ['40722123456'],
      templateId: 41,
    });
    const params = (call.body as { params: string[] }).params;
    expect(params[0]).toContain('Cooper S');
    expect(params[1]).toBe(res.body.link);
    expect(params[2]).toBe('7');
  });

  it('uses the English template for a seller who reads English', async () => {
    const { auth, car } = await seller('andrei', 'en');

    await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });

    expect(brevo.whatsapp()[0].body).toMatchObject({ templateId: 42 });
  });
});

// @traces 415-FR-007
describe('POST /cars/:id/transfers/:transferId/cancel', () => {
  it('answers 204 and the link then answers 410 transfer_cancelled', async () => {
    const { auth, car } = await seller();
    const sent = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });

    const res = await cancel(auth, car.id, sent.body.transfer.id);

    expect(res.status).toBe(204);
    const link = await open(tokenOf(sent.body.link));
    expect(link.status).toBe(410);
    expect(link.body.code).toBe('transfer_cancelled');
    expect((await sale(auth, car.id)).body.transfer).toBeNull();
  });

  it('answers 409 not_sent to a transfer already cancelled', async () => {
    const { auth, car } = await seller();
    const sent = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });
    await cancel(auth, car.id, sent.body.transfer.id);

    const res = await cancel(auth, car.id, sent.body.transfer.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('not_sent');
  });

  it.each([
    ['another driver’s car', 'other'],
    ['a transfer of another car', 'car'],
    ['an unknown transfer', 'unknown'],
  ])('answers 404 not_found for %s', async (_, which) => {
    const ana = await seller('ana');
    const sent = await send(ana.auth, ana.car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });
    const otherCar = await world.car(ana.id);
    const bogdan = await world.driver('bogdan');
    const auth = which === 'other' ? bogdan.auth : ana.auth;
    const carId = which === 'car' ? otherCar.id : ana.car.id;
    const transferId =
      which === 'unknown' ? randomUUID() : sent.body.transfer.id;

    const res = await cancel(auth, carId, transferId);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(
      await prisma.carTransfer.findUnique({
        where: { id: sent.body.transfer.id },
      }),
    ).toMatchObject({ status: 'sent' });
  });

  it('answers 401 without a session', async () => {
    const { auth, car } = await seller();
    const sent = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });

    expect((await cancel(null, car.id, sent.body.transfer.id)).status).toBe(
      401,
    );
  });
});

// @traces 415-FR-008
describe('GET /car-transfers/:token', () => {
  async function sentLink() {
    const { auth, car } = await seller();
    const sent = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });
    return {
      auth,
      car,
      id: sent.body.transfer.id,
      token: tokenOf(sent.body.link),
    };
  }

  it('answers 200 with the status alone, without a session', async () => {
    const { token } = await sentLink();

    const res = await open(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'sent' });
  });

  it.each([
    ['an unknown token', 'A'.repeat(43)],
    ['a short token', 'abc'],
    ['a token with other characters', `${'a'.repeat(42)}$`],
    ['a very long token', 'a'.repeat(500)],
  ])('answers the same 404 not_found to %s', async (_, token) => {
    await sentLink();

    const res = await open(encodeURIComponent(token));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 410 transfer_expired to a sent transfer past its time', async () => {
    const { id, token } = await sentLink();
    await prisma.carTransfer.update({
      data: { expiresAt: new Date(Date.now() - 1000), sentAt: new Date(0) },
      where: { id },
    });

    const res = await open(token);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('transfer_expired');
  });

  it.each([
    ['expired', 'transfer_expired'],
    ['accepted', 'transfer_accepted'],
    ['cancelled', 'transfer_cancelled'],
  ] as const)('answers 410 %s with %s', async (status, code) => {
    const { id, token } = await sentLink();
    await prisma.carTransfer.update({ data: { status }, where: { id } });

    const res = await open(token);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe(code);
  });

  it('never answers the seller, the car or the phone', async () => {
    const { token } = await sentLink();

    const text = JSON.stringify((await open(token)).body);

    expect(text).not.toMatch(/andrei|Cooper|B123ABC|722123456|733000111/i);
  });
});

// @traces 415-FR-022
describe('the cars list', () => {
  it('carries the sent transfer per car while within its time, null otherwise', async () => {
    const { auth, car, id } = await seller();
    const other = await world.car(id);
    const sent = await send(auth, car.id, { buyerPhone: BUYER, repairIds: [] });

    const res = await http().get('/cars').set('Authorization', auth);

    const byId = Object.fromEntries(
      res.body.items.map((c: { id: string; transfer: unknown }) => [
        c.id,
        c.transfer,
      ]),
    );
    expect(byId[car.id]).toEqual({
      expiresAt: sent.body.transfer.expiresAt,
      id: sent.body.transfer.id,
    });
    expect(byId[other.id]).toBeNull();

    await prisma.carTransfer.update({
      data: { expiresAt: new Date(Date.now() - 1000), sentAt: new Date(0) },
      where: { id: sent.body.transfer.id },
    });
    const later = await http().get('/cars').set('Authorization', auth);
    expect(
      later.body.items.find((c: { id: string }) => c.id === car.id).transfer,
    ).toBeNull();
  });
});
