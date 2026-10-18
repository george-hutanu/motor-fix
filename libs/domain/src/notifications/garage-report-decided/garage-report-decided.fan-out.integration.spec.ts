import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  GARAGE_REPORT_DECIDED_CONSUMER,
  GarageReportDecidedFanOut,
} from './garage-report-decided.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { staffedGarage } from '../../garages/verification/suspension/suspension.testing';
import { bellLink } from '../bell/bell.link';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';
import { bellText } from '../templates';

// @traces 069-report-decision-FR-007 069-report-decision-FR-012

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

describe('telling the reporters what MotorFix made of their reports', () => {
  it('listens to garage_report.decided alone', () => {
    expect(GARAGE_REPORT_DECIDED_CONSUMER.kinds).toEqual([
      'garage_report.decided',
    ]);
    expect(GARAGE_REPORT_DECIDED_CONSUMER.queue).toBe('garage-report-decided');
  });

  it('builds one GARAGE_REPORT_DECIDED per distinct reporter, keyed by the event, and nothing for the garage', async () => {
    const { elena, event, garage, job, john } = await decided('unfounded');
    const fanOut = await start();
    const before = await counted('built');

    await fanOut.handle(job);

    for (const person of [elena, john]) {
      expect(await channels(person)).toEqual(['email', 'in_app']);
      for (const message of await messages(person)) {
        expect(message.eventId).toBe(String(event.id));
        expect(message.subjectId).toBe(garage.id);
      }
    }
    for (const staff of [garage.ownerId, garage.receptionistId]) {
      expect(await messages(staff)).toEqual([]);
    }
    expect(await counted('built')).toBe(before + 1);
  });

  it.each([
    [
      'unfounded',
      'Am verificat sesizarea ta despre Atelier Dinamo. Nu a fost nevoie de nicio măsură.',
      'We checked your report about Atelier Dinamo. No action was needed.',
    ],
    [
      'confirmed',
      'Am verificat sesizarea ta despre Atelier Dinamo și am luat măsuri.',
      'We checked your report about Atelier Dinamo and took action.',
    ],
  ] as const)(
    'words a decision %s in each reporter’s language',
    async (decision, ro, en) => {
      const { elena, job, john } = await decided(decision);
      const fanOut = await start();

      await fanOut.handle(job);

      const romanian = await bellOf(elena);
      const english = await bellOf(john);
      expect(
        bellText('GARAGE_REPORT_DECIDED', 'ro', romanian?.params as never),
      ).toBe(ro);
      expect(
        bellText('GARAGE_REPORT_DECIDED', 'en', english?.params as never),
      ).toBe(en);
    },
  );

  it('carries the garage, the decision and its public profile, never the note or the reason', async () => {
    const { elena, garage, job, john } = await decided('confirmed');
    const fanOut = await start();

    await fanOut.handle(job);

    const all = [...(await messages(elena)), ...(await messages(john))];
    expect(all.length).toBeGreaterThan(0);
    for (const message of all) {
      const text = JSON.stringify(message.params);
      expect(text).not.toContain(NOTE);
      expect(text).not.toContain(REASON);
    }
    expect((await bellOf(elena))?.params).toEqual({
      decision: 'confirmed',
      garage: garage.name,
      profile: `https://motorfix.test/ro/garages/${garage.slug}`,
    });
    expect((await bellOf(john))?.params).toMatchObject({
      profile: `https://motorfix.test/en/garages/${garage.slug}`,
    });
  });

  it('opens the garage’s public profile from the bell', async () => {
    const { elena, garage, job } = await decided('unfounded');
    const fanOut = await start();

    await fanOut.handle(job);

    const bell = await bellOf(elena);
    expect(
      bellLink({
        kind: 'GARAGE_REPORT_DECIDED',
        params: bell?.params,
        subjectId: bell?.subjectId ?? null,
      }),
    ).toBe(`/ro/garages/${garage.slug}`);
  });

  it('sends only the bell to a reporter who turned the type off', async () => {
    const { elena, job, john } = await decided('unfounded');
    await prisma.notificationPreference.create({
      data: {
        accountId: elena,
        channel: 'email',
        enabled: false,
        type: 'GARAGE_REPORT_DECIDED',
      },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(elena)).toEqual(['in_app']);
    expect(await channels(john)).toEqual(['email', 'in_app']);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { elena, job } = await decided('unfounded');
    const fanOut = await start();

    await fanOut.handle(job);
    await fanOut.handle(job);

    expect(await channels(elena)).toEqual(['email', 'in_app']);
  });

  it('tells no reporter whose account is deleted', async () => {
    const { elena, job, john } = await decided('unfounded');
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: elena },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await messages(elena)).toEqual([]);
    expect(await channels(john)).toEqual(['email', 'in_app']);
  });

  it.each([
    ['no garage id', { decision: 'unfounded', garageId: undefined }],
    ['an unknown decision', { decision: 'maybe' }],
    [
      'reporters that are not a list',
      { decision: 'unfounded', reporterIds: 7 },
    ],
  ])('tells nobody and counts a skip for %s', async (_, payload) => {
    const { elena, garage, job } = await decided('unfounded');
    const fanOut = await start();
    const before = await counted('skipped');

    await expect(
      fanOut.handle({
        data: {
          ...job.data,
          payload: { garageId: garage.id, ...payload } as never,
        },
      }),
    ).resolves.toBeUndefined();

    expect(await messages(elena)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('logs one line with the garage, the decision and how many reporters, never a name', async () => {
    const { garage, job } = await decided('confirmed');
    const log = jest.spyOn(Logger.prototype, 'log');
    const fanOut = await start();

    await fanOut.handle(job);

    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes(garage.id));
    expect(lines).toEqual([
      `garage ${garage.id} reports confirmed told to 2 reporters`,
    ]);
  });
});
