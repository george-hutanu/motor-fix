import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { GarageReportDecidedFanOut } from './garage-report-decided.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { staffedGarage } from '../../garages/verification/suspension/suspension.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(12);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_garage_report_decided_notices_total', {
    outcome,
  });

const NOTE = 'Am sunat service-ul, prețurile sunt corecte.';
const REASON = 'Prețuri false confirmate la telefon';

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
});

async function start() {
  app = await Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        push: {
          privateKey: 'private',
          publicKey: 'public',
          subject: 'mailto:ops@example.test',
        },
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  return app.get(GarageReportDecidedFanOut);
}

// A garage reported by a Romanian and an English driver, the Romanian one
// listed twice as the decision's payload may name a reporter once per
// report, and the job the relay queues for the decision's event.
async function decided(decision: 'unfounded' | 'confirmed') {
  const garage = await staffedGarage(prisma, account);
  const elena = await account('Elena Dumitru', ['driver']);
  const john = await account('John Smith', ['driver'], { language: 'en' });
  const event = await prisma.outboxEvent.create({
    data: {
      audience: ['admin', `account:${elena}`, `account:${john}`],
      kind: 'garage_report.decided',
      payload: {
        decision,
        fileId: garage.id,
        garageId: garage.id,
        reporterIds: [elena, john, elena],
        reportIds: [],
      },
      subjectId: garage.id,
    },
  });
  const job = {
    data: {
      id: String(event.id),
      kind: event.kind,
      payload: event.payload as never,
      subjectId: garage.id,
    },
  };
  return { elena, event, garage, job, john };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, fallbackOf: null, kind: 'GARAGE_REPORT_DECIDED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

const bellOf = async (accountId: string) =>
  (await messages(accountId)).find((m) => m.channel === 'in_app');

const job = (
  base: { id: string; kind: string; subjectId: string },
  payload: Record<string, unknown>,
) => ({ data: { ...base, payload: payload as never } }) as never;

describe('the reporters’ message under hostile events', () => {
  // @traces 069-FR-007
  it('queues a bell message only to the ids that are accounts, ignoring junk entries', async () => {
    const { elena, garage, job: ok } = await decided('unfounded');
    const fanOut = await start();

    await fanOut.handle(
      job(ok.data, {
        decision: 'unfounded',
        garageId: garage.id,
        reporterIds: [elena, "x'; DROP TABLE account;--", 42, null, {}, ''],
      }),
    );

    expect(await channels(elena)).toEqual(['email', 'in_app']);
  });

  // @traces 069-FR-007
  it('tells nobody and counts a skip for an empty reporter list', async () => {
    const { garage, job: ok } = await decided('unfounded');
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(
      job(ok.data, {
        decision: 'unfounded',
        garageId: garage.id,
        reporterIds: [],
      }),
    );

    expect(await counted('skipped')).toBe(before + 1);
  });

  // @traces 069-FR-007
  it('tells nobody and counts a skip for a garage that no longer exists', async () => {
    const { elena, job: ok } = await decided('confirmed');
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(
      job(ok.data, {
        decision: 'confirmed',
        garageId: '00000000-0000-4000-8000-000000000000',
        reporterIds: [elena],
      }),
    );

    expect(await messages(elena)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  // @traces 069-FR-007
  it('tells nobody for a garage id that is not a uuid, without throwing', async () => {
    const { elena, job: ok } = await decided('confirmed');
    const fanOut = await start();

    await expect(
      fanOut.handle(
        job(ok.data, {
          decision: 'confirmed',
          garageId: 'not-a-uuid',
          reporterIds: [elena],
        }),
      ),
    ).resolves.toBeUndefined();

    expect(await messages(elena)).toEqual([]);
  });

  // @traces 069-FR-007
  it.each(['toString', '__proto__', 'constructor', 'UNFOUNDED', null, 7])(
    'refuses the decision %j as unknown',
    async (decision) => {
      const { elena, garage, job: ok } = await decided('unfounded');
      const fanOut = await start();

      await fanOut.handle(
        job(ok.data, { decision, garageId: garage.id, reporterIds: [elena] }),
      );

      expect(await messages(elena)).toEqual([]);
    },
  );

  // @traces 069-FR-007
  it('reads an empty payload without throwing', async () => {
    const { job: ok } = await decided('unfounded');
    const fanOut = await start();

    await expect(fanOut.handle(job(ok.data, {}))).resolves.toBeUndefined();
  });

  // @traces 069-FR-007
  it('passes on neither a note nor a reason that an event carries, only the three known params', async () => {
    const { elena, garage, job: ok } = await decided('confirmed');
    const fanOut = await start();

    await fanOut.handle(
      job(ok.data, {
        decision: 'confirmed',
        garageId: garage.id,
        note: NOTE,
        reason: REASON,
        reporterIds: [elena],
      }),
    );

    const bell = await bellOf(elena);
    expect(Object.keys((bell?.params ?? {}) as object).sort()).toEqual([
      'decision',
      'garage',
      'profile',
    ]);
    expect(JSON.stringify(bell?.params)).not.toContain(REASON);
    expect(JSON.stringify(bell?.params)).not.toContain(NOTE);
  });

  // @traces 069-FR-007
  it('builds a message for each of three hundred reporters once', async () => {
    const { garage, job: ok } = await decided('unfounded');
    // One at a time: three hundred sign-up transactions at once outwait the
    // connection pool on a slow runner.
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) ids.push(await account(`Driver ${i}`));
    const fanOut = await start();
    const event = {
      decision: 'unfounded',
      garageId: garage.id,
      reporterIds: [...ids, ...ids],
    };

    await fanOut.handle(job(ok.data, event));
    await fanOut.handle(job(ok.data, event));

    const bells = await prisma.notification.count({
      where: {
        accountId: { in: ids },
        channel: 'in_app',
        kind: 'GARAGE_REPORT_DECIDED',
      },
    });
    expect(bells).toBe(300);
  });

  // @traces 069-FR-007
  it('tells a reporter who is also an owner of the garage only as a reporter, once', async () => {
    const { garage, job: ok } = await decided('confirmed');
    const fanOut = await start();

    await fanOut.handle(
      job(ok.data, {
        decision: 'confirmed',
        garageId: garage.id,
        reporterIds: [garage.ownerId],
      }),
    );

    expect((await bellOf(garage.ownerId))?.params).toMatchObject({
      decision: 'confirmed',
    });
    expect(await messages(garage.receptionistId)).toEqual([]);
  });
});
