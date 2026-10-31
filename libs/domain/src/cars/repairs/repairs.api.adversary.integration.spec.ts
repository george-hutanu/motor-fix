// @traces 061-FR-005
// @traces 061-FR-006
// @traces 061-FR-010
// @traces 061-FR-011
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

describe('GET /repairs under hostile input', () => {
  it('answers 400 to a cursor past 200 characters', async () => {
    const { andrei } = await people();

    const res = await list(andrei.auth, { cursor: 'a'.repeat(201) });

    expect(res.status).toBe(400);
  });

  it('answers 400 to a limit asked twice', async () => {
    const { andrei } = await people();

    const res = await call('get', andrei.auth, '/repairs?limit=5&limit=6');

    expect(res.status).toBe(400);
  });

  it('answers 400 to a negative, trailing-garbage, NaN or infinite limit', async () => {
    const { andrei } = await people();

    for (const limit of ['-1', '5abc', 'NaN', 'Infinity']) {
      const res = await list(andrei.auth, { limit });
      expect([limit, res.status]).toEqual([limit, 400]);
    }
  });

  it('answers 400 to a car id given twice', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);

    const res = await call(
      'get',
      andrei.auth,
      `/repairs?carId=${golf.id}&carId=${golf.id}`,
    );

    expect(res.status).toBe(400);
  });

  it('answers 400 to a cursor in a query array', async () => {
    const { andrei } = await people();

    const res = await call('get', andrei.auth, '/repairs?cursor[]=x');

    expect(res.status).toBe(400);
  });

  it('answers 400 invalid_cursor to a unicode cursor', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    await logged(golf.id, 3);

    const res = await list(andrei.auth, { cursor: 'ăîșțâ-🚗' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor to a cursor made of SQL', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    await logged(golf.id, 3);

    const res = await list(andrei.auth, { cursor: "' OR 1=1 --" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 to an unknown query field', async () => {
    const { andrei } = await people();

    const res = await list(andrei.auth, { ownerId: andrei.id });

    expect(res.status).toBe(400);
  });

  it('answers the same cars for an upper-case car id as for the lower-case one', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const mine = await logged(golf.id, 3);

    const res = await list(andrei.auth, { carId: golf.id.toUpperCase() });

    expect([res.status, ids(res)]).toEqual([200, [mine.id]]);
  });
});

describe('GET /repairs cursor and limit boundaries', () => {
  it('answers no cursor for exactly 20 repairs and a cursor for 21', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    for (let n = 0; n < 20; n += 1) await logged(golf.id, n, `R${n}`);

    const exact = await list(andrei.auth);
    expect(exact.body.items).toHaveLength(20);
    expect(exact.body.nextCursor).toBeNull();

    await logged(golf.id, 40, 'R20');
    const over = await list(andrei.auth);
    expect(over.body.items).toHaveLength(20);
    expect(over.body.nextCursor).toBe(over.body.items[19].id);
    const rest = await list(andrei.auth, { cursor: over.body.nextCursor });
    expect(rest.body.items.map((r: { what: string }) => r.what)).toEqual([
      'R20',
    ]);
    expect(rest.body.nextCursor).toBeNull();
  });

  it('walks three repairs one at a time and ends on a null cursor', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const a = await logged(golf.id, 3, 'A');
    const b = await logged(golf.id, 2, 'B');
    const c = await logged(golf.id, 1, 'C');

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const res: request.Response = await list(andrei.auth, {
        limit: '1',
        ...(cursor ? { cursor } : {}),
      });
      expect(res.status).toBe(200);
      seen.push(...ids(res));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toEqual([c.id, b.id, a.id]);
    expect(cursor).toBeNull();
  });

  it('pages rows sharing one day and one creation instant by id descending with no repeat', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const instant = new Date();
    const day = new Date('2026-09-30T00:00:00Z');
    const made = [];
    for (let n = 0; n < 7; n += 1) {
      made.push(
        await prisma.repair.create({
          data: {
            carId: golf.id,
            createdAt: instant,
            doneOn: day,
            garageName: 'Service',
            source: 'logged',
            what: `Tie ${n}`,
          },
        }),
      );
    }
    const expected = made
      .map((r) => r.id)
      .sort()
      .reverse();

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const res: request.Response = await list(andrei.auth, {
        limit: '2',
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...ids(res));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toEqual(expected);
  });

  it('neither repeats nor skips a row when a newer repair lands between two pages', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    for (let n = 0; n < 4; n += 1) await logged(golf.id, n + 5, `R${n}`);
    const first = await list(andrei.auth, { limit: '2' });

    await logged(golf.id, 0, 'Newest');
    const second = await list(andrei.auth, {
      cursor: first.body.nextCursor,
      limit: '2',
    });

    expect(second.body.items.map((r: { what: string }) => r.what)).toEqual([
      'R2',
      'R3',
    ]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('answers 400 invalid_cursor for a cursor whose repair was deleted since', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    await logged(golf.id, 1, 'A');
    const b = await logged(golf.id, 2, 'B');
    await logged(golf.id, 3, 'C');
    await prisma.repair.update({
      data: { deletedAt: new Date() },
      where: { id: b.id },
    });

    const res = await list(andrei.auth, { cursor: b.id });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor for a cursor on a removed car', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const gone = await world.car(andrei.id);
    await logged(golf.id, 1, 'A');
    const onGone = await logged(gone.id, 2, 'B');
    await removeCar(gone.id);

    const res = await list(andrei.auth, { cursor: onGone.id });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor for a cursor on another of his cars than the one the list is narrowed to', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const logan = await world.car(andrei.id);
    await logged(golf.id, 1, 'A');
    const onLogan = await logged(logan.id, 2, 'B');

    const res = await list(andrei.auth, { carId: golf.id, cursor: onLogan.id });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 invalid_cursor for a previous owner’s repair not passed on', async () => {
    const { andrei, maria } = await people();
    const logan = await world.car(andrei.id);
    await logged(logan.id, 300, 'Passed on');
    const kept = await logged(logan.id, 200, 'Kept back');
    await hand(andrei, maria, logan.id, []);

    const res = await list(maria.auth, { cursor: kept.id });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('checks the car before the cursor: an unknown car with a bad cursor answers 404', async () => {
    const { andrei } = await people();

    const res = await list(andrei.auth, { carId: UNKNOWN, cursor: 'abc' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 400 for a bad limit before it reads the car', async () => {
    const { andrei } = await people();

    const res = await list(andrei.auth, { carId: UNKNOWN, limit: '0' });

    expect(res.status).toBe(400);
  });
});

describe('GET /repairs content', () => {
  it('answers one row per MotorFix repair with a unicode job name intact', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const { repair } = await motorFixRepair(prisma, andrei.id, golf.id, {
      jobs: [['Schimb distribuție și curea 🔧', 'Timing belt']],
    });

    const res = await list(andrei.auth);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(repair.id);
    expect(res.body.items[0].what).toBe('Schimb distribuție și curea 🔧');
  });

  it('answers the seller an empty list after the car was sold on and handed back', async () => {
    const { andrei, maria } = await people();
    const logan = await world.car(andrei.id);
    const passed = await logged(logan.id, 300, 'Passed on');
    await hand(andrei, maria, logan.id, [passed.id]);
    await hand(maria, andrei, logan.id, []);

    const hers = await list(maria.auth);

    expect(hers.body).toEqual({ items: [], nextCursor: null });
  });

  it('answers the same body for the same call twice', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    await logged(golf.id, 3);
    await motorFixRepair(prisma, andrei.id, golf.id);

    const one = await list(andrei.auth);
    const two = await list(andrei.auth);

    expect(two.body).toEqual(one.body);
  });

  it('never lets one driver’s list carry another driver’s repair', async () => {
    const { andrei, maria } = await people();
    const golf = await world.car(andrei.id);
    const hers = await world.car(maria.id);
    const mine = await logged(golf.id, 3, 'Mine');
    const theirs = await logged(hers.id, 3, 'Hers');

    expect(ids(await list(andrei.auth))).toEqual([mine.id]);
    expect(ids(await list(maria.auth))).toEqual([theirs.id]);
  });
});

describe('PATCH and DELETE /repairs/:id under hostile input', () => {
  const methods = ['patch', 'delete'] as const;

  it.each(methods)(
    '%s answers 400 naming the uuid to an id that is no uuid',
    async (method) => {
      const { andrei } = await people();

      const res = await call(method, andrei.auth, '/repairs/not-a-uuid');

      // The test app has no ProblemFilter, so the body is Nest's own 400.
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/uuid/);
    },
  );

  it.each(methods)(
    '%s answers 404 for an unknown uuid and 400 for a malformed id',
    async (method) => {
      const { andrei } = await people();

      const unknown = await call(method, andrei.auth, `/repairs/${UNKNOWN}`);
      const malformed = await call(method, andrei.auth, '/repairs/1');

      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('not_found');
      expect(malformed.status).toBe(400);
      expect(malformed.body.message).toMatch(/uuid/);
    },
  );

  it.each(methods)(
    '%s answers 501 for a logged repair whatever body it carries and writes nothing',
    async (method) => {
      const { andrei } = await people();
      const golf = await world.car(andrei.id);
      const repair = await logged(golf.id, 3, 'Schimb ulei');

      const res = await call(method, andrei.auth, `/repairs/${repair.id}`)
        .set('Content-Type', 'application/json')
        .send({ costBani: -1, deletedAt: '2020-01-01', what: 'Hacked' });

      expect(res.status).toBe(501);
      const row = await prisma.repair.findUniqueOrThrow({
        where: { id: repair.id },
      });
      expect([row.what, row.deletedAt, row.costBani]).toEqual([
        'Schimb ulei',
        null,
        null,
      ]);
    },
  );

  it.each(methods)(
    '%s answers 400 from the body parser to a malformed JSON body and writes nothing',
    async (method) => {
      const { andrei } = await people();
      const golf = await world.car(andrei.id);
      const { repair } = await motorFixRepair(prisma, andrei.id, golf.id);

      const res = await call(method, andrei.auth, `/repairs/${repair.id}`)
        .set('Content-Type', 'application/json')
        .send('{"what":');

      expect(res.status).toBe(400);
      const row = await prisma.repair.findUniqueOrThrow({
        where: { id: repair.id },
      });
      expect(row.deletedAt).toBeNull();
    },
  );

  it.each(methods)(
    '%s answers 401 to a garbage token before any 409',
    async (method) => {
      const { andrei } = await people();
      const golf = await world.car(andrei.id);
      const { repair } = await motorFixRepair(prisma, andrei.id, golf.id);

      const res = await call(method, 'Bearer garbage', `/repairs/${repair.id}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    },
  );

  it.each(methods)(
    '%s lets the buyer reach the refusals for the repairs passed on to her, and a 404 for the rest',
    async (method) => {
      const { andrei, maria } = await people();
      const logan = await world.car(andrei.id);
      const { repair: motorfix } = await motorFixRepair(
        prisma,
        andrei.id,
        logan.id,
        { daysAgo: 100 },
      );
      const passed = await logged(logan.id, 300, 'Passed on');
      const kept = await logged(logan.id, 200, 'Kept back');
      await hand(andrei, maria, logan.id, [passed.id]);

      const onMotorfix = await call(
        method,
        maria.auth,
        `/repairs/${motorfix.id}`,
      );
      const onPassed = await call(method, maria.auth, `/repairs/${passed.id}`);
      const onKept = await call(method, maria.auth, `/repairs/${kept.id}`);

      expect([onMotorfix.status, onPassed.status, onKept.status]).toEqual([
        409, 501, 404,
      ]);
    },
  );

  it('writes no audit entry over twenty refusals', async () => {
    const { andrei } = await people();
    const golf = await world.car(andrei.id);
    const { repair } = await motorFixRepair(prisma, andrei.id, golf.id);
    const since = new Date();

    for (let n = 0; n < 10; n += 1) {
      await call('patch', andrei.auth, `/repairs/${repair.id}`);
      await call('delete', andrei.auth, `/repairs/${repair.id}`);
    }

    expect(
      await prisma.activityLog.count({ where: { at: { gte: since } } }),
    ).toBe(0);
  });
});
