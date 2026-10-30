import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import { APPROVAL_TIMERS_QUEUE, ApprovalTimers } from './approval-timers';
import { ApprovalTimersModule } from './approval-timers.module';
import { AuditService } from '../../../audit/audit.service';
import { outbox } from '../../../events/event.port';
import { NotificationsModule } from '../../../notifications/notifications.module';
import { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../../notifications/notifications.testing';
import { serialDatabase } from '../../serial-db.testing';
import { AssistantApprovals } from '../assistant-approvals';

const redisUrl = redisUrlFor(12);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);
const approvals = new AssistantApprovals(prisma, new AuditService(), outbox);

const jobs = new Queue(APPROVAL_TIMERS_QUEUE, {
  connection: { url: redisUrl },
});

const MINUTE = 60_000;
// 23:30 in Bucharest: a message that waits for the morning would be held.
const NIGHT = new Date('2026-10-29T21:30:00Z');
const WEB = 'https://motorfix.test';
// Push on, so an account with a device is told by push.
const PUSH = {
  privateKey: 'private',
  publicKey: 'public',
  subject: 'mailto:ops@example.test',
};

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
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
  await jobs.obliterate({ force: true });
});

// Compiled, never started: no worker takes the queue's jobs and no sweep is
// scheduled, so each case runs the timers itself.
async function start(now = NIGHT) {
  app = await Test.createTestingModule({
    imports: [
      ApprovalTimersModule.registerWorker({
        notifications: NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          push: PUSH,
          redisUrl,
        }),
        redisUrl,
        webUrl: WEB,
      }),
    ],
  }).compile();
  app.get(NotificationsService).now = () => now;
  const timers = app.get(ApprovalTimers);
  timers.now = () => now;
  return timers;
}

// A garage's approval, asked for by their assistant, with or without
// a push device.
async function asked(options: { device?: boolean } = {}) {
  const accountId = await account('Mihai', ['garage']);
  if (options.device) {
    await prisma.pushSubscription.create({
      data: {
        accountId,
        auth: 'a',
        endpoint: `https://push.example.test/${accountId}`,
        p256dh: 'p',
      },
    });
  }
  const { id: grantId } = await prisma.assistantGrant.create({
    data: {
      accountId,
      canAct: true,
      canRead: true,
      clientId: 'claude',
      clientName: 'Claude',
    },
  });
  const opened = await prisma.$transaction((tx) =>
    approvals.open(tx, {
      accountId,
      args: { shareHistory: true },
      editable: ['shareHistory'],
      grantId,
      kind: 'book',
      summary: 'Programare joi la 14:00.',
      tool: 'book_fixture',
    }),
  );
  // The job as the relay queues the request's event.
  const job = {
    data: {
      id: '41',
      kind: 'assistant_approval.requested',
      payload: { approvalId: opened.id },
      subjectId: opened.id,
    },
  };
  return { accountId, job, ...opened };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'ASSISTANT_APPROVAL_NEEDED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

const statusOf = async (id: string) =>
  (await prisma.assistantApproval.findUniqueOrThrow({ where: { id } })).status;

const decided = (id: string) =>
  prisma.outboxEvent.count({
    where: { kind: 'assistant_approval.decided', subjectId: id },
  });

// @traces 1254-FR-003
describe('an approval asked for, at the worker', () => {
  it('goes by push and into the bell for an account with a device, at night too', async () => {
    const a = await asked({ device: true });
    const timers = await start();

    await timers.onRequested(a.job);
    await timers.onRequested(a.job);

    expect(await channels(a.accountId)).toEqual(['in_app', 'push']);
    const rows = await messages(a.accountId);
    expect(rows.every((m) => m.status !== 'held')).toBe(true);
    expect(rows.every((m) => m.subjectId === a.id)).toBe(true);
  });

  it('goes by e-mail instead of push for an account with no device', async () => {
    const a = await asked();
    const timers = await start();

    await timers.onRequested(a.job);

    expect(await channels(a.accountId)).toEqual(['email', 'in_app']);
  });

  it('sets the expiry timer at the approval’s expiry', async () => {
    const a = await asked();
    const timers = await start();

    await timers.onRequested(a.job);

    const timer = await jobs.getJob(`assistant-approval-${a.id}`);
    expect(timer?.data).toEqual({ id: a.id });
    expect(timer?.opts.delay).toBe(
      Math.max(0, a.expiresAt.getTime() - NIGHT.getTime()),
    );
  });

  it('tells nothing and sets no timer for an approval already decided', async () => {
    const a = await asked();
    await prisma.assistantApproval.update({
      data: { decidedAt: new Date(), status: 'refused' },
      where: { id: a.id },
    });
    const timers = await start();

    await timers.onRequested(a.job);

    expect(await channels(a.accountId)).toEqual([]);
    expect(await jobs.getJob(`assistant-approval-${a.id}`)).toBeUndefined();
  });
});

// @traces 1254-FR-007
describe('the expiry of an approval nobody decided', () => {
  it('expires it when its timer fires at the expiry, once', async () => {
    const a = await asked();
    const timers = await start(new Date(a.expiresAt.getTime() + 1));

    await timers.fire(a.id, false);
    await timers.fire(a.id, false);

    expect(await statusOf(a.id)).toBe('expired');
    expect(await decided(a.id)).toBe(1);
  });

  it('leaves it pending when a timer fires early', async () => {
    const a = await asked();
    const timers = await start(new Date(a.expiresAt.getTime() - MINUTE));

    await timers.fire(a.id, false);

    expect(await statusOf(a.id)).toBe('pending');
    expect(await decided(a.id)).toBe(0);
  });

  it('expires it from the sweep within one sweep of a lost timer', async () => {
    const a = await asked();
    const sweptAt = new Date(a.expiresAt.getTime() + 5 * MINUTE);
    const timers = await start(sweptAt);

    expect(await timers.timers.sweep(sweptAt)).toBe(1);
    expect(await timers.timers.sweep(sweptAt)).toBe(0);

    expect(await statusOf(a.id)).toBe('expired');
    expect(await decided(a.id)).toBe(1);
  });

  it('changes nothing on an approval already decided', async () => {
    const a = await asked();
    await prisma.assistantApproval.update({
      data: { decidedAt: new Date(), status: 'approved' },
      where: { id: a.id },
    });
    const timers = await start(new Date(a.expiresAt.getTime() + MINUTE));

    await timers.fire(a.id, false);
    await timers.timers.sweep(new Date(a.expiresAt.getTime() + MINUTE));

    expect(await statusOf(a.id)).toBe('approved');
    expect(await decided(a.id)).toBe(0);
  });
});
