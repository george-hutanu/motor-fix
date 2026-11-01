import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { motorFixRepair } from './history.testing';
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
// @traces 061-FR-007
// @traces 061-FR-008
// @traces 061-FR-009

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
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: car.brandId },
    });

    const res = await get(maria.auth, `/cars/${car.id}/repairs`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        car: {
          brandName: brand.name,
          id: car.id,
          model: 'Cooper S',
          year: 2019,
        },
        correctedBy: null,
        costBani: null,
        doneOn: localDay(hers.doneOn),
        fromPreviousOwner: false,
        garageId: null,
        garageName: 'Service Popescu',
        id: hers.id,
        mechanicName: null,
        odometerKm: null,
        review: null,
        source: 'logged',
        what: 'Hers',
      },
      expect.objectContaining({ fromPreviousOwner: true, id: newer.id }),
      expect.objectContaining({ fromPreviousOwner: true, id: older.id }),
    ]);
    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'car',
      'correctedBy',
      'costBani',
      'doneOn',
      'fromPreviousOwner',
      'garageId',
      'garageName',
      'id',
      'mechanicName',
      'odometerKm',
      'review',
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

describe('a MotorFix repair on the history reads', () => {
  // @traces 026-FR-001 026-FR-002
  it('names the job’s mechanic, the review the driver may write, the car and the garage', async () => {
    const { andrei } = await people();
    const car = await world.car(andrei.id);
    const { garage, job, repair } = await motorFixRepair(
      prisma,
      andrei.id,
      car.id,
    );

    const res = await get(andrei.auth, `/cars/${car.id}/repairs`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        car: expect.objectContaining({ id: car.id, model: 'Cooper S' }),
        costBani: 125_000,
        garageId: garage.id,
        garageName: 'Garaj Nordic',
        id: repair.id,
        mechanicName: 'Mihai Dumitru',
        odometerKm: 148_250,
        review: {
          jobId: job.id,
          rating: null,
          reviewId: null,
          state: 'can_write',
        },
        source: 'motorfix',
        what: 'Plăcuțe și discuri față',
      }),
    ]);
  });

  it.each([
    [
      'the owner’s own row at a garage with no team',
      { isOwner: true, name: 'Ion Popa' },
      'Ion Popa',
    ],
    [
      'a mechanic hidden from the profile',
      { name: 'Mihai Dumitru', onProfile: false },
      'Mihai Dumitru',
    ],
  ])('names %s', async (_, mechanic, name) => {
    const { andrei } = await people();
    const car = await world.car(andrei.id);
    await motorFixRepair(prisma, andrei.id, car.id, { mechanic });

    const res = await get(andrei.auth, `/cars/${car.id}/repairs`);

    expect(res.body.items[0].mechanicName).toBe(name);
  });

  it('names no one for a job with no mechanic, or a mechanic row deleted', async () => {
    const { andrei } = await people();
    const car = await world.car(andrei.id);
    await motorFixRepair(prisma, andrei.id, car.id, { mechanic: null });
    const { mechanic } = await motorFixRepair(prisma, andrei.id, car.id);
    await prisma.mechanic.delete({ where: { id: mechanic?.id } });

    const res = await get(andrei.auth, `/cars/${car.id}/repairs`);

    expect(
      res.body.items.map(
        (r: { mechanicName: string | null }) => r.mechanicName,
      ),
    ).toEqual([null, null]);
  });

  it('answers the job’s names in the reader’s language, and the stored text once they are gone', async () => {
    const { andrei } = await people();
    const english = await world.driver('Ana Pop', {
      language: 'en',
      phone: '+40744000222',
    });
    const car = await world.car(english.id);
    const { job } = await motorFixRepair(prisma, english.id, car.id, {
      jobs: [
        ['Plăcuțe față', 'Front pads'],
        ['Discuri față', 'Front discs'],
      ],
    });
    const mine = await world.car(andrei.id);
    await motorFixRepair(prisma, andrei.id, mine.id);

    const en = await get(english.auth, `/cars/${car.id}/repairs`);
    expect(whats(en)).toEqual(['Front pads, Front discs']);
    expect(whats(await get(andrei.auth, `/cars/${mine.id}/repairs`))).toEqual([
      'Plăcuțe și discuri față',
    ]);

    await prisma.quoteJob.updateMany({
      data: { included: false },
      where: { quote: { booking: { id: job.bookingId } } },
    });
    expect(whats(await get(english.auth, `/cars/${car.id}/repairs`))).toEqual([
      'Plăcuțe față, Discuri față',
    ]);
  });

  // @traces 026-FR-002 026-FR-003 026-FR-005 026-FR-008
  it.each([
    [10, undefined, 'can_write', null],
    [60, undefined, 'can_write', null],
    [61, undefined, 'can_write', null],
    [10, { rating: 5, status: 'published' }, 'written', 5],
    [10, { rating: 2, status: 'reported' }, 'written', 2],
    [10, { rating: 1, status: 'removed' }, 'removed', null],
    [30, { rating: 3, status: 'deleted_by_author' }, 'can_write', null],
    [61, { rating: 3, status: 'deleted_by_author' }, 'can_write', null],
  ] as const)(
    'answers a repair done %i days ago with review %j as %s, rating %j',
    async (daysAgo, review, state, rating) => {
      const { andrei } = await people();
      const car = await world.car(andrei.id);
      await motorFixRepair(prisma, andrei.id, car.id, { daysAgo, review });

      const res = await get(andrei.auth, `/cars/${car.id}/repairs`);

      expect(res.body.items[0].review).toEqual(
        expect.objectContaining({ rating, state }),
      );
      expect(JSON.stringify(res.body)).not.toContain('Foarte bine');
    },
  );

  // @traces 026-FR-001 026-FR-004
  it('answers the sold car’s MotorFix repair to its former owner with the same row and his review, the buyer none', async () => {
    const { andrei, maria } = await people();
    const car = await world.car(andrei.id);
    const { job, repair } = await motorFixRepair(prisma, andrei.id, car.id, {
      review: { rating: 5, status: 'published' },
    });
    await hand(andrei, maria, car.id);
    await world.logged(car.id, { daysAgo: 0, what: 'Hers' });

    const sold = await get(andrei.auth, `/cars/sold/${car.id}/repairs`);
    const hers = await get(maria.auth, `/cars/${car.id}/repairs`);

    expect(sold.body.items).toEqual([
      expect.objectContaining({
        id: repair.id,
        mechanicName: 'Mihai Dumitru',
        review: expect.objectContaining({
          jobId: job.id,
          rating: 5,
          state: 'written',
        }),
      }),
    ]);
    expect(hers.body.items).toContainEqual(
      expect.objectContaining({
        fromPreviousOwner: true,
        id: repair.id,
        review: { jobId: job.id, rating: null, reviewId: null, state: 'none' },
      }),
    );
  });

  it('never answers the plate, a phone or an e-mail', async () => {
    const { andrei } = await people();
    const car = await world.car(andrei.id);
    await motorFixRepair(prisma, andrei.id, car.id);

    const res = await get(andrei.auth, `/cars/${car.id}/repairs`);
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('B123ABC');
    expect(body).not.toContain(andrei.phone);
    expect(body).not.toMatch(/@example/);
  });
});
