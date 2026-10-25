import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';

import { RETENTION_SWEEPS, runRetention } from './retention';
import { RETENTION_KINDS } from './retention.config';
import { RETENTION_QUEUE, RetentionModule } from './retention.module';
import { ago, retentionFixtures } from './retention.testing';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import * as counters from '../metrics/product-counters';
import {
  databaseUrl,
  redisUrlFor,
} from '../notifications/notifications.testing';
import { StorageService } from '../storage/storage.service';

const redisUrl = redisUrlFor(8);
serialDatabase(databaseUrl);

const prisma = createPrisma(databaseUrl);
const data = retentionFixtures(prisma);
const jobs = new Queue(RETENTION_QUEUE, { connection: { url: redisUrl } });
const storage = { deleteObject: jest.fn(async () => undefined) };
const now = new Date('2026-10-24T10:00:00.000Z');

const logger = () => {
  const lines: string[] = [];
  return {
    error: (line: string) => lines.push(`error ${line}`),
    lines,
    log: (line: string) => lines.push(line),
  };
};

@Global()
@Module({
  exports: [StorageService],
  providers: [{ provide: StorageService, useValue: storage }],
})
class FakeStorage {}

const boot = async () => {
  const app = await Test.createTestingModule({
    imports: [
      FakeStorage,
      RetentionModule.registerWorker({ databaseUrl, redisUrl }),
    ],
  }).compile();
  await app.init();
  return app;
};

afterAll(async () => {
  await jobs.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await data.reset();
  await jobs.obliterate({ force: true });
  // Earlier audit rows past their clock are not this file's to count.
  await runRetention({ logger: logger(), prisma, storage }, now).catch(
    () => undefined,
  );
});

// @traces 1156-FR-003
describe('the nightly run', () => {
  it('sweeps the eight kinds in their fixed order', () => {
    expect(RETENTION_SWEEPS.map(([kind]) => kind)).toEqual(RETENTION_KINDS);
  });

  it('runs every other sweep when one fails, then fails as one error', async () => {
    const ran: string[] = [];
    const sweeps = RETENTION_SWEEPS.map(
      ([kind]) =>
        [
          kind,
          async () => {
            ran.push(kind);
            if (kind === 'notification') throw new Error('database gone');
            return 0;
          },
        ] as const,
    );
    const log = logger();

    const run = runRetention({ logger: log, prisma, storage }, now, sweeps);

    await expect(run).rejects.toBeInstanceOf(AggregateError);
    await expect(run).rejects.toThrow('retention: notification failed');
    expect(ran).toEqual(RETENTION_KINDS);
    expect(log.lines.filter((line) => line.startsWith('error'))).toHaveLength(
      1,
    );
  });
});

// @traces 1156-FR-010
describe('what a run tells', () => {
  it('logs and counts every kind, 0 included, with no row content', async () => {
    const added = jest.spyOn(counters, 'countRetention');
    const ana = await data.account('ana');
    await prisma.signInCode.create({
      data: {
        codeHash: 'secret-hash',
        expiresAt: ago(now, 0, 1),
        phone: '+40711000001',
      },
    });
    await prisma.notification.create({
      data: {
        accountId: ana,
        channel: 'in_app',
        createdAt: ago(now, 400),
        eventId: 'e-1',
        kind: 'quote_received',
        status: 'sent',
      },
    });
    const log = logger();

    const { counts } = await runRetention(
      { logger: log, prisma, storage },
      now,
    );

    expect(counts).toEqual({
      account_token: 0,
      audit_entry: 0,
      legal_document: 0,
      notification: 1,
      phone_change: 0,
      refresh_token: 0,
      sign_in_code: 1,
      staff_invite: 0,
    });
    expect(log.lines.slice(0, RETENTION_KINDS.length)).toEqual([
      'retention sign_in_code removed 1',
      'retention phone_change removed 0',
      'retention account_token removed 0',
      'retention refresh_token removed 0',
      'retention staff_invite removed 0',
      'retention notification removed 1',
      'retention legal_document removed 0',
      'retention audit_entry anonymised 0',
    ]);
    expect(log.lines.at(-1)).toMatch(/^retention run took \d+ ms$/);
    expect(log.lines.join('\n')).not.toMatch(
      /secret-hash|\+4071|ana|[0-9a-f]{8}-[0-9a-f]{4}/,
    );
    expect(added.mock.calls).toEqual(
      RETENTION_KINDS.map((kind) => [kind, counts[kind]]),
    );
    added.mockRestore();
  });

  // @traces 1156-FR-013
  it('succeeds with nothing to do and counts 0 the second time', async () => {
    const { counts } = await runRetention(
      { logger: logger(), prisma, storage },
      now,
    );
    expect(Object.values(counts)).toEqual(RETENTION_KINDS.map(() => 0));
  });
});

describe('the scheduler', () => {
  it('runs at 04:00 in Bucharest under one fixed id, with the purge job retries, however many workers start', async () => {
    const first = await boot();
    const second = await boot();
    try {
      const schedulers = await jobs.getJobSchedulers();
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0]).toMatchObject({
        key: 'retention-nightly',
        pattern: '0 4 * * *',
        tz: 'Europe/Bucharest',
      });
      expect(schedulers[0]?.template?.opts).toMatchObject({
        attempts: 3,
        backoff: { delay: 60_000, type: 'exponential' },
      });
    } finally {
      await first.close();
      await second.close();
    }
  });
});
