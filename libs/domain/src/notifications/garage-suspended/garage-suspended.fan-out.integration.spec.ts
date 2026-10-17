import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  GARAGE_SUSPENDED_CONSUMER,
  GarageSuspendedFanOut,
} from './garage-suspended.fan-out';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import { SuspensionService } from '../../garages/verification/suspension/suspension.service';
import { staffedGarage } from '../../garages/verification/suspension/suspension.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';
import { bellText } from '../templates';

// @traces 049-FR-010 049-FR-014 049-FR-015

const redisUrl = redisUrlFor(12);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_garage_suspended_notices_total', { outcome });

const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';
const SYSTEM = { accountId: null, role: 'system' } as const;

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
  return app.get(GarageSuspendedFanOut);
}

// A suspended garage with a Romanian and an English owner, and the job the
// relay queues for its event.
async function suspended(cause: Parameters<SuspensionService['suspend']>[2]) {
  const garage = await staffedGarage(prisma, account);
  const english = await account('Elena Owner', ['garage'], { language: 'en' });
  await prisma.garageMember.create({
    data: { accountId: english, garageId: garage.id, role: 'owner' },
  });
  await new SuspensionService(prisma, new AuditService(), outbox).suspend(
    SYSTEM,
    garage.id,
    cause,
    REASON,
  );
  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: { kind: 'garage.suspended', subjectId: garage.id },
  });
  const job = {
    data: {
      id: String(event.id),
      kind: event.kind,
      payload: event.payload as never,
      subjectId: garage.id,
    },
  };
  return { english, event, garage, job };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, fallbackOf: null, kind: 'GARAGE_SUSPENDED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

const emailOf = async (accountId: string) =>
  (await messages(accountId)).find((m) => m.channel === 'email');

const withDevice = (accountId: string) =>
  prisma.pushSubscription.create({
    data: {
      accountId,
      auth: 'a',
      endpoint: `https://push.example.test/${accountId}`,
      p256dh: 'p',
    },
  });

describe('telling a suspended garage’s owners', () => {
  it('listens to garage.suspended alone', () => {
    expect(GARAGE_SUSPENDED_CONSUMER.kinds).toEqual(['garage.suspended']);
    expect(GARAGE_SUSPENDED_CONSUMER.queue).toBe('garage-suspended');
  });

  it('builds one GARAGE_SUSPENDED for each owner only, keyed by the event', async () => {
    const { english, event, garage, job } = await suspended('recheck_failed');
    const fanOut = await start();
    const before = await counted('built');

    await fanOut.handle(job);

    for (const person of [garage.ownerId, english]) {
      expect(await channels(person)).toEqual(['email', 'in_app']);
      for (const message of await messages(person)) {
        expect(message.eventId).toBe(String(event.id));
        expect(message.subjectId).toBe(garage.id);
      }
    }
    expect(await messages(garage.receptionistId)).toEqual([]);
    expect(await messages(garage.mechanicId)).toEqual([]);
    expect(await messages(garage.driverId)).toEqual([]);
    expect(await counted('built')).toBe(before + 1);
  });

  it('reaches each owner in their own language with the reason, the next step and the dashboard', async () => {
    const { english, garage, job } = await suspended('documents_overdue');
    const fanOut = await start();

    await fanOut.handle(job);

    expect((await emailOf(garage.ownerId))?.params).toEqual({
      garage: garage.name,
      link: 'https://motorfix.test/app/garage',
      next: 'încarcă documentele anuale.',
      reason: REASON,
    });
    expect((await emailOf(english))?.params).toMatchObject({
      next: 'upload the yearly documents.',
      reason: REASON,
    });
    const bell = (await messages(garage.ownerId)).find(
      (m) => m.channel === 'in_app',
    );
    expect(bellText('GARAGE_SUSPENDED', 'ro', bell?.params as never)).toContain(
      REASON,
    );
  });

  it('reads the cause and the reason from the open suspension, not the event', async () => {
    const { garage, job } = await suspended('admin');
    await prisma.garageSuspension.updateMany({
      data: { reason: 'Motiv corectat' },
      where: { garageId: garage.id },
    });
    const fanOut = await start();

    await fanOut.handle({
      data: {
        ...job.data,
        payload: { cause: 'recheck_failed', garageId: garage.id } as never,
      },
    });

    expect((await emailOf(garage.ownerId))?.params).toMatchObject({
      next: 'răspunde echipei MotorFix.',
      reason: 'Motiv corectat',
    });
  });

  it('still sends the e-mail and the bell to an owner who muted every channel, push by their choice', async () => {
    const { english, garage, job } = await suspended('recheck_failed');
    await withDevice(garage.ownerId);
    await withDevice(english);
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: garage.ownerId,
        channel,
        enabled: false,
        garageId: garage.id,
        type: 'GARAGE_SUSPENDED',
      })),
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(garage.ownerId)).toEqual(['email', 'in_app']);
    expect(await channels(english)).toEqual(['email', 'in_app', 'push']);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { garage, job } = await suspended('recheck_failed');
    const fanOut = await start();

    await fanOut.handle(job);
    await fanOut.handle(job);

    expect(await channels(garage.ownerId)).toEqual(['email', 'in_app']);
  });

  it.each([
    ['no garage id', {}],
    ['a garage id that is not text', { garageId: 42 }],
  ])('tells nobody and counts a skip for %s', async (_, payload) => {
    const { garage, job } = await suspended('recheck_failed');
    const fanOut = await start();
    const before = await counted('skipped');

    await expect(
      fanOut.handle({ data: { ...job.data, payload: payload as never } }),
    ).resolves.toBeUndefined();

    expect(await messages(garage.ownerId)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('tells nobody once the suspension has ended before the message is built', async () => {
    const { garage, job } = await suspended('recheck_failed');
    await prisma.garageSuspension.updateMany({
      data: { untilTime: new Date() },
      where: { garageId: garage.id },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await messages(garage.ownerId)).toEqual([]);
  });

  it('logs one line with the garage, the cause and how many owners, never the reason', async () => {
    const { garage, job } = await suspended('recheck_failed');
    const log = jest.spyOn(Logger.prototype, 'log');
    const fanOut = await start();

    await fanOut.handle(job);

    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes(garage.id));
    expect(lines).toEqual([
      `garage ${garage.id} suspended (recheck_failed) told to 2 owners`,
    ]);
  });
});
