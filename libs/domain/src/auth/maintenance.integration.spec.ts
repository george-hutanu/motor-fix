import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { MaintenanceFlag, storedMaintenance } from './maintenance';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const prisma = createPrisma(databaseUrl);
const redis = new Redis(redisUrl);
serialDatabase(databaseUrl);

const KEY = 'maintenance_mode';

const stored = (value: boolean) =>
  prisma.platformRule.update({ data: { value }, where: { key: KEY } });

let flag: MaintenanceFlag;

beforeEach(async () => {
  jest.restoreAllMocks();
  await stored(false);
  await redis.del(KEY);
  flag = new MaintenanceFlag(redis, prisma);
});

afterAll(async () => {
  await stored(false);
  await redis.del(KEY);
  redis.disconnect();
  await prisma.$disconnect();
});

describe('reading the maintenance switch', () => {
  it('answers from the fast store when it holds the value', async () => {
    await stored(false);
    await redis.set(KEY, '1');
    expect(await flag.on()).toBe(true);

    await stored(true);
    await redis.set(KEY, '0');
    expect(await flag.on()).toBe(false);
  });

  it('reads the stored rule on a miss and keeps it for a minute', async () => {
    await stored(true);

    expect(await flag.on()).toBe(true);
    expect(await redis.get(KEY)).toBe('1');
    const ttl = await redis.ttl(KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('reads the stored rule when the fast store fails, and says so once until it answers again', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const get = jest
      .spyOn(redis, 'get')
      .mockRejectedValue(new Error('Connection is closed.'));
    await stored(true);

    expect(await flag.on()).toBe(true);
    await stored(false);
    expect(await flag.on()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    get.mockRestore();
    expect(await flag.on()).toBe(false);
    jest
      .spyOn(redis, 'get')
      .mockRejectedValue(new Error('Connection is closed.'));
    await flag.on();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('still answers from the stored rule when keeping it in the fast store fails', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(redis, 'set').mockRejectedValue(new Error('Command timed out'));
    await stored(true);

    expect(await flag.on()).toBe(true);
  });

  it('never lets a fill after a miss overwrite a switch written meanwhile', async () => {
    const find = prisma.platformRule.findUnique.bind(prisma.platformRule);
    jest.spyOn(prisma.platformRule, 'findUnique').mockImplementation((async (
      args: Parameters<typeof find>[0],
    ) => {
      const rule = await find(args);
      await flag.set(false);
      return rule;
    }) as never);
    await stored(true);

    expect(await flag.on()).toBe(true);
    expect(await redis.get(KEY)).toBe('0');
  });

  it('reads as off when the rule is not stored at all', async () => {
    jest.spyOn(prisma.platformRule, 'findUnique').mockResolvedValue(null);

    expect(await flag.on()).toBe(false);
  });
});

describe('reading the stored rule alone', () => {
  it('follows the stored rule on every call and never touches the fast store', async () => {
    await redis.set(KEY, '1');
    const reader = storedMaintenance(prisma);

    expect(await reader.on()).toBe(false);
    await stored(true);
    expect(await reader.on()).toBe(true);
    expect(await redis.get(KEY)).toBe('1');
  });
});

describe('writing the maintenance switch', () => {
  it('writes the value to the fast store with an expiry', async () => {
    await flag.set(true);
    expect(await redis.get(KEY)).toBe('1');
    expect(await redis.ttl(KEY)).toBeGreaterThan(0);

    await flag.set(false);
    expect(await redis.get(KEY)).toBe('0');
  });
});
