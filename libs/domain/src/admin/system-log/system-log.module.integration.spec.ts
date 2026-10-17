import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';

import { purgeSystemLog } from './purge';
import { systemLog } from './system-log';
import { SYSTEM_LOG_QUEUE, SystemLogModule } from './system-log.module';
import { createPrisma } from '../../auth/prisma';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  redisUrlFor,
} from '../../notifications/notifications.testing';

const redisUrl = redisUrlFor(8);
serialDatabase(databaseUrl);

const prisma = createPrisma(databaseUrl);
const jobs = new Queue(SYSTEM_LOG_QUEUE, { connection: { url: redisUrl } });

const boot = async (version: string | undefined) => {
  const app = await Test.createTestingModule({
    imports: [
      SystemLogModule.registerWorker({ databaseUrl, redisUrl, version }),
    ],
  }).compile();
  await app.init();
  return app;
};

// One instance booting and stopping, as a release starts it.
const bootOnce = async (version: string | undefined) => {
  const app = await boot(version);
  await app.close();
};

const deploys = () =>
  prisma.systemLogEntry.findMany({
    orderBy: { at: 'asc' },
    where: { kind: 'deploy' },
  });

afterAll(async () => {
  await jobs.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE system_log_entry');
  await jobs.obliterate({ force: true });
});

// @traces 297-FR-011
describe('the deploy entry', () => {
  it('is written once when the worker boots with a release version', async () => {
    await bootOnce('a1b2c3d');
    const [deploy, ...more] = await deploys();
    expect(more).toEqual([]);
    expect(deploy).toMatchObject({
      context: { version: 'a1b2c3d' },
      count: 1,
      fingerprint: 'a1b2c3d',
      message: 'Deployed a1b2c3d.',
      severity: 'info',
      source: 'worker',
    });
  });

  it('is not written again by a restart or a second instance of the same release', async () => {
    await bootOnce('a1b2c3d');
    await bootOnce('a1b2c3d');
    const first = await boot('a1b2c3d');
    const second = await boot('a1b2c3d');
    await first.close();
    await second.close();
    const rows = await deploys();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(1);
  });

  it('is written once by two instances of a new release booting either side of a minute', async () => {
    const write = systemLog.write.bind(systemLog);
    let minutes = 0;
    const spy = jest
      .spyOn(systemLog, 'write')
      .mockImplementation(async (kind, source, context) => {
        const at = new Date(Date.now() + minutes++ * 60_000);
        await new Promise((resolve) => setTimeout(resolve, 200));
        return write(kind, source, context, at);
      });
    const apps = await Promise.all([boot('a1b2c3d'), boot('a1b2c3d')]).finally(
      () => spy.mockRestore(),
    );
    await Promise.all(apps.map((app) => app.close()));
    expect(await deploys()).toHaveLength(1);
  });

  it('never fails the boot when the log cannot be checked', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const write = jest
      .spyOn(systemLog, 'write')
      .mockRejectedValueOnce(new Error('log down'));
    try {
      await expect(bootOnce('a1b2c3d')).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        'Deploy of a1b2c3d not checked against the log',
      );
    } finally {
      write.mockRestore();
      warn.mockRestore();
    }
    expect(await deploys()).toEqual([]);
  });

  it('is written for a new release, and again for a rollback to an older one', async () => {
    await bootOnce('a1b2c3d');
    await bootOnce('e4f5a6b');
    // Releases are minutes apart: a rollback in the same minute as the first
    // deploy of its version would only count one more on that entry.
    await prisma.$executeRawUnsafe(
      "UPDATE system_log_entry SET at = at - interval '10 minutes', minute = minute - interval '10 minutes'",
    );
    await bootOnce('a1b2c3d');
    expect((await deploys()).map((row) => row.context)).toEqual([
      { version: 'a1b2c3d' },
      { version: 'e4f5a6b' },
      { version: 'a1b2c3d' },
    ]);
  });

  it.each([
    ['dev', 'dev'],
    ['unset', undefined],
  ])('is not written when the version is %s', async (_, version) => {
    await bootOnce(version);
    expect(await deploys()).toEqual([]);
  });

  it('starts the writer for the life of the module only', async () => {
    const app = await boot('dev');
    await expect(
      systemLog.write('check_failed', 'api', { reason: 'timeout' }),
    ).resolves.toBe('written');
    await app.close();
    await expect(
      systemLog.write('check_failed', 'api', { reason: 'timeout' }),
    ).resolves.toBe('dropped');
  });
});

// @traces 297-FR-012
describe('the nightly purge', () => {
  const now = new Date('2026-10-17T00:30:00.000Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const entry = (at: Date, fingerprint: string) => ({
    at,
    context: { version: fingerprint },
    fingerprint,
    kind: 'deploy' as const,
    message: `Deployed ${fingerprint}.`,
    minute: at,
    severity: 'info' as const,
    source: 'worker' as const,
  });

  it('deletes the entries older than 90 days and keeps the rest', async () => {
    await prisma.systemLogEntry.createMany({
      data: [entry(daysAgo(91), 'old'), entry(daysAgo(89), 'recent')],
    });
    await expect(purgeSystemLog(prisma, now)).resolves.toBe(1);
    expect(
      (await prisma.systemLogEntry.findMany()).map((row) => row.fingerprint),
    ).toEqual(['recent']);
  });

  it('runs at 03:30 in Bucharest under one fixed scheduler, however many workers start', async () => {
    const first = await boot('dev');
    const second = await boot('dev');
    try {
      const schedulers = await jobs.getJobSchedulers();
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0]).toMatchObject({
        key: 'system-log-purge',
        pattern: '30 3 * * *',
        tz: 'Europe/Bucharest',
      });
    } finally {
      await first.close();
      await second.close();
    }
  });
});
