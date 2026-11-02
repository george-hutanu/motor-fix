import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { MockInstance } from 'vitest';

import { ACCOUNT_CLOSED_CONSUMER, AccountClosed } from './account-closed';
import { AccountClosedModule } from './account-closed.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
import type { JobStatus } from '../../generated/prisma/enums';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { quotesWorld } from '../quotes.testing';

const redisUrl = redisUrlFor(10);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const reader = countedMetrics();
const cleanups = (kind: string, outcome: string) =>
  counterTotal(reader, 'motorfix_account_closed_cleanups_total', {
    kind,
    outcome,
  });

const NOW = new Date();
const SECOND = 1000;

let app: TestingModule | undefined;
let log: MockInstance;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
});

// Compiled, never started: no worker takes the queue, so each case hands the
// handler its event itself.
async function start() {
  app = await Test.createTestingModule({
    imports: [
      AccountClosedModule.registerWorker({
        notifications: NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          redisUrl,
        }),
        redisUrl,
      }),
    ],
  }).compile();
  const handler = app.get(AccountClosed);
  handler.now = () => NOW;
  return handler;
}

// The job as the outbox relay queues it; nothing records the account events
// yet, so the case builds it.
const closing = (
  accountId: string,
  kind = 'account.deleted',
  id = String(Math.floor(Math.random() * 1e9)),
) => ({ data: { id, kind, payload: { accountId }, subjectId: accountId } });

async function newEvents(mark: bigint) {
  return prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { id: { gt: mark } },
  });
}

const statusOf = async (
  table: 'quoteRequest' | 'requestRecipient' | 'quote' | 'booking' | 'job',
  id: string,
) =>
  (
    await (
      prisma[table] as unknown as {
        findUniqueOrThrow(args: object): Promise<{ status: string }>;
      }
    ).findUniqueOrThrow({ where: { id } })
  ).status;

// Andrei's request out to three garages: two have not answered, the third
// has quoted and waits for his answer.
async function outToThree() {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const [g1, g2, g3] = await Promise.all(
    ['Atelier Dinamo', 'Service Nord', 'Garaj Sud'].map((n) => world.garage(n)),
  );
  const request = await world.request(driverId, { status: 'quoted' });
  const r1 = await world.recipient(request.id, g1.id);
  const r2 = await world.recipient(request.id, g2.id);
  const quote = await world.quote(request.id, g3.id, 'waiting');
  const r3 = await prisma.requestRecipient.findUniqueOrThrow({
    where: { requestId_garageId: { garageId: g3.id, requestId: request.id } },
  });
  return { driverId, garages: [g1, g2, g3], quote, r1, r2, r3, request };
}

// Andrei's booked request at Atelier Dinamo, with Fixer on the booking.
async function bookedAt(
  options: {
    booking?: 'confirmed' | 'awaiting_confirmation';
    job?: JobStatus;
  } = {},
) {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Atelier Dinamo');
  const fixer = await prisma.mechanic.create({
    data: { canAnswerQuotes: false, garageId: garage.id, name: 'Fixer' },
  });
  const { booking, quote, request } = await world.chain(driverId, garage.id, {
    booking: options.booking ?? 'confirmed',
  });
  await prisma.booking.update({
    data: { mechanicId: fixer.id },
    where: { id: booking.id },
  });
  const job = options.job
    ? await world.job(booking.id, options.job, { mechanicId: fixer.id })
    : undefined;
  return { booking, driverId, fixer, garage, job, quote, request };
}

// @traces 428-FR-001
describe('listening to a closed account', () => {
  it('takes account.deleted and account.suspended on its own queue, never account.restored', () => {
    expect(ACCOUNT_CLOSED_CONSUMER.queue).toBe('account-closed');
    expect([...ACCOUNT_CLOSED_CONSUMER.kinds].sort()).toEqual([
      'account.deleted',
      'account.suspended',
    ]);
  });

  // @traces 428-FR-008
  it('retries a failed job three times, waiting longer each time', () => {
    expect(ACCOUNT_CLOSED_CONSUMER.jobs).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential' },
    });
  });
});

// @traces 428-FR-002 428-FR-003 428-FR-006 428-FR-013
describe('closing the open requests of a closed account', () => {
  it('closes the request, its waiting recipients and its waiting quote, and leaves the quoted recipient quoted', async () => {
    const { garages, quote, r1, r2, r3, request, driverId } =
      await outToThree();
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId));

    const closed = await prisma.quoteRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(closed).toMatchObject({
      closedReason: 'account_closed',
      status: 'closed',
    });
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(await statusOf('requestRecipient', r1.id)).toBe('closed');
    expect(await statusOf('requestRecipient', r2.id)).toBe('closed');
    expect(await statusOf('requestRecipient', r3.id)).toBe('quoted');
    expect(await statusOf('quote', quote.id)).toBe('lost');

    const events = await newEvents(mark);
    expect(events.map((e) => e.kind)).toEqual(['request.cancelled']);
    const [event] = events;
    expect(event.subjectId).toBe(request.id);
    const payload = event.payload as { garageIds: string[] };
    expect(event.payload).toMatchObject({
      reason: 'account_closed',
      requestId: request.id,
    });
    expect([...payload.garageIds].sort()).toEqual(
      garages.map((g) => g.id).sort(),
    );
    expect(event.audience).toEqual(
      expect.arrayContaining([
        `account:${driverId}`,
        ...garages.map((g) => `garage:${g.id}`),
      ]),
    );
  });

  it('files every change as MotorFix’s own, once per row', async () => {
    const { quote, r1, r2, request, driverId } = await outToThree();
    const handler = await start();

    await handler.onEvent(closing(driverId));

    const entries = await prisma.activityLog.findMany({
      where: {
        field: 'status',
        subjectId: { in: [request.id, r1.id, r2.id, quote.id] },
      },
    });
    expect(entries).toHaveLength(4);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        actorId: null,
        actorName: 'MotorFix',
        actorRole: 'system',
      });
    }
  });

  it('closes each of two open requests apart, each with its own event', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const garage = await world.garage('Atelier Dinamo');
    const first = await world.request(driverId);
    const second = await world.request(driverId);
    await world.recipient(first.id, garage.id);
    await world.recipient(second.id, garage.id);
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId));

    expect(await statusOf('quoteRequest', first.id)).toBe('closed');
    expect(await statusOf('quoteRequest', second.id)).toBe('closed');
    const events = await newEvents(mark);
    expect(events.map((e) => e.subjectId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('closes a quoted request whose only quote waits, and marks the quote lost', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const garage = await world.garage('Atelier Dinamo');
    const request = await world.request(driverId, { status: 'quoted' });
    const quote = await world.quote(request.id, garage.id, 'waiting');
    const handler = await start();

    await handler.onEvent(closing(driverId));

    expect(await statusOf('quoteRequest', request.id)).toBe('closed');
    expect(await statusOf('quote', quote.id)).toBe('lost');
  });

  it('still records the event for a request no garage holds any more', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const request = await world.request(driverId);
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId));

    const [event] = await newEvents(mark);
    expect(event.payload).toMatchObject({
      garageIds: [],
      requestId: request.id,
    });
  });

  it('writes nothing for an account that does not exist', async () => {
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(randomUUID()));

    expect(await newEvents(mark)).toEqual([]);
  });

  it('touches only what the account asked for as a driver, never its garage’s side', async () => {
    const both = await account('Ion Dinamo', ['driver', 'garage']);
    const garage = await world.garage('Atelier Dinamo');
    await prisma.garageMember.create({
      data: { accountId: both, garageId: garage.id, role: 'owner' },
    });
    const own = await world.request(both);
    const other = await account('Maria Pop', ['driver']);
    const theirs = await world.request(other);
    const desk = await world.recipient(theirs.id, garage.id);
    const handler = await start();

    await handler.onEvent(closing(both));

    expect(await statusOf('quoteRequest', own.id)).toBe('closed');
    expect(await statusOf('quoteRequest', theirs.id)).toBe('sent');
    expect(await statusOf('requestRecipient', desk.id)).toBe('waiting');
  });
});

// @traces 223-FR-004
describe('telling only the garages still waiting', () => {
  it('names the waiting recipient and the waiting quote’s garage, not the declined one nor the ended quote’s', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const [waits, quoted, declined, ended] = await Promise.all(
      ['Atelier Dinamo', 'Service Nord', 'Garaj Sud', 'Service Vest'].map((n) =>
        world.garage(n),
      ),
    );
    const request = await world.request(driverId, { status: 'quoted' });
    await world.recipient(request.id, waits.id);
    await world.quote(request.id, quoted.id, 'waiting');
    await world.recipient(request.id, declined.id, 'declined');
    await world.quote(request.id, ended.id, 'expired');
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId));

    const [event] = (await newEvents(mark)).filter(
      (e) => e.kind === 'request.cancelled',
    );
    const payload = event.payload as { garageIds: string[] };
    expect([...payload.garageIds].sort()).toEqual([waits.id, quoted.id].sort());
    expect(event.audience).toEqual(
      expect.arrayContaining(
        [waits, quoted, ended].map((g) => `garage:${g.id}`),
      ),
    );
  });

  it('still records the event with no garage when none waits', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const garage = await world.garage('Service Vest');
    const request = await world.request(driverId, { status: 'quoted' });
    await world.quote(request.id, garage.id, 'expired');
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId));

    const [event] = await newEvents(mark);
    expect(event.kind).toBe('request.cancelled');
    expect(event.payload).toMatchObject({
      garageIds: [],
      requestId: request.id,
    });
  });
});

// @traces 428-FR-004 428-FR-006
describe('cancelling the future bookings of a closed account', () => {
  it('cancels a confirmed booking as the system, with its waiting job and accepted quote', async () => {
    const { booking, driverId, fixer, garage, job, quote, request } =
      await bookedAt({ job: 'to_do' });
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId, 'account.suspended'));

    expect(
      await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }),
    ).toMatchObject({
      cancelledBySide: 'system',
      cancelReason: 'driver_account_closed',
      status: 'cancelled',
    });
    expect(await statusOf('job', job?.id ?? '')).toBe('cancelled');
    expect(await statusOf('quote', quote.id)).toBe('lost');
    expect(
      await prisma.quoteRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
    ).toMatchObject({ closedReason: 'account_closed', status: 'closed' });

    const events = await newEvents(mark);
    expect(events.map((e) => e.kind).sort()).toEqual([
      'booking.cancelled',
      'request.cancelled',
    ]);
    const cancelled = events.find((e) => e.kind === 'booking.cancelled');
    expect(cancelled?.subjectId).toBe(booking.id);
    expect(cancelled?.payload).toEqual({
      bookingId: booking.id,
      garageId: garage.id,
      reason: 'driver_account_closed',
      requestId: request.id,
    });
    expect(cancelled?.audience).toEqual(
      expect.arrayContaining([
        `account:${driverId}`,
        `garage:${garage.id}`,
        `mechanic:${fixer.id}`,
      ]),
    );
    const reason = await prisma.activityLog.findFirst({
      where: { field: 'cancel_reason', subjectId: booking.id },
    });
    expect(reason).toMatchObject({
      actorRole: 'system',
      newValue: 'driver_account_closed',
    });
  });

  // @traces 150-FR-001
  it('frees the place a cancelled booking held', async () => {
    const { booking, driverId, fixer, garage } = await bookedAt();
    await prisma.bookingSegment.create({
      data: {
        bookingId: booking.id,
        endsAt: new Date(booking.startsAt.getTime() + 3_600_000),
        garageId: garage.id,
        mechanicId: fixer.id,
        startsAt: booking.startsAt,
      },
    });
    const handler = await start();

    await handler.onEvent(closing(driverId));

    expect(
      await prisma.bookingSegment.count({ where: { bookingId: booking.id } }),
    ).toBe(0);
  });

  it('cancels a booking still waiting for the garage’s confirmation', async () => {
    const { booking, driverId } = await bookedAt({
      booking: 'awaiting_confirmation',
    });
    const handler = await start();

    await handler.onEvent(closing(driverId));

    expect(await statusOf('booking', booking.id)).toBe('cancelled');
  });

  it('closes a booked request whose only booking ended before', async () => {
    const { booking, driverId, request } = await bookedAt();
    await prisma.booking.update({
      data: {
        cancelledAt: NOW,
        cancelledBySide: 'driver',
        cancelReason: 'plans_changed',
        status: 'cancelled',
      },
      where: { id: booking.id },
    });
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId));

    expect(await statusOf('quoteRequest', request.id)).toBe('closed');
    expect(
      await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }),
    ).toMatchObject({ cancelReason: 'plans_changed', status: 'cancelled' });
    expect((await newEvents(mark)).map((e) => e.kind)).toEqual([
      'request.cancelled',
    ]);
  });
});

// @traces 428-FR-005 428-FR-012
describe('leaving alone what has started or passed', () => {
  it.each(['in_work', 'paused', 'done'] as const)(
    'leaves the booking, its %s job and the request as they are',
    async (status) => {
      const { booking, driverId, job, request } = await bookedAt({
        job: status,
      });
      const handler = await start();
      const mark = await outboxMark(prisma);
      const before = [
        await cleanups('request', 'skipped'),
        await cleanups('booking', 'skipped'),
      ];

      await handler.onEvent(closing(driverId));

      expect(await statusOf('booking', booking.id)).toBe('confirmed');
      expect(await statusOf('job', job?.id ?? '')).toBe(status);
      expect(await statusOf('quoteRequest', request.id)).toBe('booked');
      expect(await newEvents(mark)).toEqual([]);
      expect([
        await cleanups('request', 'skipped'),
        await cleanups('booking', 'skipped'),
      ]).toEqual([before[0] + 1, before[1] + 1]);
    },
  );

  it.each([
    ['a second ago', -SECOND, 'confirmed'],
    ['in a second', SECOND, 'cancelled'],
  ])(
    'judges a booking that starts %s against the time it is handled',
    async (_when, offset, expected) => {
      const { booking, driverId } = await bookedAt({ job: 'to_do' });
      await prisma.booking.update({
        data: { startsAt: new Date(NOW.getTime() + offset) },
        where: { id: booking.id },
      });
      const handler = await start();

      await handler.onEvent(closing(driverId));

      expect(await statusOf('booking', booking.id)).toBe(expected);
    },
  );

  it('counts each request closed and each booking cancelled', async () => {
    const { driverId } = await bookedAt({ job: 'to_do' });
    await world.request(driverId);
    const handler = await start();
    const before = [
      await cleanups('request', 'closed'),
      await cleanups('booking', 'cancelled'),
    ];

    await handler.onEvent(closing(driverId));

    expect([
      await cleanups('request', 'closed'),
      await cleanups('booking', 'cancelled'),
    ]).toEqual([before[0] + 2, before[1] + 1]);
  });
});

// @traces 428-FR-007 428-FR-012
describe('doing it once', () => {
  it('does the same on suspension as on deletion', async () => {
    const { booking, driverId, request } = await bookedAt({ job: 'to_do' });
    const handler = await start();

    await handler.onEvent(closing(driverId, 'account.suspended'));

    expect(await statusOf('booking', booking.id)).toBe('cancelled');
    expect(await statusOf('quoteRequest', request.id)).toBe('closed');
  });

  it('writes nothing when the same event comes a second time', async () => {
    const { driverId, garage } = await bookedAt({ job: 'to_do' });
    const open = await world.request(driverId);
    await world.recipient(open.id, garage.id);
    const handler = await start();
    const event = closing(driverId);
    await handler.onEvent(event);
    const mark = await outboxMark(prisma);
    const entries = await prisma.activityLog.count();

    await handler.onEvent(event);

    expect(await newEvents(mark)).toEqual([]);
    expect(await prisma.activityLog.count()).toBe(entries);
  });

  it('closes a request once when two deliveries run at the same time', async () => {
    const { driverId, request } = await outToThree();
    const handler = await start();
    const mark = await outboxMark(prisma);

    await Promise.all([
      handler.onEvent(closing(driverId)),
      handler.onEvent(closing(driverId)),
    ]);

    const events = await newEvents(mark);
    expect(events.map((e) => e.subjectId)).toEqual([request.id]);
  });

  it('reopens nothing and closes nothing when the account is restored', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const request = await world.request(driverId);
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId, 'account.restored'));

    expect(await statusOf('quoteRequest', request.id)).toBe('sent');
    expect(await newEvents(mark)).toEqual([]);
  });

  it('writes nothing for a driver with nothing open, and still says so in the log', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    await world.request(driverId, { status: 'closed' });
    const handler = await start();
    const mark = await outboxMark(prisma);
    const entries = await prisma.activityLog.count();

    await handler.onEvent(closing(driverId));

    expect(await newEvents(mark)).toEqual([]);
    expect(await prisma.activityLog.count()).toBe(entries);
    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toContainEqual(
      expect.stringMatching(
        new RegExp(`account ${driverId}.*requests closed 0`),
      ),
    );
    expect(lines.join('\n')).not.toMatch(/Andrei/);
  });
});

// @traces 428-FR-008 428-FR-012
describe('one request failing', () => {
  it('closes the others, counts the failure and fails the job so it is retried', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const requests = [
      await world.request(driverId),
      await world.request(driverId),
      await world.request(driverId),
    ];
    const [failing, ...others] = requests;
    const original = AccountClosed.prototype.closeIn;
    vi.spyOn(AccountClosed.prototype, 'closeIn').mockImplementation(function (
      this: AccountClosed,
      tx,
      id,
    ) {
      if (id === failing.id) throw new Error('lock wait timeout');
      return original.call(this, tx, id);
    });
    const handler = await start();
    const before = await cleanups('request', 'failed');

    await expect(handler.onEvent(closing(driverId))).rejects.toThrow(
      'lock wait timeout',
    );

    expect(await statusOf('quoteRequest', failing.id)).toBe('sent');
    for (const other of others) {
      expect(await statusOf('quoteRequest', other.id)).toBe('closed');
    }
    expect(await cleanups('request', 'failed')).toBe(before + 1);
  });
});
