import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { AccountClosed } from './account-closed';
import { AccountClosedModule } from './account-closed.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { quotesWorld } from '../quotes.testing';

const redisUrl = redisUrlFor(11);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const NOW = new Date();

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
});

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

const closing = (accountId: string, kind = 'account.deleted') => ({
  data: {
    id: String(Math.floor(Math.random() * 1e9)),
    kind,
    payload: {},
    subjectId: accountId,
  },
});

const requestStatus = async (id: string) =>
  (await prisma.quoteRequest.findUniqueOrThrow({ where: { id } })).status;

async function newEvents(mark: bigint) {
  return prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { id: { gt: mark } },
  });
}

// @traces 428-FR-001 428-FR-002
describe('which account an event names', () => {
  it('uses the subject id when the payload has no account id', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const request = await world.request(driverId);
    const handler = await start();

    await handler.onEvent(closing(driverId, 'account.suspended'));

    expect(await requestStatus(request.id)).toBe('closed');
  });

  it('prefers the payload account id over the subject id', async () => {
    const named = await account('Andrei Ion Marin', ['driver']);
    const other = await account('Maria Pop', ['driver']);
    const mine = await world.request(named);
    const theirs = await world.request(other);
    const handler = await start();

    await handler.onEvent({
      data: {
        id: '1',
        kind: 'account.deleted',
        payload: { accountId: named },
        subjectId: other,
      },
    });

    expect(await requestStatus(mine.id)).toBe('closed');
    expect(await requestStatus(theirs.id)).toBe('sent');
  });

  it('closes the requests of a soft-deleted account', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const request = await world.request(driverId);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: driverId },
    });
    const handler = await start();

    await handler.onEvent(closing(driverId));

    expect(await requestStatus(request.id)).toBe('closed');
  });

  it('writes nothing and ends normally for an account that does not exist', async () => {
    const handler = await start();
    const mark = await outboxMark(prisma);
    const entries = await prisma.activityLog.count();

    await expect(
      handler.onEvent(closing(randomUUID())),
    ).resolves.toBeUndefined();

    expect(await newEvents(mark)).toEqual([]);
    expect(await prisma.activityLog.count()).toBe(entries);
  });

  it('touches no request of another driver', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const other = await account('Maria Pop', ['driver']);
    await world.request(driverId);
    const theirs = await world.request(other, { status: 'quoted' });
    const handler = await start();

    await handler.onEvent(closing(driverId));

    expect(await requestStatus(theirs.id)).toBe('quoted');
  });
});

// @traces 428-FR-002 428-FR-003
describe('a request whose recipients are in every state', () => {
  it('closes only the waiting recipient and names only the waiting and quoted garages', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const [waiting, quoted, declined, expired] = await Promise.all(
      ['Atelier Dinamo', 'Service Nord', 'Garaj Sud', 'Auto Vest'].map((n) =>
        world.garage(n),
      ),
    );
    const request = await world.request(driverId, { status: 'quoted' });
    const rWaiting = await world.recipient(request.id, waiting.id);
    await world.quote(request.id, quoted.id, 'waiting');
    const rDeclined = await world.recipient(
      request.id,
      declined.id,
      'declined',
      driverId,
    );
    const rExpired = await world.recipient(request.id, expired.id, 'expired');
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId));

    const status = async (id: string) =>
      (await prisma.requestRecipient.findUniqueOrThrow({ where: { id } }))
        .status;
    expect(await status(rWaiting.id)).toBe('closed');
    expect(await status(rDeclined.id)).toBe('declined');
    expect(await status(rExpired.id)).toBe('expired');
    const [event] = await newEvents(mark);
    expect(
      [...(event.payload as { garageIds: string[] }).garageIds].sort(),
    ).toEqual([waiting.id, quoted.id].sort());
  });

  it('still records the event with no garages when every recipient declined', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const garage = await world.garage('Atelier Dinamo');
    const request = await world.request(driverId);
    await world.recipient(request.id, garage.id, 'declined', driverId);
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId));

    expect(await requestStatus(request.id)).toBe('closed');
    const events = await newEvents(mark);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      garageIds: [],
      reason: 'account_closed',
    });
  });
});

// @traces 428-FR-005
describe('work that must not be touched', () => {
  it.each(['in_work', 'paused', 'done'] as const)(
    'leaves a booking, its %s job and its request unchanged',
    async (jobStatus) => {
      const driverId = await account('Andrei Ion Marin', ['driver']);
      const garage = await world.garage('Atelier Dinamo');
      const { booking, request } = await world.chain(driverId, garage.id, {
        booking: 'confirmed',
      });
      const job = await world.job(booking.id, jobStatus);
      const handler = await start();
      const mark = await outboxMark(prisma);

      await handler.onEvent(closing(driverId));

      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
          .status,
      ).toBe('confirmed');
      expect(
        (await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status,
      ).toBe(jobStatus);
      expect(await requestStatus(request.id)).toBe('booked');
      expect(await newEvents(mark)).toEqual([]);
    },
  );

  it.each(['completed', 'no_show', 'lapsed', 'cancelled'] as const)(
    'leaves a %s booking alone',
    async (status) => {
      const driverId = await account('Andrei Ion Marin', ['driver']);
      const garage = await world.garage('Atelier Dinamo');
      const { booking } = await world.chain(driverId, garage.id, {
        booking: status,
      });
      const handler = await start();

      await handler.onEvent(closing(driverId));

      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
          .status,
      ).toBe(status);
    },
  );

  it('never reopens a closed request when the account is restored', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const request = await world.request(driverId);
    const handler = await start();
    await handler.onEvent(closing(driverId));

    await handler.onEvent(closing(driverId, 'account.restored'));

    expect(await requestStatus(request.id)).toBe('closed');
  });
});

// @traces 428-FR-002 428-FR-007
describe('requests that are not open', () => {
  it('leaves in_work, done and already closed requests untouched and silent', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const inWork = await world.request(driverId, { status: 'in_work' });
    const done = await world.request(driverId, { status: 'done' });
    const closed = await world.request(driverId, { status: 'closed' });
    const handler = await start();
    const mark = await outboxMark(prisma);
    const entries = await prisma.activityLog.count();

    await handler.onEvent(closing(driverId));

    expect(await requestStatus(inWork.id)).toBe('in_work');
    expect(await requestStatus(done.id)).toBe('done');
    const after = await prisma.quoteRequest.findUniqueOrThrow({
      where: { id: closed.id },
    });
    expect(after.closedReason).toBe('cancelled');
    expect(await newEvents(mark)).toEqual([]);
    expect(await prisma.activityLog.count()).toBe(entries);
  });

  it('closes thirty open requests, each with its own event', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const requests = [];
    for (let i = 0; i < 30; i += 1)
      requests.push(await world.request(driverId));
    const handler = await start();
    const mark = await outboxMark(prisma);

    await handler.onEvent(closing(driverId));

    const events = await newEvents(mark);
    expect(events.map((e) => e.subjectId).sort()).toEqual(
      requests.map((r) => r.id).sort(),
    );
    expect(
      await prisma.quoteRequest.count({
        where: { closedReason: 'account_closed', driverId, status: 'closed' },
      }),
    ).toBe(30);
  }, 60_000);
});

// @traces 428-FR-001
describe('an event naming no usable account', () => {
  it.each(['not-a-uuid', ''])(
    'ends normally and writes nothing for the account id %p',
    async (accountId) => {
      const driverId = await account('Andrei Ion Marin', ['driver']);
      const request = await world.request(driverId);
      const handler = await start();
      const mark = await outboxMark(prisma);

      await expect(
        handler.onEvent({
          data: {
            id: '7',
            kind: 'account.deleted',
            payload: { accountId },
            subjectId: accountId,
          },
        }),
      ).resolves.toBeUndefined();

      expect(await requestStatus(request.id)).toBe('sent');
      expect(await newEvents(mark)).toEqual([]);
    },
  );
});
