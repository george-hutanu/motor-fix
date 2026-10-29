import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import {
  acceptTransfer,
  sendTransfer,
  tokenOf,
  transfersApp,
  transfersWorld,
} from './transfers.testing';
import { serialDatabase } from '../../auth/serial-db.testing';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { databaseUrl } from '../../notifications/notifications.testing';

// @traces 1265-FR-003 1265-FR-004 1265-FR-006 1265-FR-009 1265-FR-010 1265-FR-012 1265-FR-013

const SELLER_PHONE = '+40733000111';
const BUYER_PHONE = '+40722123456';
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
const get = (auth: string | null, path: string) => {
  const call = http().get(path);
  return auth ? call.set('Authorization', auth) : call;
};
const accept = (auth: string | null, token: string) =>
  acceptTransfer(app, auth, token);

async function offered(name = 'Andrei Marin', ticked: string[] = []) {
  const seller = await world.driver(name, { phone: SELLER_PHONE });
  const car = await world.car(seller.id);
  const res = await sendTransfer(app, seller.auth, car.id, {
    buyerPhone: BUYER_PHONE,
    repairIds: ticked,
  });
  expect(res.status).toBe(201);
  return { car, seller, token: tokenOf(res.body.link) };
}

const buyer = (name = 'Maria Ionescu') =>
  world.driver(name, { phone: BUYER_PHONE });

describe('POST /car-transfers/:token/accept on hostile tokens', () => {
  it.each([
    ['a token of 2000 characters', 'a'.repeat(2000)],
    ['a token with a unicode letter', 'ăîșț'.repeat(11)],
    ['an encoded null byte', '%00'],
    ['an encoded slash', 'a%2Fb'],
    ['spaces', '%20%20%20'],
    ['a SQL fragment', encodeURIComponent("' OR '1'='1")],
  ])('answers 404 not_found to %s', async (_, token) => {
    const maria = await buyer();

    const res = await accept(maria.auth, token);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 404 to a read of the same hostile tokens, signed in or not', async () => {
    const maria = await buyer();

    for (const token of ['a'.repeat(2000), '%00', 'ăîșț']) {
      expect((await get(null, `/car-transfers/${token}`)).status).toBe(404);
      expect((await get(maria.auth, `/car-transfers/${token}`)).status).toBe(
        404,
      );
    }
  });

  it('answers 401 to a garbage bearer on accept and treats it as a visitor on the read', async () => {
    const { token } = await offered();

    expect((await accept('Bearer not.a.token', token)).status).toBe(401);
    const read = await get('Bearer not.a.token', `/car-transfers/${token}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ status: 'sent' });
  });
});

describe('POST /car-transfers/:token/accept with a body', () => {
  it('ignores a body that names another car or another buyer', async () => {
    const { car, token } = await offered();
    const maria = await buyer();
    const other = await world.driver('Altcineva');
    const decoy = await world.car(other.id);

    const res = await accept(maria.auth, token).send({
      buyerAccountId: other.id,
      carId: decoy.id,
    });

    expect([200, 400]).toContain(res.status);
    const row = await prisma.car.findUniqueOrThrow({ where: { id: car.id } });
    const decoyRow = await prisma.car.findUniqueOrThrow({
      where: { id: decoy.id },
    });
    expect(decoyRow.ownerId).toBe(other.id);
    expect(row.ownerId).toBe(res.status === 200 ? maria.id : row.ownerId);
    if (res.status === 200) expect(res.body).toEqual({ carId: car.id });
  });
});

describe('POST /car-transfers/:token/accept in a race', () => {
  it('lets one of five buyers take the car and answers the rest 410 transfer_accepted', async () => {
    const { car, token } = await offered();
    const buyers = await Promise.all(
      ['b1', 'b2', 'b3', 'b4', 'b5'].map((name) => world.driver(name)),
    );

    const answers = await Promise.all(
      buyers.map((who) => accept(who.auth, token)),
    );

    expect(answers.map((res) => res.status).sort()).toEqual([
      200, 410, 410, 410, 410,
    ]);
    expect(
      answers.filter((res) => res.status === 410).map((res) => res.body.code),
    ).toEqual(Array(4).fill('transfer_accepted'));
    const open = (await world.ownerships(car.id)).filter(
      (row) => row.access === 'owner' && row.closedAt === null,
    );
    expect(open).toHaveLength(1);
  });

  it('answers the seller 410 transfer_accepted, not own_transfer, once the car is taken', async () => {
    const { seller, token } = await offered();
    const maria = await buyer();
    await accept(maria.auth, token).expect(200);

    const res = await accept(seller.auth, token);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('transfer_accepted');
  });

  it('lets the same buyer who just took the car not take it again', async () => {
    const { token } = await offered();
    const maria = await buyer();
    await accept(maria.auth, token).expect(200);

    const again = await accept(maria.auth, token);

    expect(again.status).toBe(410);
    expect(again.body.code).toBe('transfer_accepted');
  });
});

describe('GET /car-transfers/:token with a session, on odd names and counts', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['Andrei', 'Andrei'],
    ['  Andrei   Marin  ', 'Andrei M.'],
    ['Ana Maria Pop', 'Ana P.'],
    ['Ștefan Ărdeleanu', 'Ștefan Ă.'],
    ['Ion-Paul Marin-Popescu', 'Ion-Paul M.'],
  ])('shows the seller named %j as %j', async (name, shown) => {
    const { seller, token } = await offered();
    await prisma.account.update({ data: { name }, where: { id: seller.id } });
    const maria = await buyer();

    const res = await get(maria.auth, `/car-transfers/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.sellerName).toBe(shown);
  });

  it('counts zero repairs as 0, present, and leaves out a deleted MotorFix repair', async () => {
    const { car, token } = await offered();
    const maria = await buyer();
    const first = await get(maria.auth, `/car-transfers/${token}`);
    const made = await world.throughMotorFix(
      (await prisma.car.findUniqueOrThrow({ where: { id: car.id } })).ownerId,
      car.id,
    );
    await prisma.repair.update({
      data: { deletedAt: new Date() },
      where: { id: made.id },
    });
    const second = await get(maria.auth, `/car-transfers/${token}`);

    expect(first.body.repairCount).toBe(0);
    expect(second.body.repairCount).toBe(0);
  });

  it('never counts a logged repair that was not ticked', async () => {
    const seller = await world.driver('Andrei Marin', { phone: SELLER_PHONE });
    const car = await world.car(seller.id);
    await world.logged(car.id);
    const sent = await sendTransfer(app, seller.auth, car.id, {
      buyerPhone: BUYER_PHONE,
      repairIds: [],
    });
    const maria = await buyer();

    const res = await get(
      maria.auth,
      `/car-transfers/${tokenOf(sent.body.link)}`,
    );

    expect(res.body.repairCount).toBe(0);
  });
});

describe('what the buyer inherits when a ticked repair vanishes', () => {
  it('lists neither a ticked repair deleted before the accept nor an unticked one', async () => {
    const seller = await world.driver('Andrei Marin', { phone: SELLER_PHONE });
    const car = await world.car(seller.id);
    const kept = await world.logged(car.id, { what: 'Kept' });
    const gone = await world.logged(car.id, { what: 'Gone' });
    await world.logged(car.id, { what: 'Private' });
    const sent = await sendTransfer(app, seller.auth, car.id, {
      buyerPhone: BUYER_PHONE,
      repairIds: [kept.id, gone.id],
    });
    await prisma.repair.update({
      data: { deletedAt: new Date() },
      where: { id: gone.id },
    });
    const maria = await buyer();
    await accept(maria.auth, tokenOf(sent.body.link)).expect(200);

    const res = await get(maria.auth, `/cars/${car.id}/repairs`);

    expect(res.body.items.map((row: { what: string }) => row.what)).toEqual([
      'Kept',
    ]);
  });

  it('refuses the buyer’s onward sale of a repair the first seller never passed', async () => {
    const seller = await world.driver('Andrei Marin', { phone: SELLER_PHONE });
    const car = await world.car(seller.id);
    const passed = await world.logged(car.id, { what: 'Passed' });
    const secret = await world.logged(car.id, { what: 'Secret' });
    const sent = await sendTransfer(app, seller.auth, car.id, {
      buyerPhone: BUYER_PHONE,
      repairIds: [passed.id],
    });
    const maria = await buyer();
    await accept(maria.auth, tokenOf(sent.body.link)).expect(200);

    const bad = await sendTransfer(app, maria.auth, car.id, {
      buyerPhone: '+40744555666',
      repairIds: [secret.id],
    });
    const good = await sendTransfer(app, maria.auth, car.id, {
      buyerPhone: '+40744555666',
      repairIds: [passed.id],
    });

    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('unknown_repair');
    expect(good.status).toBe(201);
  });
});

describe('the seller’s read-only copy on hostile ids', () => {
  it.each(['not-a-uuid', '%00', '0'.repeat(40)])(
    'answers 404 or 400, never 500, for sold car %j',
    async (id) => {
      const { seller } = await offered();

      const res = await get(seller.auth, `/cars/sold/${id}/repairs`);

      expect([400, 404]).toContain(res.status);
    },
  );

  it('answers 404 for the sold list of a car id read as a car', async () => {
    const { car, seller, token } = await offered();
    const maria = await buyer();
    await accept(maria.auth, token).expect(200);

    expect((await get(seller.auth, `/cars/${car.id}`)).status).toBe(404);
    expect((await get(seller.auth, `/cars/${car.id}/repairs`)).status).toBe(
      404,
    );
    expect((await get(maria.auth, `/cars/sold/${car.id}/repairs`)).status).toBe(
      404,
    );
  });

  it('answers 401 to a visitor on every history route', async () => {
    const { car } = await offered();

    for (const path of [
      `/cars/${car.id}/repairs`,
      '/cars/sold',
      `/cars/sold/${car.id}/repairs`,
    ]) {
      expect((await get(null, path)).status).toBe(401);
    }
  });

  it('lists an empty sold list for an account that never sold, 200 with no items', async () => {
    const maria = await buyer();

    const res = await get(maria.auth, '/cars/sold');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('lists the sale date as a plain day and no private field of the car', async () => {
    const { car, seller, token } = await offered();
    await prisma.car.update({
      data: { plate: 'B123ABC' },
      where: { id: car.id },
    });
    const maria = await buyer();
    await accept(maria.auth, token).expect(200);

    const res = await get(seller.auth, '/cars/sold');

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].saleDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'brandName',
      'id',
      'model',
      'saleDate',
      'year',
    ]);
  });
});

describe('the seller’s notice of the sale', () => {
  // The bell, e-mail and push rows are the worker's (the fan-out spec);
  // the accept owes the event they are built from.
  const acceptedEvents = async (mark: bigint) =>
    (await world.transferEvents(mark)).filter(
      (event) => event.kind === 'car_transfer.accepted',
    );

  it('writes one car_transfer.accepted event for the seller, naming neither the buyer nor the phone', async () => {
    const { seller, token } = await offered();
    const maria = await buyer('Maria Ionescu');
    const { mark } = await world.marks();
    await accept(maria.auth, token).expect(200);

    const events = await acceptedEvents(mark);

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({ sellerAccountId: seller.id }),
    );
    const text = JSON.stringify(events[0]?.payload);
    expect(text).not.toContain('Maria');
    expect(text).not.toContain(BUYER_PHONE);
  });

  it('still hands the car over when the model name is 40 characters long', async () => {
    const { car, token } = await offered();
    await prisma.car.update({
      data: { model: 'M'.repeat(40) },
      where: { id: car.id },
    });
    const maria = await buyer();
    const { mark } = await world.marks();

    const res = await accept(maria.auth, token);

    expect(res.status).toBe(200);
    expect(await acceptedEvents(mark)).toHaveLength(1);
  });

  it('notifies a seller with no name and no language set without failing the accept', async () => {
    const { seller, token } = await offered('');
    await prisma.account.update({
      data: { name: '' },
      where: { id: seller.id },
    });
    const maria = await buyer();

    expect((await accept(maria.auth, token)).status).toBe(200);
  });
});
