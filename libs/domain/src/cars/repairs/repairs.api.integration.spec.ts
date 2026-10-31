// @traces 061-FR-005
// @traces 061-FR-006
// @traces 061-FR-009
// @traces 061-FR-010
// @traces 061-FR-011
// @traces 061-FR-013
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { RepairsModule } from './repairs.module';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { DirectSendModule } from '../../notifications/direct-send/direct-send.module';
import {
  databaseUrl,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { CarHistoryModule } from '../history/history.module';
import { motorFixRepair } from '../history/history.testing';
import { CarsModule } from '../my-cars/cars/cars.module';
import { CarTransfersModule } from '../transfers/transfers.module';
import {
  acceptTransfer,
  sendTransfer,
  tokenOf,
  transfersWorld,
  WEB_URL,
} from '../transfers/transfers.testing';

const world = transfersWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;
let lines: string[] = [];

beforeAll(async () => {
  await brevo.start();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({
        databaseUrl,
        redisUrl: redisUrlFor(15),
        tokenSecret: 'test-secret',
      }),
      CarHistoryModule,
      CarsModule,
      RepairsModule,
      CarTransfersModule.register(
        WEB_URL,
        DirectSendModule.register(redisUrlFor(15)),
      ),
      DirectSendModule.registerWorker({
        email: testConfig(brevo.url),
        phone: testPhoneConfig({
          PHONE_ALLOWLIST: '+407*',
          WHATSAPP_TEMPLATES:
            'motorfix_car_transfer_link_ro=41,motorfix_car_transfer_link_en=42',
        }),
        redisUrl: redisUrlFor(15),
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
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  lines = [];
  const keep = (message: unknown) => {
    lines.push(String(message));
  };
  jest.spyOn(Logger.prototype, 'log').mockImplementation(keep);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(keep);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(keep);
  await world.reset();
  brevo.reset();
});

afterEach(() => jest.restoreAllMocks());

const http = () => request(app.getHttpServer());
const call = (
  method: 'get' | 'patch' | 'delete',
  auth: string | null,
  path: string,
) => {
  const req = http()[method](path);
  return auth ? req.set('Authorization', auth) : req;
};
const list = (auth: string | null, query: Record<string, string> = {}) =>
  call('get', auth, '/repairs').query(query);
const ids = (res: request.Response) =>
  res.body.items.map((r: { id: string }) => r.id);

async function people() {
  const andreiPhone = '+40733000111';
  const mariaPhone = '+40722123456';
  return {
    andrei: {
      ...(await world.driver('Andrei Marin', { phone: andreiPhone })),
      phone: andreiPhone,
    },
    maria: {
      ...(await world.driver('Maria Ionescu', { phone: mariaPhone })),
      phone: mariaPhone,
    },
  };
}

// Sells `carId` from `from` to `to`, ticking `repairIds`.
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

// A logged repair done `daysAgo` days ago, created now: later calls are newer.
const logged = (carId: string, daysAgo: number, what = 'Schimb ulei') =>
  world.logged(carId, { daysAgo, what });

const removeCar = (carId: string) =>
  prisma.car.update({ data: { removedAt: new Date() }, where: { id: carId } });

const UNKNOWN = '3f2c1b0a-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

describe('GET /repairs', () => {
  it('answers the repairs of every car of the caller, newest first, each with its car', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const logan = await world.car(andrei.id);
    const old = await logged(logan.id, 230);
    const { repair: fresh } = await motorFixRepair(prisma, andrei.id, golf.id, {
      daysAgo: 27,
    });

    const res = await list(andrei.auth);

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([fresh.id, old.id]);
    expect(res.body.items[0].car).toEqual(
      expect.objectContaining({ id: golf.id, model: 'Cooper S', year: 2019 }),
    );
    expect(res.body.items[1].car.id).toBe(logan.id);
    expect(res.body.nextCursor).toBeNull();
  });

  it('puts the repair created last first among those done on the same day', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const logan = await world.car(andrei.id);
    const first = await logged(golf.id, 5, 'First');
    const second = await logged(logan.id, 5, 'Second');

    expect(ids(await list(andrei.auth))).toEqual([second.id, first.id]);
  });

  it('pages 25 repairs as 20 then 5 with no repeat, and answers the limit asked', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const logan = await world.car(andrei.id);
    for (let n = 0; n < 25; n += 1) {
      // Same-day pairs, so the order leans on its tie-breaks across pages.
      await logged(n % 2 ? golf.id : logan.id, Math.floor(n / 2), `R${n}`);
    }

    const first = await list(andrei.auth);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.nextCursor).toBe(first.body.items[19].id);

    const second = await list(andrei.auth, {
      cursor: first.body.nextCursor,
    });
    expect(second.body.items).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();

    const all = [...ids(first), ...ids(second)];
    expect(new Set(all).size).toBe(25);
    const walked = all.map(
      (id) =>
        [...first.body.items, ...second.body.items].find(
          (r: { id: string }) => r.id === id,
        ).doneOn,
    );
    expect(walked).toEqual([...walked].sort().reverse());

    const six = await list(andrei.auth, { limit: '6' });
    expect(six.body.items).toHaveLength(6);
    expect(ids(six)).toEqual(ids(first).slice(0, 6));
  });

  it('answers an empty page with no cursor to a driver with no cars or no repairs', async () => {
    const { andrei, maria } = await people();
    await world.car(maria.id);

    for (const auth of [andrei.auth, maria.auth]) {
      const res = await list(auth);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
    }
  });

  it('leaves out a removed car’s repairs and a deleted repair', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const gone = await world.car(andrei.id);
    const kept = await logged(golf.id, 3, 'Kept');
    await world.logged(golf.id, { deleted: true, what: 'Deleted' });
    await logged(gone.id, 2, 'Removed car');
    await removeCar(gone.id);

    expect(ids(await list(andrei.auth))).toEqual([kept.id]);
  });

  it('answers the previous owner’s repairs passed on at the sale, flagged, and not the others; the seller no longer sees the car', async () => {
    const { andrei, maria } = await people();
    const logan = await world.car(andrei.id);
    const passed = await logged(logan.id, 300, 'Passed on');
    await logged(logan.id, 200, 'Kept back');
    const { repair: motorfix } = await motorFixRepair(
      prisma,
      andrei.id,
      logan.id,
      { daysAgo: 100 },
    );
    await hand(andrei, maria, logan.id, [passed.id]);

    const hers = await list(maria.auth);

    expect(ids(hers)).toEqual([motorfix.id, passed.id]);
    expect(
      hers.body.items.every(
        (r: { fromPreviousOwner: boolean }) => r.fromPreviousOwner,
      ),
    ).toBe(true);
    expect(hers.body.items[0].review).toBeNull();
    expect((await list(andrei.auth)).body.items).toEqual([]);
  });

  it('narrows the list to the car named, and answers one 404 for any car not the caller’s', async () => {
    const { andrei, maria } = await people();
    const golf = await world.car(andrei.id);
    const logan = await world.car(andrei.id);
    const removed = await world.car(andrei.id);
    const sold = await world.car(andrei.id);
    const hers = await world.car(maria.id);
    const mine = await logged(golf.id, 3, 'Golf');
    await logged(logan.id, 2, 'Logan');
    await removeCar(removed.id);
    await hand(andrei, maria, sold.id);

    const narrowed = await list(andrei.auth, { carId: golf.id });
    expect(narrowed.status).toBe(200);
    expect(ids(narrowed)).toEqual([mine.id]);

    const refusals = await Promise.all(
      [hers.id, removed.id, sold.id, UNKNOWN].map((carId) =>
        list(andrei.auth, { carId }),
      ),
    );
    for (const res of refusals) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      expect(res.body).toEqual(refusals[0].body);
    }
  });

  it('answers 400 invalid_cursor to a cursor not of this list for the caller', async () => {
    const { andrei, maria } = await people();
    const golf = await world.car(andrei.id);
    const hers = await world.car(maria.id);
    await logged(golf.id, 3, 'Golf');
    const other = await logged(hers.id, 3, 'Hers');

    for (const cursor of [other.id, UNKNOWN, 'abc']) {
      const res = await list(andrei.auth, { cursor });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    }
  });

  it.each([['0'], ['21'], ['x'], ['1.5']])(
    'answers 400 to the limit %s',
    async (limit) => {
      const { andrei } = await people();

      expect((await list(andrei.auth, { limit })).status).toBe(400);
    },
  );

  it('answers 400 to a car id that is not a uuid', async () => {
    const { andrei } = await people();

    expect((await list(andrei.auth, { carId: 'golf' })).status).toBe(400);
  });

  it('answers 401 signed out', async () => {
    const res = await list(null);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('never answers or logs the plate, an account, a phone, an e-mail or a removed review', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    await motorFixRepair(prisma, andrei.id, golf.id, {
      review: { rating: 1, status: 'removed' },
    });

    const res = await list(andrei.auth);
    const body = JSON.stringify(res.body);

    expect(res.body.items[0].review).toBeNull();
    for (const text of [body, lines.join('\n')]) {
      expect(text).not.toContain('B123ABC');
      expect(text).not.toContain(andrei.phone);
      expect(text).not.toContain(andrei.id);
      expect(text).not.toMatch(/@example/);
      expect(text).not.toContain('Foarte bine');
    }
  });
});

describe('PATCH and DELETE /repairs/:id', () => {
  const methods = ['patch', 'delete'] as const;

  async function untouched(repairId: string, since: Date) {
    const row = await prisma.repair.findUniqueOrThrow({
      where: { id: repairId },
    });
    const entries = await prisma.activityLog.count({
      where: { at: { gte: since }, subjectId: repairId },
    });
    return { deletedAt: row.deletedAt, entries, what: row.what };
  }

  it.each(methods)(
    '%s answers 409 motorfix_repair on a MotorFix repair and changes nothing',
    async (method) => {
      const { andrei } = await people();
      const golf = await world.car(andrei.id);
      const { repair } = await motorFixRepair(prisma, andrei.id, golf.id);
      const since = new Date();

      const res = await call(method, andrei.auth, `/repairs/${repair.id}`);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'motorfix_repair',
        message: 'Reparația vine dintr-o lucrare MotorFix',
      });
      expect(await untouched(repair.id, since)).toEqual({
        deletedAt: null,
        entries: 0,
        what: repair.what,
      });
    },
  );

  it.each(methods)(
    '%s answers 501 not_implemented on a logged repair and changes nothing',
    async (method) => {
      const { andrei } = await people();
      const golf = await world.car(andrei.id);
      const repair = await logged(golf.id, 3, 'Schimb ulei');
      const since = new Date();

      const res = await call(method, andrei.auth, `/repairs/${repair.id}`);

      expect(res.status).toBe(501);
      expect(res.body).toMatchObject({
        code: 'not_implemented',
        message: 'Editarea reparațiilor adăugate vine cu o versiune următoare',
      });
      expect(await untouched(repair.id, since)).toEqual({
        deletedAt: null,
        entries: 0,
        what: 'Schimb ulei',
      });
    },
  );

  it.each(methods)(
    '%s answers one 404 for another driver’s, a deleted, a removed car’s, a sold car’s or an unknown repair',
    async (method) => {
      const { andrei, maria } = await people();
      const hers = await world.car(maria.id);
      const golf = await world.car(andrei.id);
      const removed = await world.car(andrei.id);
      const sold = await world.car(andrei.id);
      const others = await logged(hers.id, 3, 'Hers');
      const deleted = await world.logged(golf.id, { deleted: true });
      const { repair: onRemoved } = await motorFixRepair(
        prisma,
        andrei.id,
        removed.id,
      );
      await removeCar(removed.id);
      const onSold = await logged(sold.id, 3, 'Sold');
      await hand(andrei, maria, sold.id);

      const refusals = await Promise.all(
        [others.id, deleted.id, onRemoved.id, onSold.id, UNKNOWN].map((id) =>
          call(method, andrei.auth, `/repairs/${id}`),
        ),
      );
      for (const res of refusals) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('not_found');
        expect(res.body).toEqual(refusals[0].body);
      }
    },
  );

  it.each(methods)('%s answers 401 signed out', async (method) => {
    const res = await call(method, null, `/repairs/${UNKNOWN}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });
});
