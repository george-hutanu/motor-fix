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
const settled = () => new Promise((resolve) => setTimeout(resolve, 150));

let fileId: string;
let otherFileId: string;

const newFile = async () => {
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  return (
    await prisma.verificationFile.create({
      data: { garageId: garage.id, status: 'submitted' },
    })
  ).id;
};

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
  fileId = await newFile();
  otherFileId = await newFile();
});

describe('the shown name of an admin', () => {
  // @traces 413-FR-010
  it.each([
    ['Ana Maria Popescu', 'Ana P.'],
    ['  Ana   Popescu  ', 'Ana P.'],
    ['Ștefan Țurcanu', 'Ștefan Ț.'],
    ['Ion', 'Ion'],
    ['Ana Popescu-Ionescu', 'Ana P.'],
  ])('turns %j into %j', async (full, shown) => {
    const admin = await account(full, ['admin']);
    const watcher = await account('Watcher', ['admin']);
    await service.touch(fileId, admin);

    const answer = await service.touch(fileId, watcher);

    expect(answer.others.map(({ name }) => name)).toEqual([shown]);
  });

  // @traces 413-FR-010
  it('keeps an astral initial whole instead of cutting a surrogate pair', async () => {
    const admin = await account('Ana \u{1D4D0}opescu', ['admin']);
    const watcher = await account('Watcher', ['admin']);
    await service.touch(fileId, admin);

    const answer = await service.touch(fileId, watcher);

    expect(answer.others[0]?.name).toBe('Ana \u{1D4D0}.');
  });

  // @traces 413-FR-010
  it('freezes the name at creation, so a rename shows from the next entry', async () => {
    const admin = await account('Ana Popescu', ['admin']);
    const watcher = await account('Watcher', ['admin']);
    await service.touch(fileId, admin);
    await prisma.account.update({
      data: { name: 'Maria Ionescu' },
      where: { id: admin },
    });
    await service.touch(fileId, admin);

    const answer = await service.touch(fileId, watcher);

    expect(answer.others.map(({ name }) => name)).toEqual(['Ana P.']);
  });
});

describe('the list of the others', () => {
  // @traces 413-FR-003
  it('lists a crowd of fifty admins oldest first, never the caller', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++)
      ids.push(await account(`Admin${String(i).padStart(2, '0')}`, ['admin']));
    for (const id of ids) {
      await service.touch(fileId, id);
      clock += 1_000;
    }

    const answer = await service.touch(fileId, ids[25] as string);

    expect(answer.others).toHaveLength(49);
    expect(answer.others.map(({ name }) => name)).not.toContain('Admin25');
    const sinces = answer.others.map(({ since }) => since);
    expect(sinces).toEqual([...sinces].sort());
    expect(answer.others[0]?.name).toBe('Admin00');
    expect(answer.others[48]?.name).toBe('Admin49');
  });

  // @traces 413-FR-003
  it('keeps presence of one file out of another file', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    const mihai = await account('Mihai Ionescu', ['admin']);
    await service.touch(fileId, ana);

    await expect(service.touch(otherFileId, mihai)).resolves.toEqual({
      others: [],
    });
    await service.leave(otherFileId, ana);

    expect(await redis.hexists(key(fileId), ana)).toBe(1);
  });

  // @traces 413-FR-001
  it('drops an entry a millisecond past the minute and keeps the live ones beside it', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    const ion = await account('Ion', ['admin']);
    const mihai = await account('Mihai Ionescu', ['admin']);
    await service.touch(fileId, ana);
    clock += 30_000;
    await service.touch(fileId, ion);
    clock += 30_001;

    const answer = await service.touch(fileId, mihai);

    expect(answer.others.map(({ name }) => name)).toEqual(['Ion']);
    expect(await redis.hexists(key(fileId), ana)).toBe(0);
  });

  // @traces 413-FR-002
  it('gives a returning admin a new start after an expiry', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    const mihai = await account('Mihai Ionescu', ['admin']);
    await service.touch(fileId, ana);
    clock += 120_000;
    await service.touch(fileId, ana);

    const answer = await service.touch(fileId, mihai);

    expect(answer.others).toEqual([
      { name: 'Ana P.', since: new Date(START + 120_000).toISOString() },
    ]);
  });

  // @traces 413-FR-001
  it('survives garbage left in the hash by something else', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    const mihai = await account('Mihai Ionescu', ['admin']);
    await service.touch(fileId, ana);
    await redis.hset(key(fileId), 'junk-1', 'not json');
    await redis.hset(key(fileId), 'junk-2', '{"name":42}');
    await redis.hset(key(fileId), 'junk-3', 'null');

    const answer = await service.touch(fileId, mihai);

    expect(answer.others.map(({ name }) => name)).toEqual(['Ana P.']);
  });

  // @traces 413-FR-001
  it('leaves no key behind once the last admin has left', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    await service.touch(fileId, ana);
    await service.leave(fileId, ana);

    expect(await redis.exists(key(fileId))).toBe(0);
  });
});

describe('the live message under pressure', () => {
  // @traces 413-FR-007
  it('publishes one creation for five simultaneous first heartbeats of one admin', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    const before = await counted('created');

    await Promise.all(
      Array.from({ length: 5 }, () => service.touch(fileId, ana)),
    );
    await settled();

    expect(changesOf(fileId)).toHaveLength(1);
    expect((await counted('created')) - before).toBe(1);
  });

  // @traces 413-FR-007
  it('publishes one removal when the same tab leaves twice at once', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    await service.touch(fileId, ana);
    await settled();
    published.splice(0);

    await Promise.all([
      service.leave(fileId, ana),
      service.leave(fileId, ana),
      service.leave(fileId, ana),
    ]);
    await settled();

    expect(changesOf(fileId)).toHaveLength(1);
  });

  // @traces 413-FR-007
  it('addresses the message to the admin audience with the file id and a UTC time', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    await service.touch(fileId, ana);
    await settled();

    expect(changesOf(fileId)).toEqual([
      {
        audience: ['admin'],
        event: {
          at: '2026-10-24T07:42:11.000Z',
          id: fileId,
          kind: 'presence.changed',
        },
      },
    ]);
  });

  // @traces 413-FR-007
  it('publishes a creation again when an admin returns after an expiry', async () => {
    const ana = await account('Ana Popescu', ['admin']);
    await service.touch(fileId, ana);
    clock += 61_000;
    await service.touch(fileId, ana);
    await settled();

    expect(changesOf(fileId)).toHaveLength(2);
  });
});

describe('a file that cannot take presence', () => {
  // @traces 413-FR-005
  it.each([
    ['an empty id', ''],
    ['a sql fragment', "' OR '1'='1"],
    ['an upper case unknown uuid', randomUUID().toUpperCase()],
    ['a nil uuid', '00000000-0000-0000-0000-000000000000'],
    ['a very long id', 'a'.repeat(10_000)],
  ])('refuses %s on both calls and writes nothing', async (_title, id) => {
    const ana = await account('Ana Popescu', ['admin']);
    const before = await redis.dbsize();

    await expect(service.touch(id, ana)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.leave(id, ana)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await settled();

    expect(await redis.dbsize()).toBe(before);
    expect(changesOf(id)).toHaveLength(0);
  });

  // @traces 413-FR-005
  it.each(['approved', 'rejected', 'more_requested'] as const)(
    'accepts presence on a %s file',
    async (status) => {
      const ana = await account('Ana Popescu', ['admin']);
      const mihai = await account('Mihai Ionescu', ['admin']);
      const file = await newFile();
      await prisma.verificationFile.update({
        data: { status },
        where: { id: file },
      });
      await service.touch(file, ana);

      const answer = await service.touch(file, mihai);

      expect(answer.others.map(({ name }) => name)).toEqual(['Ana P.']);
    },
  );
});

describe('with the store failing in the middle', () => {
  // @traces 413-FR-006
  it('answers an empty list when the store rejects a command, and publishes nothing', async () => {
    const broken = new PresenceService(
      new Proxy(redis, {
        get: (target, prop) =>
          typeof Reflect.get(target, prop) === 'function' &&
          !['duplicate', 'on', 'once', 'emit', 'off', 'publish'].includes(
            String(prop),
          )
            ? () => {
                throw new Error('READONLY');
              }
            : Reflect.get(target, prop),
      }) as Redis,
      prisma,
    );
    broken.now = () => clock;
    const ana = await account('Ana Popescu', ['admin']);
    const before = await counted('store_unavailable');

    await expect(broken.touch(fileId, ana)).resolves.toEqual({ others: [] });
    await expect(broken.leave(fileId, ana)).resolves.toBeUndefined();
    await settled();

    expect(changesOf(fileId)).toHaveLength(0);
    expect((await counted('store_unavailable')) - before).toBe(2);
  });

  // @traces 413-FR-006
  it('still refuses an unknown file when the store is down', async () => {
    const down = new Redis('redis://127.0.0.1:1', {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    const failing = new PresenceService(down, prisma);
    const ana = await account('Ana Popescu', ['admin']);

    await expect(failing.touch(randomUUID(), ana)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    down.disconnect();
  });
});
