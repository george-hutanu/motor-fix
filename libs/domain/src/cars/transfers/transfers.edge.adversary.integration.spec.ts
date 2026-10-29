import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import {
  sendTransfer,
  tokenOf,
  transfersApp,
  transfersWorld,
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

const http = () => request(app.getHttpServer());

async function seller(name = 'andrei') {
  const who = await world.driver(name, { phone: '+40733000111' });
  const car = await world.car(who.id);
  return { ...who, car };
}

// @traces 415-FR-004
describe('POST /cars/:id/transfers on hostile bodies', () => {
  it.each([
    ['a number for the phone', { buyerPhone: 722123456, repairIds: [] }],
    ['a null phone', { buyerPhone: null, repairIds: [] }],
    ['no phone', { repairIds: [] }],
    ['no repair ids', { buyerPhone: BUYER }],
    ['null repair ids', { buyerPhone: BUYER, repairIds: null }],
    ['a phone of 33 characters', { buyerPhone: '0'.repeat(33), repairIds: [] }],
    ['an extra field', { admin: true, buyerPhone: BUYER, repairIds: [] }],
    ['a repair id that is a number', { buyerPhone: BUYER, repairIds: [1] }],
    ['an array for the phone', { buyerPhone: [BUYER], repairIds: [] }],
  ])('answers 400 to %s, storing nothing', async (_, body) => {
    const { auth, car } = await seller();

    const res = await sendTransfer(app, auth, car.id, body);

    expect(res.status).toBe(400);
    expect(await prisma.carTransfer.count()).toBe(0);
    expect(brevo.calls).toHaveLength(0);
  });

  it('accepts exactly 200 repair ids as far as validation goes and refuses 201', async () => {
    const { auth, car } = await seller();
    const ids = (n: number) => Array.from({ length: n }, () => randomUUID());

    const at = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: ids(200),
    });
    const past = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: ids(201),
    });

    expect(at.body.code).toBe('repair_not_tickable');
    expect(past.status).toBe(400);
  });

  it('refuses a body that is not JSON', async () => {
    const { auth, car } = await seller();

    const res = await http()
      .post(`/cars/${car.id}/transfers`)
      .set('Authorization', auth)
      .set('Content-Type', 'text/plain')
      .send(`buyerPhone=${BUYER}`);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await prisma.carTransfer.count()).toBe(0);
  });

  it.each([
    ['Arabic-Indic digits', '٠٧٢٢١٢٣٤٥٦'],
    ['fullwidth plus and digits', '＋４０７２２１２３４５６'],
    ['a NUL inside', '0722\u0000123456'],
  ])('answers 400 invalid_phone for %s', async (_, buyerPhone) => {
    const { auth, car } = await seller();

    const res = await sendTransfer(app, auth, car.id, {
      buyerPhone,
      repairIds: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_phone');
    expect(await prisma.carTransfer.count()).toBe(0);
  });

  it('answers 404 for a removed car and writes no transfer', async () => {
    const { auth, car } = await seller();
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: car.id },
    });

    const res = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });

    expect(res.status).toBe(404);
    expect(await prisma.carTransfer.count()).toBe(0);
  });

  it('refuses a tick on a logged repair of the seller’s other car', async () => {
    const { auth, car, id } = await seller();
    const other = await world.car(id);
    const repair = await world.logged(other.id);

    const res = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [repair.id],
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('repair_not_tickable');
  });

  it('answers 400 to ids that are not UUIDs on every car route', async () => {
    const { auth, car } = await seller();

    const sale = await http().get('/cars/nope/sale').set('Authorization', auth);
    const send = await sendTransfer(app, auth, 'nope', {
      buyerPhone: BUYER,
      repairIds: [],
    });
    const cancel = await http()
      .post(`/cars/${car.id}/transfers/nope/cancel`)
      .set('Authorization', auth);

    expect([sale.status, send.status, cancel.status]).toEqual([400, 400, 400]);
  });
});

// @traces 415-FR-009
describe('sends that race', () => {
  it('leaves exactly one sent transfer after two simultaneous sends', async () => {
    const { auth, car } = await seller();

    const both = await Promise.all([
      sendTransfer(app, auth, car.id, { buyerPhone: BUYER, repairIds: [] }),
      sendTransfer(app, auth, car.id, { buyerPhone: BUYER, repairIds: [] }),
    ]);

    expect(both.map((r) => r.status)).toEqual([201, 201]);
    const rows = await prisma.carTransfer.findMany({
      where: { carId: car.id },
    });
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'cancelled')).toHaveLength(1);
  });

  it('leaves the links answering one 200 and one 410 after a double send', async () => {
    const { auth, car } = await seller();
    const first = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });
    const second = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });

    const a = await http().get(`/car-transfers/${tokenOf(first.body.link)}`);
    const b = await http().get(`/car-transfers/${tokenOf(second.body.link)}`);

    expect([a.status, b.status]).toEqual([410, 200]);
    expect(a.body.code).toBe('transfer_cancelled');
  });
});

// @traces 415-FR-007
describe('cancelling in unusual states', () => {
  it('answers 409 not_sent to a transfer the expiry already swept', async () => {
    const { auth, car } = await seller();
    const sent = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });
    await prisma.carTransfer.update({
      data: { status: 'expired' },
      where: { id: sent.body.transfer.id },
    });

    const res = await http()
      .post(`/cars/${car.id}/transfers/${sent.body.transfer.id}/cancel`)
      .set('Authorization', auth);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('not_sent');
  });

  it('answers 404 to the cancel of a removed car’s transfer', async () => {
    const { auth, car } = await seller();
    const sent = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: car.id },
    });

    const res = await http()
      .post(`/cars/${car.id}/transfers/${sent.body.transfer.id}/cancel`)
      .set('Authorization', auth);

    expect(res.status).toBe(404);
  });
});

// @traces 415-FR-008
describe('GET /car-transfers/:token on odd tokens', () => {
  it('answers 404 to the token in another letter case', async () => {
    const { auth, car } = await seller();
    const sent = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });
    const token = tokenOf(sent.body.link);
    const swapped = [...token]
      .map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
      .join('');

    const res = await http().get(`/car-transfers/${swapped}`);

    expect(res.status).toBe(404);
  });

  it('answers 404 to the token with a trailing character', async () => {
    const { auth, car } = await seller();
    const sent = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });

    const res = await http().get(`/car-transfers/${tokenOf(sent.body.link)}A`);

    expect(res.status).toBe(404);
  });

  it('answers 410 transfer_cancelled for a sent transfer whose car was removed', async () => {
    const { auth, car } = await seller();
    const sent = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: car.id },
    });

    const res = await http().get(`/car-transfers/${tokenOf(sent.body.link)}`);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('transfer_cancelled');
  });

  it('answers 410 transfer_expired at the exact expiry instant', async () => {
    const { auth, car } = await seller();
    const sent = await sendTransfer(app, auth, car.id, {
      buyerPhone: BUYER,
      repairIds: [],
    });
    await prisma.carTransfer.update({
      data: { expiresAt: new Date(), sentAt: new Date(0) },
      where: { id: sent.body.transfer.id },
    });

    const res = await http().get(`/car-transfers/${tokenOf(sent.body.link)}`);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('transfer_expired');
  });
});
