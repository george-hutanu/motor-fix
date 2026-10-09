import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';

import { INSIGHTS_QUEUE, InsightsModule } from './insights.module';
import {
  countPlatformFigures,
  monthStartSnapshot,
  writeSnapshot,
} from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import { local } from '../bucharest';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(4);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const queue = new Queue(INSIGHTS_QUEUE, { connection: { url: redisUrl } });
let slug = 0;

const garage = (
  status: 'draft' | 'approved' | 'suspended',
  approvedAt: Date | null,
) =>
  prisma.garage.create({
    data: { approvedAt, name: 'Service', slug: `adv-${++slug}`, status },
  });

const snapshotRow = (day: string, activeDrivers: number) =>
  prisma.platformDaily.create({
    data: {
      activeDrivers,
      day: new Date(day),
      garagesApprovedThisMonth: 0,
      garagesListed: 0,
      writtenAt: new Date(`${day}T00:00:00Z`),
    },
  });

afterAll(async () => {
  await queue.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE platform_daily');
  await queue.obliterate({ force: true });
});

describe('the platform figures at the edges', () => {
  it.each([
    ['summer time', '2026-04-15T10:00:00Z', '2026-03-31T21:00:00.000Z'],
    ['winter time', '2026-11-10T10:00:00Z', '2026-10-31T22:00:00.000Z'],
  ])(
    'starts the month at midnight in Bucharest in %s, to the millisecond',
    async (_, at, boundary) => {
      await garage('approved', new Date(boundary));
      await garage('approved', new Date(Date.parse(boundary) - 1));

      await expect(
        countPlatformFigures(prisma, new Date(at)),
      ).resolves.toMatchObject({
        garagesApprovedThisMonth: 1,
        garagesListed: 2,
      });
    },
  );

  it('does not count an approval from the same month of an earlier year', async () => {
    await garage('approved', new Date('2025-11-05T08:00:00Z'));

    await expect(
      countPlatformFigures(prisma, new Date('2026-11-10T10:00:00Z')),
    ).resolves.toMatchObject({
      garagesApprovedThisMonth: 0,
      garagesListed: 1,
    });
  });

  it('lists a re-approved garage once, in the month of its first approval, and one approved with no date as listed only', async () => {
    await garage('approved', new Date('2026-08-01T08:00:00Z'));
    await garage('approved', null);

    await expect(
      countPlatformFigures(prisma, new Date('2026-11-10T10:00:00Z')),
    ).resolves.toMatchObject({
      garagesApprovedThisMonth: 0,
      garagesListed: 2,
    });
  });

  it('counts a thousand garages as a plain integer', async () => {
    await prisma.garage.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        approvedAt: new Date('2026-11-02T08:00:00Z'),
        name: 'Service',
        slug: `bulk-${i}`,
        status: 'approved' as const,
      })),
    });

    await expect(
      countPlatformFigures(prisma, new Date('2026-11-10T10:00:00Z')),
    ).resolves.toMatchObject({
      garagesApprovedThisMonth: 1001,
      garagesListed: 1001,
    });
  });

  it('answers the same twice and writes nothing', async () => {
    await garage('approved', new Date('2026-11-02T08:00:00Z'));
    const at = new Date('2026-11-10T10:00:00Z');

    const first = await countPlatformFigures(prisma, at);
    const second = await countPlatformFigures(prisma, at);

    expect(second).toEqual(first);
    expect(await prisma.platformDaily.count()).toBe(0);
  });

  it('gives zero, not nothing, for a month-start row that holds no active drivers', async () => {
    await snapshotRow('2026-11-01', 0);

    await expect(
      monthStartSnapshot(prisma, new Date('2026-11-10T10:00:00Z')),
    ).resolves.toBe(0);
  });
});

describe('the snapshot at the edges', () => {
  it('keys a run at 00:30 on the 1st in Bucharest to the 1st and counts the new month from it', async () => {
    await garage('approved', new Date('2026-10-31T22:10:00Z'));

    await writeSnapshot(prisma, new Date('2026-10-31T22:30:00Z'));

    expect(await prisma.platformDaily.findMany()).toEqual([
      {
        activeDrivers: 0,
        city: 'all',
        day: new Date('2026-11-01'),
        garagesApprovedThisMonth: 1,
        garagesListed: 1,
        writtenAt: new Date('2026-10-31T22:30:00Z'),
      },
    ]);
  });

  it('leaves the other days alone and is the same after a repeat at the same instant', async () => {
    await snapshotRow('2026-11-09', 41);
    const at = new Date('2026-11-10T01:00:00Z');

    await writeSnapshot(prisma, at);
    const once = await prisma.platformDaily.findMany({
      orderBy: { day: 'asc' },
    });
    await writeSnapshot(prisma, at);
    const twice = await prisma.platformDaily.findMany({
      orderBy: { day: 'asc' },
    });

    expect(twice).toEqual(once);
    expect(twice.map((r) => [r.day, r.activeDrivers])).toEqual([
      [new Date('2026-11-09'), 41],
      [new Date('2026-11-10'), 0],
    ]);
  });
});

describe('the night job schedule', () => {
  const boot = async () => {
    const app = await Test.createTestingModule({
      imports: [
        InsightsModule.registerWorker({
          databaseUrl,
          places: { provider: 'none' },
          redisUrl,
        }),
      ],
    }).compile();
    await app.init();
    return app;
  };

  it('is next due at 01:00 on the Bucharest clock', async () => {
    const app = await boot();
    const [scheduler] = await queue.getJobSchedulers();
    await app.close();

    const next = new Date(scheduler.next as number);
    expect(local(next).hour).toBe(1);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it('queues only the next night when it starts, and runs nothing it missed', async () => {
    const app = await boot();
    const counts = await queue.getJobCounts();
    await app.close();

    expect(counts).toMatchObject({
      active: 0,
      completed: 0,
      delayed: 1,
      failed: 0,
      waiting: 0,
    });
    expect(await prisma.platformDaily.count()).toBe(0);
  });
});
