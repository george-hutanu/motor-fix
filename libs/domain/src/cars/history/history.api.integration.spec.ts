import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { serialDatabase } from '../../auth/serial-db.testing';
import { localDay } from '../../bucharest';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { databaseUrl } from '../../notifications/notifications.testing';
import {
  acceptTransfer,
  sendTransfer,
  tokenOf,
  transfersApp,
  transfersWorld,
} from '../transfers/transfers.testing';

// @traces 1265-FR-010 1265-FR-011 1265-FR-012
// @traces 409-FR-015

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
const whats = (res: request.Response) =>
  res.body.items.map((r: { what: string }) => r.what);

// Hands `carId` from `from` to `to`, ticking `repairIds`.
async function hand(
  from: { auth: string },
  to: { auth: string; phone: string },
  carId: string,
  repairIds: string[] = [],
) {
  const sent = await sendTransfer(app, from.auth, carId, {
    buyerPhone: to.phone,
    repairIds,
  });
  expect(sent.status).toBe(201);
  await acceptTransfer(app, to.auth, tokenOf(sent.body.link)).expect(200);
}

async function people() {
  const andreiPhone = '+40733000111';
  const mariaPhone = '+40722123456';
  const andrei = {
    ...(await world.driver('Andrei Marin', { phone: andreiPhone })),
    phone: andreiPhone,
  };
  const maria = {
    ...(await world.driver('Maria Ionescu', { phone: mariaPhone })),
    phone: mariaPhone,
  };
  return { andrei, maria };
}

describe('GET /cars/:id/repairs', () => {
  it('answers the owner the repairs they may read, newest first, with the flag and no invoice or review', async () => {
    const { andrei, maria } = await people();
    const car = await world.car(andrei.id);
    const older = await world.logged(car.id, { daysAgo: 60, what: 'Older' });
    const newer = await world.logged(car.id, { daysAgo: 10, what: 'Newer' });
    await world.logged(car.id, { daysAgo: 20, what: 'Not ticked' });
    await world.logged(car.id, { deleted: true, what: 'Deleted' });
    await hand(andrei, maria, car.id, [older.id, newer.id]);
    const hers = await world.logged(car.id, { daysAgo: 1, what: 'Hers' });

    const res = await get(maria.auth, `/cars/${car.id}/repairs`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        correctedBy: null,
        costBani: null,
        doneOn: localDay(hers.doneOn),
        fromPreviousOwner: false,
        garageName: 'Service Popescu',
        id: hers.id,
        odometerKm: null,
        source: 'logged',
        what: 'Hers',
      },
      expect.objectContaining({ fromPreviousOwner: true, id: newer.id }),
      expect.objectContaining({ fromPreviousOwner: true, id: older.id }),
    ]);
    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'correctedBy',
      'costBani',
      'doneOn',
      'fromPreviousOwner',
      'garageName',
      'id',
      'odometerKm',
      'source',
      'what',
    ]);
  });

  it('breaks a same-day tie by creation time, newest first', async () => {
    const { andrei } = await people();
    const car = await world.car(andrei.id);
    await world.logged(car.id, { daysAgo: 5, what: 'First' });
    await world.logged(car.id, { daysAgo: 5, what: 'Second' });

    expect(whats(await get(andrei.auth, `/cars/${car.id}/repairs`))).toEqual([
      'Second',
      'First',
    ]);
  });

  it('answers 401 signed out, and 404 for another account’s car or a removed one', async () => {
    const { andrei, maria } = await people();
    const car = await world.car(andrei.id);

    expect((await get(null, `/cars/${car.id}/repairs`)).status).toBe(401);
    expect((await get(maria.auth, `/cars/${car.id}/repairs`)).status).toBe(404);
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: car.id },
    });
    expect((await get(andrei.auth, `/cars/${car.id}/repairs`)).status).toBe(
      404,
    );
  });

  it('answers the seller 404 once the car changed hands', async () => {
    const { andrei, maria } = await people();
    const car = await world.car(andrei.id);
    await hand(andrei, maria, car.id);

    expect((await get(andrei.auth, `/cars/${car.id}/repairs`)).status).toBe(
      404,
    );
  });
});

describe('GET /cars/sold and /cars/sold/:id/repairs', () => {
  it('lists what the caller sold, newest sale first, a removed car included', async () => {
    const { andrei, maria } = await people();
    const first = await world.car(andrei.id);
    const second = await world.car(andrei.id);
    await hand(andrei, maria, first.id);
    await hand(andrei, maria, second.id);
    await prisma.car.update({
      data: { removedAt: new Date() },
      where: { id: first.id },
    });
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: second.brandId },
    });

    const res = await get(andrei.auth, '/cars/sold');

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        brandName: brand.name,
        id: second.id,
        model: 'Cooper S',
        saleDate: localDay(new Date()),
        year: 2019,
      },
      expect.objectContaining({ id: first.id }),
    ]);
    expect((await get(maria.auth, '/cars/sold')).body.items).toEqual([]);
  });

  it('answers the former owner the repairs up to the sale, nothing recorded after it', async () => {
    const { andrei, maria } = await people();
    const car = await world.car(andrei.id);
    await world.logged(car.id, { daysAgo: 10, what: 'Kept' });
    await world.throughMotorFix(andrei.id, car.id);
    await hand(andrei, maria, car.id);
    await world.logged(car.id, { daysAgo: 0, what: 'Hers' });
    await world.logged(car.id, { daysAgo: 30, what: 'Backdated' });

    const res = await get(andrei.auth, `/cars/sold/${car.id}/repairs`);

    expect(res.status).toBe(200);
    expect(whats(res).sort()).toEqual(['Kept', 'Schimb ulei']);
    expect(
      res.body.items.every(
        (r: { fromPreviousOwner: boolean }) => !r.fromPreviousOwner,
      ),
    ).toBe(true);
  });

  it('answers 404 to the buyer, for a never-sold car and signed out 401', async () => {
    const { andrei, maria } = await people();
    const car = await world.car(andrei.id);
    const never = await world.car(andrei.id);
    await hand(andrei, maria, car.id);

    expect((await get(maria.auth, `/cars/sold/${car.id}/repairs`)).status).toBe(
      404,
    );
    expect(
      (await get(andrei.auth, `/cars/sold/${never.id}/repairs`)).status,
    ).toBe(404);
    expect((await get(null, '/cars/sold')).status).toBe(401);
    expect((await get(null, `/cars/sold/${car.id}/repairs`)).status).toBe(401);
  });

  it('lists a car the caller sold twice once per sale, newest first', async () => {
    const { andrei, maria } = await people();
    const car = await world.car(andrei.id);
    await hand(andrei, maria, car.id);
    await hand(maria, andrei, car.id);
    await hand(andrei, maria, car.id);

    const res = await get(andrei.auth, '/cars/sold');

    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([
      car.id,
      car.id,
    ]);
  });

  it('lists a car back with its first owner by both rows', async () => {
    const { andrei, maria } = await people();
    const car = await world.car(andrei.id);
    await hand(andrei, maria, car.id);
    await hand(maria, andrei, car.id);

    const mine = await get(andrei.auth, '/cars');
    expect(mine.body.items.map((c: { id: string }) => c.id)).toEqual([car.id]);
    expect(
      (await get(andrei.auth, '/cars/sold')).body.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual([car.id]);
    expect(
      (await get(maria.auth, '/cars/sold')).body.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual([car.id]);
    expect((await get(andrei.auth, `/cars/${car.id}/repairs`)).status).toBe(
      200,
    );
    expect(
      (await get(andrei.auth, `/cars/sold/${car.id}/repairs`)).status,
    ).toBe(200);
  });
});

describe('the reading, the amount and the correction on both reads', () => {
  it('answers them to the owner and to the former owner alike', async () => {
    const { andrei, maria } = await people();
    const car = await world.car(andrei.id);
    const kept = await world.logged(car.id, { daysAgo: 10, what: 'Kept' });
    await prisma.repair.update({
      data: {
        costBani: 45_000,
        odometerKm: 151_000,
        updatedBy: andrei.id,
        updatedByRole: 'owner',
      },
      where: { id: kept.id },
    });
    await hand(andrei, maria, car.id, [kept.id]);

    for (const [auth, path] of [
      [maria.auth, `/cars/${car.id}/repairs`],
      [andrei.auth, `/cars/sold/${car.id}/repairs`],
    ] as const) {
      const res = await get(auth, path);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        expect.objectContaining({
          correctedBy: 'garage',
          costBani: 45_000,
          id: kept.id,
          odometerKm: 151_000,
        }),
      ]);
    }
  });
});
