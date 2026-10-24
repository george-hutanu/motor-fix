import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { NotFoundException } from '@nestjs/common';
import { Redis } from 'ioredis';

import { PresenceService } from './presence.service';
import { serialDatabase } from '../../../../auth/serial-db.testing';
import { LIVE_CHANNEL } from '../../../../events/live/live.hub';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../../../notifications/notifications.testing';
import { until } from '../../../../waits.testing';

// @traces 413-FR-001 413-FR-002 413-FR-003 413-FR-004 413-FR-006 413-FR-007 413-FR-010 413-FR-014

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);
const reader = countedMetrics();
const redis = new Redis(redisUrlFor(7));
const subscriber = new Redis(redisUrlFor(7));

const START = Date.parse('2026-10-24T07:42:11.000Z');
let clock = START;
const service = new PresenceService(redis, prisma);
service.now = () => clock;

interface Published {
  audience: string[];
  event: { at: string; id: string; kind: string };
}
const published: Published[] = [];
const changesOf = (fileId: string) =>
  published.filter(
    (message) =>
      message.event.kind === 'presence.changed' && message.event.id === fileId,
  );

const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_verification_presence_total', { outcome });

const key = (fileId: string) => `verification:presence:${fileId}`;

let ana: string;
let mihai: string;
let ion: string;
let fileId: string;

beforeAll(async () => {
  await subscriber.subscribe(LIVE_CHANNEL);
  subscriber.on('message', (_channel, raw: string) =>
    published.push(JSON.parse(raw) as Published),
  );
});

afterAll(async () => {
  await subscriber.quit();
  await redis.quit();
  await prisma.$disconnect();
});

beforeEach(async () => {
  clock = START;
  published.splice(0);
  await reset();
  ana = await account('Ana Maria Popescu', ['admin']);
  mihai = await account('Mihai Ionescu', ['admin']);
  ion = await account('Ion', ['admin']);
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  fileId = (
    await prisma.verificationFile.create({
      data: { garageId: garage.id, status: 'submitted' },
    })
  ).id;
});

describe('a heartbeat on a verification file', () => {
  it('answers nobody else for the first admin and records the entry with its start', async () => {
    await expect(service.touch(fileId, ana)).resolves.toEqual({ others: [] });

    const stored = JSON.parse((await redis.hget(key(fileId), ana)) ?? '{}');
    expect(stored).toEqual({
      name: 'Ana P.',
      seen: '2026-10-24T07:42:11.000Z',
      since: '2026-10-24T07:42:11.000Z',
    });
  });

  it('names the others with their start, oldest first, never the caller', async () => {
    await service.touch(fileId, ana);
    clock += 5_000;
    await service.touch(fileId, ion);
    clock += 5_000;

    await expect(service.touch(fileId, mihai)).resolves.toEqual({
      others: [
        { name: 'Ana P.', since: '2026-10-24T07:42:11.000Z' },
        { name: 'Ion', since: '2026-10-24T07:42:16.000Z' },
      ],
    });
  });

  it('keeps the start and renews the expiry to a minute', async () => {
    await service.touch(fileId, ana);
    clock += 40_000;
    await service.touch(fileId, ana);
    clock += 1_000;

    const answer = await service.touch(fileId, mihai);
    expect(answer.others).toEqual([
      { name: 'Ana P.', since: '2026-10-24T07:42:11.000Z' },
    ]);
    const ttl = await redis.pttl(key(fileId));
    expect(ttl).toBeGreaterThan(55_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('counts two tabs of the same admin once, with the first start', async () => {
    await service.touch(fileId, ana);
    clock += 3_000;
    await service.touch(fileId, ana);

    const answer = await service.touch(fileId, mihai);
    expect(answer.others).toEqual([
      { name: 'Ana P.', since: '2026-10-24T07:42:11.000Z' },
    ]);
    expect(await redis.hlen(key(fileId))).toBe(2);
  });

  it('drops an admin whose last heartbeat is over a minute old and removes it from the store', async () => {
    await service.touch(fileId, ana);
    clock += 61_000;

    await expect(service.touch(fileId, mihai)).resolves.toEqual({
      others: [],
    });
    expect(await redis.hexists(key(fileId), ana)).toBe(0);
  });

  it('keeps an admin whose heartbeat lands between the read and the removal of its stale entry', async () => {
    await service.touch(fileId, ana);
    clock += 61_000;
    // Ana's tab beats while Mihai's read is between its HGETALL and the drop.
    const fresh = JSON.stringify({
      name: 'Ana P.',
      seen: new Date(clock).toISOString(),
      since: new Date(clock).toISOString(),
    });
    const racing = new Proxy(redis, {
      get(target, property) {
        if (property === 'hgetall')
          return async (key: string) => {
            const all = await target.hgetall(key);
            await target.hset(key, ana, fresh);
            return all;
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const raced = new PresenceService(racing, prisma);
    raced.now = () => clock;

    await raced.touch(fileId, mihai);

    expect(await redis.hget(key(fileId), ana)).toBe(fresh);
  });

  it('fails the call, not the store count, when the account cannot be read', async () => {
    const before = await counted('store_unavailable');
    const broken = new PresenceService(redis, {
      account: {
        findUnique: () => Promise.reject(new Error('database down')),
      },
      verificationFile: { findUnique: async () => ({ id: fileId }) },
    } as never);

    await expect(broken.touch(fileId, ana)).rejects.toThrow('database down');
    expect((await counted('store_unavailable')) - before).toBe(0);
  });

  it('keeps an admin whose last heartbeat is exactly a minute old', async () => {
    await service.touch(fileId, ana);
    clock += 60_000;

    const answer = await service.touch(fileId, mihai);
    expect(answer.others).toHaveLength(1);
  });

  it('refuses a file that does not exist and writes nothing', async () => {
    const unknown = randomUUID();
    await expect(service.touch(unknown, ana)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.touch('not-a-uuid', ana)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await redis.exists(key(unknown))).toBe(0);
  });

  it('writes nothing to the history of the garage', async () => {
    const before = await prisma.activityLog.count();
    await service.touch(fileId, ana);
    await service.leave(fileId, ana);

    expect(await prisma.activityLog.count()).toBe(before);
  });
});

describe('leaving a verification file', () => {
  it('removes the entry at once for the others', async () => {
    await service.touch(fileId, ana);
    await expect(service.leave(fileId, ana)).resolves.toBeUndefined();

    await expect(service.touch(fileId, mihai)).resolves.toEqual({
      others: [],
    });
  });

  it('answers nothing when there was no entry to remove', async () => {
    await expect(service.leave(fileId, ana)).resolves.toBeUndefined();
  });

  it('refuses a file that does not exist', async () => {
    await expect(service.leave(randomUUID(), ana)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('the live message', () => {
  it('goes to every admin when an entry is created and when it is removed, and not on a heartbeat', async () => {
    await service.touch(fileId, ana);
    await until('the creation message', () => changesOf(fileId).length === 1);
    clock += 20_000;
    await service.touch(fileId, ana);
    await service.leave(fileId, ana);
    await until('the removal message', () => changesOf(fileId).length >= 2);
    await service.leave(fileId, ana);
    await service.touch(fileId, mihai);
    await until('the second creation', () => changesOf(fileId).length >= 3);

    const changes = changesOf(fileId);
    expect(changes).toHaveLength(3);
    for (const message of changes) {
      expect(message.audience).toEqual(['admin']);
      expect(message.event).toEqual({
        at: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
        id: fileId,
        kind: 'presence.changed',
      });
    }
  });

  it('is not sent when an entry expires', async () => {
    await service.touch(fileId, ana);
    await until('the creation message', () => changesOf(fileId).length === 1);
    clock += 61_000;
    await service.touch(fileId, mihai);
    await until('the second creation', () => changesOf(fileId).length === 2);

    expect(changesOf(fileId)).toHaveLength(2);
  });
});

describe('counting', () => {
  it('counts each created and removed entry, not a heartbeat or an empty leave', async () => {
    const created = await counted('created');
    const removed = await counted('removed');

    await service.touch(fileId, ana);
    await service.touch(fileId, ana);
    await service.leave(fileId, ana);
    await service.leave(fileId, ana);

    expect((await counted('created')) - created).toBe(1);
    expect((await counted('removed')) - removed).toBe(1);
  });
});

describe('with the store unreachable', () => {
  const down = new Redis('redis://127.0.0.1:1', {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  const failing = new PresenceService(down, prisma);
  failing.now = () => clock;

  afterAll(() => down.disconnect());

  it('answers nobody else, without an error, and counts the failure', async () => {
    const before = await counted('store_unavailable');

    await expect(failing.touch(fileId, ana)).resolves.toEqual({ others: [] });
    await expect(failing.leave(fileId, ana)).resolves.toBeUndefined();

    expect((await counted('store_unavailable')) - before).toBe(2);
  });
});
