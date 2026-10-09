import {
  countPlatformFigures,
  snapshotActiveDrivers,
} from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

// 13:00 in Bucharest on Thursday 8 October 2026.
const now = new Date('2026-10-08T10:00:00Z');
let slug = 0;

const approved = (
  approvedAt: string,
  status: 'approved' | 'suspended' = 'approved',
) =>
  prisma.garage.create({
    data: {
      approvedAt: new Date(approvedAt),
      name: 'Service',
      slug: `period-${++slug}`,
      status,
    },
  });

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE platform_daily');
});

// @traces 163-FR-002 163-FR-013
describe('the figures of a period', () => {
  it.each([
    ['today', '2026-10-07T21:00:00Z', '2026-10-07T20:59:59Z'],
    ['7d', '2026-10-01T21:00:00Z', '2026-10-01T20:59:59Z'],
    ['30d', '2026-09-08T21:00:00Z', '2026-09-08T20:59:59Z'],
    ['month', '2026-09-30T21:00:00Z', '2026-09-30T20:30:00Z'],
    ['12m', '2025-10-31T22:00:00Z', '2025-10-31T21:59:59Z'],
  ] as const)(
    'counts in %s a garage first approved at its first instant and not one a moment before',
    async (period, first, before) => {
      await approved(first);
      await approved(before);

      await expect(
        countPlatformFigures(prisma, now, { period }),
      ).resolves.toMatchObject({
        garagesApprovedInPeriod: 1,
        garagesListed: 2,
      });
    },
  );

  it('counts approvals up to now, today included', async () => {
    await approved('2026-10-08T09:59:00Z');

    await expect(
      countPlatformFigures(prisma, now, { period: '7d' }),
    ).resolves.toMatchObject({ garagesApprovedInPeriod: 1 });
  });

  it('leaves out a garage published before the period and approved again in it', async () => {
    const { id } = await approved('2026-10-05T08:00:00Z');
    await prisma.activityLog.create({
      data: {
        action: 'update',
        actorName: 'MotorFix',
        actorRole: 'system',
        at: new Date('2026-09-20T08:00:00Z'),
        field: 'status',
        garageId: id,
        newValue: 'approved',
        subjectId: id,
        subjectType: 'garage',
      },
    });

    await expect(
      countPlatformFigures(prisma, now, { period: '7d' }),
    ).resolves.toMatchObject({ garagesApprovedInPeriod: 0 });
    await expect(
      countPlatformFigures(prisma, now, { period: '30d' }),
    ).resolves.toMatchObject({ garagesApprovedInPeriod: 1 });
  });

  it('keeps the listed garages and the active drivers counts of now, whatever the period', async () => {
    await approved('2026-01-10T08:00:00Z');
    await approved('2026-10-08T08:00:00Z');
    await approved('2026-10-08T08:00:00Z', 'suspended');
    const id = await account('driver-of-the-period', ['driver']);
    await prisma.account.update({
      data: { lastActiveAt: new Date('2026-09-20T08:00:00Z') },
      where: { id },
    });
    const plain = await countPlatformFigures(prisma, now);

    for (const period of ['today', '7d', '30d', 'month', '12m'] as const) {
      await expect(
        countPlatformFigures(prisma, now, { period }),
      ).resolves.toMatchObject({
        activeDrivers: plain.activeDrivers,
        garagesListed: plain.garagesListed,
      });
    }
    expect(plain).toMatchObject({ activeDrivers: 1, garagesListed: 2 });
  });

  it('answers the default as before, with no period figure', async () => {
    await approved('2026-10-02T08:00:00Z');

    await expect(
      countPlatformFigures(prisma, now, { period: 'default' }),
    ).resolves.toStrictEqual({
      activeDrivers: 0,
      garagesApprovedThisMonth: 1,
      garagesListed: 1,
    });
  });
});

describe('the active drivers on the first day of a period', () => {
  const row = (day: string, activeDrivers: number | null, city = 'all') =>
    prisma.platformDaily.create({
      data: {
        activeDrivers,
        city,
        day: new Date(day),
        garagesApprovedThisMonth: 0,
        garagesListed: 1,
        writtenAt: new Date(`${day}T00:00:00Z`),
      },
    });

  it("reads the whole country's row of that day", async () => {
    await row('2026-10-02', 120);
    await row('2026-10-02', null, 'bucuresti');

    await expect(snapshotActiveDrivers(prisma, '2026-10-02')).resolves.toBe(
      120,
    );
  });

  it('gives nothing without a row that day, never a neighbouring one', async () => {
    await row('2026-10-01', 110);
    await row('2026-10-03', 130);

    await expect(
      snapshotActiveDrivers(prisma, '2026-10-02'),
    ).resolves.toBeUndefined();
  });
});
