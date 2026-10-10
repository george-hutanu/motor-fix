import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import {
  VERIFICATION_RESULT_CONSUMER,
  VERIFICATION_RESULT_QUEUE,
  VerificationResultFanOut,
} from './verification-result.fan-out';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import { OutboxRelayModule } from '../../events/outbox-relay/outbox-relay.module';
import {
  type Decision,
  SYSTEM,
  VerificationService,
} from '../../garages/verification/verification.service';
import type { Prisma } from '../../generated/prisma/client';
import { until } from '../../waits.testing';
import { NotificationsModule } from '../notifications.module';
import { NotificationsProcessor } from '../notifications.processor';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';
import { REQUEST_RECEIVED_CONSUMER } from '../request-received/request-received.fan-out';
import { bellText } from '../templates';

const redisUrl = redisUrlFor(7);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_verification_result_total', { outcome });

const jobs = new Queue(VERIFICATION_RESULT_QUEUE, {
  connection: { url: redisUrl },
});

const pushConfig = {
  privateKey: 'private',
  publicKey: 'public',
  subject: 'mailto:ops@example.test',
};

const NOTE = 'Lipsește pagina 2 din <b>CUI</b> & avizul RAR';

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await jobs.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Brevo's address answers nothing, so every message stays as the fan-out
  // built it until a test sends it itself.
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
  await jobs.obliterate({ force: true });
});

async function start(withRelay = false) {
  app = await Test.createTestingModule({
    imports: [
      ...(withRelay
        ? [
            OutboxRelayModule.register({
              consumers: [VERIFICATION_RESULT_CONSUMER],
              databaseUrl,
              redisUrl,
            }),
          ]
        : []),
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        push: pushConfig,
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  return { fanOut: app.get(VerificationResultFanOut) };
}

const verification = (skipManualApproval = false) =>
  new VerificationService(new AuditService(), outbox, { skipManualApproval });

const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(fn);

const withDevice = (accountId: string) =>
  prisma.pushSubscription.create({
    data: {
      accountId,
      auth: 'a',
      endpoint: `https://push.example.test/${accountId}`,
      p256dh: 'p',
    },
  });

// A garage under review with a Romanian and an English owner, a
// receptionist and a mechanic who may answer quotes.
async function staffedGarage(key = 'dinamo') {
  const slug = `atelier-${key}-${randomUUID()}`;
  const garage = await prisma.garage.create({
    data: { name: `Atelier ${key}`, slug },
  });
  const owner = await account(`${key}-owner`, ['garage']);
  const english = await account(`${key}-owner-en`, ['garage'], {
    language: 'en',
  });
  const receptionist = await account(`${key}-reception`, ['garage']);
  const mechanic = await account(`${key}-mechanic`, ['mechanic']);
  await prisma.garageMember.createMany({
    data: [
      { accountId: owner, garageId: garage.id, role: 'owner' },
      { accountId: english, garageId: garage.id, role: 'owner' },
      { accountId: receptionist, garageId: garage.id, role: 'receptionist' },
    ],
  });
  await prisma.mechanic.create({
    data: {
      accountId: mechanic,
      canAnswerQuotes: true,
      garageId: garage.id,
      name: 'Mihai',
    },
  });
  const file = await prisma.verificationFile.create({
    data: { garageId: garage.id, status: 'in_review' },
  });
  return { english, file, garage, mechanic, owner, receptionist, slug };
}

// The newest event of `kind` on the file, and its job as the relay queues it.
async function jobOf(fileId: string, kind = 'verification.decided') {
  const event = await prisma.outboxEvent.findFirstOrThrow({
    orderBy: { id: 'desc' },
    where: { kind, subjectId: fileId },
  });
  return {
    event,
    job: {
      data: {
        id: String(event.id),
        kind: event.kind,
        payload: event.payload as never,
        subjectId: fileId,
      },
    },
  };
}

// The decision as the verification service records it.
async function decided(fileId: string, decision: Decision) {
  await inTx((tx) => verification().decide(tx, SYSTEM, fileId, decision));
  return jobOf(fileId);
}

const negative = (
  outcome: 'more_requested' | 'rejected',
  code = 'documents',
  note = NOTE,
): Decision => ({ outcome, reason: { code, note } });

const messages = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, fallbackOf: null, kind: 'VERIFICATION_RESULT' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

const emailOf = async (accountId: string) =>
  (await messages(accountId)).find((m) => m.channel === 'email');

// @traces 209-FR-001 209-FR-002
describe('telling a garage’s owners the verification result', () => {
  it('builds VERIFICATION_RESULT for each owner only, keyed by the event, about the file', async () => {
    const { english, file, mechanic, owner, receptionist } =
      await staffedGarage();
    const { event, job } = await decided(file.id, { outcome: 'approved' });
    const { fanOut } = await start();

    await fanOut.handle(job);

    for (const person of [owner, english]) {
      expect(await channels(person)).toEqual(['email', 'in_app']);
      for (const message of await messages(person)) {
        expect(message.subjectId).toBe(file.id);
        expect(message.eventId).toBe(String(event.id));
      }
    }
    expect(await messages(receptionist)).toEqual([]);
    expect(await messages(mechanic)).toEqual([]);
  });

  it('listens to verification.decided alone', () => {
    expect(VERIFICATION_RESULT_CONSUMER.kinds).toEqual([
      'verification.decided',
    ]);
  });

  it.each([
    'verification.reopened',
    'verification.submitted',
    'verification.opened',
  ])('builds nothing for a %s event handed to it', async (kind) => {
    const { file, owner } = await staffedGarage();
    await decided(file.id, { outcome: 'approved' });
    const { fanOut } = await start();
    await prisma.outboxEvent.create({
      data: {
        audience: [`garage:${file.garageId}`],
        kind,
        payload: { fileId: file.id, garageId: file.garageId },
        subjectId: file.id,
      },
    });
    const before = await counted('skipped');

    await fanOut.handle((await jobOf(file.id, kind)).job);

    expect(await messages(owner)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('builds nothing, without failing, for a garage with no owner or only deleted ones', async () => {
    const empty = await staffedGarage('gol');
    await prisma.garageMember.deleteMany({
      where: { garageId: empty.garage.id, role: 'owner' },
    });
    const deleted = await staffedGarage('sters');
    for (const id of [deleted.owner, deleted.english]) {
      await prisma.account.update({
        data: { status: 'deleted' },
        where: { id },
      });
    }
    const first = await decided(empty.file.id, { outcome: 'approved' });
    const second = await decided(deleted.file.id, { outcome: 'approved' });
    const { fanOut } = await start();
    const before = await counted('skipped');

    await expect(fanOut.handle(first.job)).resolves.toBeUndefined();
    await expect(fanOut.handle(second.job)).resolves.toBeUndefined();

    expect(
      await prisma.notification.count({
        where: { kind: 'VERIFICATION_RESULT' },
      }),
    ).toBe(0);
    expect(await counted('skipped')).toBe(before + 2);
  });
});

// @traces 209-FR-003 209-FR-006
describe('the approved message each owner gets', () => {
  it('reaches each owner in their own language, with the dashboard and their profile address', async () => {
    const { english, file, owner, slug } = await staffedGarage();
    const { job } = await decided(file.id, { outcome: 'approved' });
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect((await emailOf(owner))?.params).toEqual({
      decision: 'approved',
      link: 'https://motorfix.test/app/garage',
      profile: `https://motorfix.test/ro/garages/${slug}`,
    });
    expect((await emailOf(english))?.params).toEqual({
      decision: 'approved',
      link: 'https://motorfix.test/app/garage',
      profile: `https://motorfix.test/en/garages/${slug}`,
    });
    const bell = (await messages(owner)).find((m) => m.channel === 'in_app');
    expect(bellText('VERIFICATION_RESULT', 'ro', bell?.params as never)).toBe(
      'Service-ul tău e aprobat și pe hartă',
    );
  });

  // @traces 209-FR-015
  it('follows the test environment’s automatic approval of a submitted garage, naming no admin', async () => {
    const handled = jest.spyOn(VerificationResultFanOut.prototype, 'handle');
    const { file, owner } = await staffedGarage();
    await prisma.verificationFile.delete({ where: { id: file.id } });
    await start(true);

    await inTx((tx) => verification(true).submit(tx, SYSTEM, file.garageId));
    await until('the approval message', () => handled.mock.calls.length >= 1);
    await handled.mock.results[0].value;

    const email = await emailOf(owner);
    expect(email?.params).toMatchObject({ decision: 'approved' });
    expect(JSON.stringify(email?.params)).not.toMatch(/admin|system/i);
  });
});

// @traces 209-FR-004
describe('a message that is always sent', () => {
  it('still sends the e-mail and the bell to an owner who muted every channel, push by their choice', async () => {
    const { english, file, owner } = await staffedGarage();
    await withDevice(owner);
    await withDevice(english);
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: owner,
        channel,
        enabled: false,
        garageId: file.garageId,
        type: 'VERIFICATION_RESULT',
      })),
    });
    const { job } = await decided(file.id, { outcome: 'approved' });
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await channels(owner)).toEqual(['email', 'in_app']);
    expect(await channels(english)).toEqual(['email', 'in_app', 'push']);
  });
});

// @traces 209-FR-007 209-FR-008 209-FR-009 209-FR-010 209-FR-003
describe('the reason and the note', () => {
  it('gives a more-requested owner the label in their language and the note as typed', async () => {
    const { english, file, owner } = await staffedGarage();
    const { job } = await decided(file.id, negative('more_requested'));
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect((await emailOf(owner))?.params).toEqual({
      decision: 'more_requested',
      link: 'https://motorfix.test/app/garage',
      note: NOTE,
      reason: 'Documente',
    });
    expect((await emailOf(english))?.params).toMatchObject({
      note: NOTE,
      reason: 'Documents',
    });
  });

  it('names the RAR reason of a rejection and keeps the note word for word', async () => {
    const { file, owner } = await staffedGarage();
    const { job } = await decided(file.id, negative('rejected', 'rar'));
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect((await emailOf(owner))?.params).toMatchObject({
      decision: 'rejected',
      note: NOTE,
      reason: 'Autorizație RAR',
    });
  });

  it('gives a code it does not know the other label, the note intact', async () => {
    const { file, owner } = await staffedGarage();
    const { job } = await decided(file.id, negative('rejected', 'expired'));
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect((await emailOf(owner))?.params).toMatchObject({
      note: NOTE,
      reason: 'Alt motiv',
    });
  });

  it('keeps the note out of the bell', async () => {
    const { file, owner } = await staffedGarage();
    const { job } = await decided(file.id, negative('more_requested'));
    const { fanOut } = await start();

    await fanOut.handle(job);

    const bell = (await messages(owner)).find((m) => m.channel === 'in_app');
    expect(
      bellText('VERIFICATION_RESULT', 'ro', bell?.params as never),
    ).not.toContain('CUI');
  });
});

// @traces 209-FR-012
describe('one message per decision', () => {
  it('builds each message once when the same event is handled twice', async () => {
    const { file, owner } = await staffedGarage();
    const { job } = await decided(file.id, { outcome: 'approved' });
    const { fanOut } = await start();

    await fanOut.handle(job);
    await fanOut.handle(job);

    expect(await channels(owner)).toEqual(['email', 'in_app']);
  });

  it('builds a new message for a decision after a reopen, and nothing for the reopen', async () => {
    const { file, owner } = await staffedGarage();
    const first = await decided(file.id, { outcome: 'approved' });
    const { fanOut } = await start();
    await fanOut.handle(first.job);
    await inTx((tx) => verification().reopen(tx, SYSTEM, file.id));
    await fanOut.handle((await jobOf(file.id, 'verification.reopened')).job);
    expect(await channels(owner)).toEqual(['email', 'in_app']);

    const second = await decided(file.id, negative('rejected'));
    await fanOut.handle(second.job);

    expect(await channels(owner)).toEqual([
      'email',
      'email',
      'in_app',
      'in_app',
    ]);
  });

  it('retries a failed run 5 more times from a minute on, as the request fan-out does', () => {
    expect(VERIFICATION_RESULT_CONSUMER.jobs).toEqual(
      REQUEST_RECEIVED_CONSUMER.jobs,
    );
    expect(VERIFICATION_RESULT_CONSUMER.jobs).toMatchObject({
      attempts: 6,
      backoff: { delay: 60_000, type: 'exponential' },
    });
  });

  it('builds the message from the event the relay queued, once when relayed twice', async () => {
    const handled = jest.spyOn(VerificationResultFanOut.prototype, 'handle');
    const { file, owner } = await staffedGarage();
    const { event } = await decided(file.id, { outcome: 'approved' });
    await start(true);

    await until('the first run', () => handled.mock.calls.length >= 1);
    await handled.mock.results[0].value;
    await prisma.outboxEvent.update({
      data: { relayedAt: null },
      where: { id: event.id },
    });
    await until('the second run', () => handled.mock.calls.length >= 2);
    await handled.mock.results[1].value;

    expect(await channels(owner)).toEqual(['email', 'in_app']);
  });
});

// @traces 209-FR-013
describe('when the e-mail does not go', () => {
  it('fails the e-mail row, keeps the bell entry and leaves the file as decided', async () => {
    const { file, owner } = await staffedGarage();
    const { job } = await decided(file.id, negative('rejected', 'rar'));
    const { fanOut } = await start();
    await fanOut.handle(job);
    const email = await emailOf(owner);
    const processor = app?.get(NotificationsProcessor);

    // The last attempt against an address that answers nothing.
    await processor
      ?.handle({ attemptsMade: 5, data: { id: email?.id ?? '' }, name: 'send' })
      .catch(() => undefined);

    expect((await emailOf(owner))?.status).toBe('failed');
    const bell = (await messages(owner)).find((m) => m.channel === 'in_app');
    expect(bell).toBeDefined();
    expect(
      await prisma.verificationFile.findUniqueOrThrow({
        select: { reasonCode: true, reasonNote: true, status: true },
        where: { id: file.id },
      }),
    ).toEqual({ reasonCode: 'rar', reasonNote: NOTE, status: 'rejected' });
  });
});

// @traces 209-FR-014
describe('what the fan-out reports', () => {
  it('counts each decision told to owners as built', async () => {
    const { file } = await staffedGarage();
    const { job } = await decided(file.id, { outcome: 'approved' });
    const { fanOut } = await start();
    const before = await counted('built');

    await fanOut.handle(job);

    expect(await counted('built')).toBe(before + 1);
  });

  it('logs one line with the file, the decision and how many owners, and never the note or an address', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { file, slug } = await staffedGarage();
    const { job } = await decided(file.id, negative('rejected'));
    const { fanOut } = await start();
    log.mockClear();

    await fanOut.handle(job);

    const lines = log.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes(file.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('rejected');
    expect(lines[0]).toMatch(/\b2\b/);
    expect(lines[0]).not.toMatch(/CUI|@|motorfix\.test/);
    expect(lines[0]).not.toContain(slug);
  });
});
