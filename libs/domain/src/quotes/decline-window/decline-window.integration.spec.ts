import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import {
  DECLINE_WINDOW_CONSUMER,
  DECLINE_WINDOW_QUEUE,
  DeclineWindow,
} from './decline-window';
import { DeclineWindowModule } from './decline-window.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhone,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { quotesWorld } from '../quotes.testing';

const redisUrl = redisUrlFor(12);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string, sweep = 'false') =>
  counterTotal(reader, 'motorfix_decline_windows_closed_total', {
    outcome,
    sweep,
  });

const jobs = new Queue(DECLINE_WINDOW_QUEUE, {
  connection: { url: redisUrl },
});

const MINUTE = 60_000;
// Noon in Bucharest, so nothing waits for the morning.
const NOON = new Date('2026-10-09T09:00:00Z');
const WEB = 'https://motorfix.test';

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

// Compiled, never started: no worker takes the queue's jobs and no sweep
// is scheduled, so each case runs the window itself.
async function start() {
  app = await Test.createTestingModule({
    imports: [
      DeclineWindowModule.registerWorker({
        notifications: NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          redisUrl,
        }),
        redisUrl,
        webUrl: WEB,
      }),
    ],
  }).compile();
  app.get(NotificationsService).now = () => NOON;
  const window = app.get(DeclineWindow);
  window.now = () => NOON;
  return window;
}

// A driver's request Atelier Dinamo declined `ago` before noon.
async function declined(
  ago = 5 * MINUTE,
  options: {
    language?: 'ro' | 'en';
    status?: 'sent' | 'quoted' | 'closed';
  } = {},
) {
  const driverId = await account('Ioana Popescu', ['driver'], {
    email: 'driver@example.test',
    language: options.language,
  });
  await prisma.account.update({
    data: { phone: testPhone(8), phoneVerifiedAt: new Date() },
    where: { id: driverId },
  });
  const garage = await world.garage('Atelier Dinamo');
  const request = await world.request(driverId, {
    status: options.status ?? 'sent',
  });
  const at = new Date(NOON.getTime() - ago);
  const recipient = await prisma.requestRecipient.create({
    data: {
      answeredAt: at,
      declinedAt: at,
      declineReason: 'make_model_engine_not_done',
      garageId: garage.id,
      requestId: request.id,
      source: 'search',
      status: 'declined',
    },
  });
  // The job as the relay queues the decline's event.
  const job = {
    data: {
      id: '41',
      kind: 'request.declined',
      payload: {
        driverId,
        garageId: garage.id,
        reason: 'make_model_engine_not_done',
        recipientId: recipient.id,
        requestId: request.id,
      },
      subjectId: recipient.id,
    },
  };
  return { at, driverId, garage, job, recipient, request };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'REQUEST_DECLINED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

const toldAt = async (id: string) =>
  (await prisma.requestRecipient.findUniqueOrThrow({ where: { id } }))
    .declineToldAt;

// @traces 345-decline-request-FR-007
describe('the decline-window timer', () => {
  it('relays request.declined to the quote-timers queue', () => {
    expect(DECLINE_WINDOW_CONSUMER).toMatchObject({
      kinds: ['request.declined'],
      queue: 'quote-timers',
    });
  });

  it('is set from the event at declined_at plus 5 minutes, carrying only the recipient id', async () => {
    const { job, recipient } = await declined(MINUTE);
    const window = await start();

    await window.onDeclined(job);

    const timer = await jobs.getJob(`decline-window-${recipient.id}`);
    expect(timer).toMatchObject({
      data: { id: recipient.id },
      name: 'decline-window',
    });
    expect(timer?.opts.delay).toBe(4 * MINUTE);
  });

  it('is replaced, not doubled, when the event comes again', async () => {
    const { job } = await declined(MINUTE);
    const window = await start();

    await window.onDeclined(job);
    await window.onDeclined(job);

    expect(await jobs.getJobs(['delayed', 'waiting'])).toHaveLength(1);
  });

  it('ignores the window-close event it records itself', async () => {
    const { job } = await declined(MINUTE);
    const window = await start();

    await window.onDeclined({
      data: {
        ...job.data,
        payload: { ...job.data.payload, windowClosed: true },
      },
    });

    expect(await jobs.getJobs(['delayed', 'waiting'])).toHaveLength(0);
  });
});

// @traces 345-decline-request-FR-008
// @traces 345-decline-request-FR-009
// @traces 345-decline-request-FR-020
describe('closing the decline window', () => {
  it('tells the driver once, for a decline 5 minutes old, and marks the recipient told', async () => {
    const { driverId, recipient } = await declined(5 * MINUTE);
    const window = await start();
    const before = await counted('sent');

    await window.fire(recipient.id, false);

    expect(await channels(driverId)).toEqual(['email', 'in_app']);
    expect(await toldAt(recipient.id)).not.toBeNull();
    expect(await counted('sent')).toBe(before + 1);
  });

  it('carries the garage’s name, the reason and the link to the driver’s request, nothing else', async () => {
    const { driverId, recipient, request } = await declined();
    const window = await start();

    await window.fire(recipient.id, false);

    const [email] = (await messages(driverId)).filter(
      (m) => m.channel === 'email',
    );
    expect(email.params).toEqual({
      garage: 'Atelier Dinamo',
      link: `${WEB}/app/driver/requests/${request.id}`,
      reason: 'make_model_engine_not_done',
    });
    expect(email.subjectId).toBe(recipient.id);
    const all = JSON.stringify(await messages(driverId));
    expect(all).not.toContain(testPhone(8));
    expect(all).not.toContain('B123ABC');
  });

  it('records one window-close request.declined for the driver alone', async () => {
    const { driverId, garage, recipient, request } = await declined();
    const window = await start();

    await window.fire(recipient.id, false);

    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'request.declined',
      payload: {
        driverId,
        garageId: garage.id,
        reason: 'make_model_engine_not_done',
        recipientId: recipient.id,
        requestId: request.id,
        windowClosed: true,
      },
      subjectId: recipient.id,
    });
    expect([...events[0].audience]).toEqual([`account:${driverId}`]);
  });

  it('tells nothing a second time when the timer fires again or the sweep runs', async () => {
    const { driverId, recipient } = await declined();
    const window = await start();
    const before = await counted('already_told');

    await window.fire(recipient.id, false);
    await window.fire(recipient.id, false);
    await window.timers.sweep(NOON);

    expect(await channels(driverId)).toEqual(['email', 'in_app']);
    expect(await prisma.outboxEvent.count()).toBe(1);
    expect(await counted('already_told')).toBe(before + 1);
  });

  it('tells nothing for a decline under 5 minutes old, which the sweep leaves too', async () => {
    const { driverId, recipient } = await declined(5 * MINUTE - 1_000);
    const window = await start();

    expect(await window.overdue(NOON)).toEqual([]);
    await window.fire(recipient.id, false);

    expect(await messages(driverId)).toEqual([]);
    expect(await toldAt(recipient.id)).toBeNull();
  });

  it('tells nothing for an undone decline', async () => {
    const { driverId, recipient } = await declined();
    await prisma.requestRecipient.update({
      data: {
        answeredAt: null,
        declinedAt: null,
        declinedBy: null,
        declineReason: null,
        status: 'waiting',
      },
      where: { id: recipient.id },
    });
    const window = await start();
    const before = await counted('skipped_undone');

    await window.fire(recipient.id, false);

    expect(await messages(driverId)).toEqual([]);
    expect(await toldAt(recipient.id)).toBeNull();
    expect(await counted('skipped_undone')).toBe(before + 1);
  });

  it('tells nothing for a decline re-made after an undo, until its own 5 minutes pass', async () => {
    const { driverId, recipient } = await declined(MINUTE);
    const window = await start();

    await window.fire(recipient.id, false);

    expect(await messages(driverId)).toEqual([]);
    expect(await toldAt(recipient.id)).toBeNull();
  });

  it('marks the recipient told and tells nothing once the request has closed', async () => {
    const { driverId, recipient } = await declined(5 * MINUTE, {
      status: 'closed',
    });
    const window = await start();
    const before = await counted('skipped_closed');

    await window.fire(recipient.id, false);

    expect(await messages(driverId)).toEqual([]);
    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(await toldAt(recipient.id)).not.toBeNull();
    expect(await counted('skipped_closed')).toBe(before + 1);
  });

  it('marks the recipient told when the driver muted every outside channel', async () => {
    const { driverId, recipient } = await declined();
    await prisma.notificationPreference.create({
      data: {
        accountId: driverId,
        channel: 'email',
        enabled: false,
        type: 'REQUEST_DECLINED',
      },
    });
    const window = await start();
    const before = await counted('muted');

    await window.fire(recipient.id, false);

    expect(await channels(driverId)).toEqual(['in_app']);
    expect(await toldAt(recipient.id)).not.toBeNull();
    expect(await counted('muted')).toBe(before + 1);
  });

  it('sends a late window once from the sweep', async () => {
    const { driverId, recipient } = await declined(40 * MINUTE);
    const window = await start();
    const before = await counted('sent', 'true');

    expect(await window.overdue(NOON)).toEqual([recipient.id]);
    await window.timers.sweep(NOON);
    await window.timers.sweep(NOON);

    expect(await channels(driverId)).toEqual(['email', 'in_app']);
    expect(await counted('sent', 'true')).toBe(before + 1);
    expect(await window.overdue(NOON)).toEqual([]);
  });

  it('logs one line with the recipient id and nothing about the driver or the garage', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { recipient } = await declined();
    const window = await start();
    log.mockClear();

    await window.fire(recipient.id, false);

    const lines = log.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes(recipient.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/Ioana|Dinamo|B123ABC/);
  });
});
