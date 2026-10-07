import {
  countPlatformFigures,
  monthStartSnapshot,
  writeSnapshot,
} from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const now = new Date('2025-11-10T10:00:00Z');
const MONTH_START = new Date('2025-10-31T22:00:00.000Z');
let slug = 0;
// The log is append-only, so every entry written here stays for good.
const written: string[] = [];

const garage = (
  status: 'draft' | 'approved' | 'suspended',
  approvedAt: Date | null,
) =>
  prisma.garage.create({
    data: { approvedAt, name: 'Service', slug: `appr-${++slug}`, status },
  });

const entry = (
  subjectId: string,
  at: Date,
  over: {
    subjectType?: string;
    field?: string | null;
    newValue?: string;
  } = {},
) => {
  written.push(subjectId);
  return prisma.activityLog.create({
    data: {
      action: 'update',
      actorName: 'MotorFix',
      actorRole: 'system',
      at,
      field: over.field === undefined ? 'status' : over.field,
      garageId: subjectId,
      newValue: over.newValue ?? 'approved',
      subjectId,
      subjectType: over.subjectType ?? 'garage',
    },
  });
};

const approvedThisMonth = async (at = now) =>
  (await countPlatformFigures(prisma, at)).garagesApprovedThisMonth;

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE platform_daily');
});

describe('a garage approved again does not join the month a second time', () => {
  it('leaves out a garage approved this month that an earlier approval already listed', async () => {
    const g = await garage('approved', new Date('2025-11-04T08:00:00Z'));
    await entry(g.id, new Date('2025-08-20T08:00:00Z'));
    await entry(g.id, new Date('2025-11-04T08:00:00Z'));

    await expect(countPlatformFigures(prisma, now)).resolves.toMatchObject({
      garagesApprovedThisMonth: 0,
      garagesListed: 1,
    });
  });

  it('leaves out a garage suspended and approved again this month, yet lists it', async () => {
    const g = await garage('approved', new Date('2025-11-06T08:00:00Z'));
    await entry(g.id, new Date('2025-09-02T08:00:00Z'));
    await entry(g.id, new Date('2025-10-02T08:00:00Z'), {
      newValue: 'suspended',
    });
    await entry(g.id, new Date('2025-11-06T08:00:00Z'));

    await expect(countPlatformFigures(prisma, now)).resolves.toMatchObject({
      garagesApprovedThisMonth: 0,
      garagesListed: 1,
    });
  });

  it('counts a garage once when its first approval and a re-approval both fall in the month', async () => {
    const g = await garage('approved', new Date('2025-11-02T08:00:00Z'));
    await entry(g.id, new Date('2025-11-02T08:00:00Z'));
    await entry(g.id, new Date('2025-11-08T08:00:00Z'));

    expect(await approvedThisMonth()).toBe(1);
  });

  it('counts a garage whose only approval entry is in this month', async () => {
    const g = await garage('approved', new Date('2025-11-02T08:00:00Z'));
    await entry(g.id, new Date('2025-11-02T08:00:00Z'));

    expect(await approvedThisMonth()).toBe(1);
  });

  it('counts a first approval at the very first instant of the month in Bucharest', async () => {
    const g = await garage('approved', MONTH_START);
    await entry(g.id, MONTH_START);

    expect(await approvedThisMonth()).toBe(1);
  });

  it('leaves out an approval entry one millisecond before the month began', async () => {
    const g = await garage('approved', new Date('2025-11-03T08:00:00Z'));
    await entry(g.id, new Date(MONTH_START.getTime() - 1));

    expect(await approvedThisMonth()).toBe(0);
  });

  it('counts an approval at 23:59 Bucharest on the last day in the month it ended, not the next', async () => {
    const g = await garage('approved', new Date('2025-10-31T21:59:00Z'));
    await entry(g.id, new Date('2025-10-31T21:59:00Z'));

    expect(await approvedThisMonth()).toBe(0);
    expect(await approvedThisMonth(new Date('2025-10-31T21:59:30Z'))).toBe(1);
  });

  it.each([
    ['another subject type', { subjectType: 'account' }],
    ['another field', { field: 'name' }],
    ['no field', { field: null }],
    ['another value', { newValue: 'suspended' }],
  ])('still counts a garage whose earlier entry is for %s', async (_, over) => {
    const g = await garage('approved', new Date('2025-11-04T08:00:00Z'));
    await entry(g.id, new Date('2025-08-20T08:00:00Z'), over);
    await entry(g.id, new Date('2025-11-04T08:00:00Z'));

    expect(await approvedThisMonth()).toBe(1);
  });

  it('still counts a garage when the earlier approval belongs to another garage', async () => {
    const mine = await garage('approved', new Date('2025-11-04T08:00:00Z'));
    const other = await garage('draft', null);
    await entry(other.id, new Date('2025-08-20T08:00:00Z'));
    await entry(mine.id, new Date('2025-11-04T08:00:00Z'));

    expect(await approvedThisMonth()).toBe(1);
  });

  it('counts a garage with no entries at all when its date is in the month', async () => {
    await garage('approved', new Date('2025-11-04T08:00:00Z'));

    expect(await approvedThisMonth()).toBe(1);
  });

  it('leaves a re-approved garage out of the snapshot row too', async () => {
    const g = await garage('approved', new Date('2025-11-04T08:00:00Z'));
    await entry(g.id, new Date('2025-08-20T08:00:00Z'));
    await garage('approved', new Date('2025-11-05T08:00:00Z'));

    await writeSnapshot(prisma, now);

    const [row] = await prisma.platformDaily.findMany();
    expect([row.garagesListed, row.garagesApprovedThisMonth]).toEqual([2, 1]);
  });
});

describe('snapshot day keys at the clock changes and month ends', () => {
  const keyed = async (at: string) => {
    await prisma.$executeRawUnsafe('TRUNCATE platform_daily');
    await writeSnapshot(prisma, new Date(at));
    const rows = await prisma.platformDaily.findMany();
    return rows.map((r) => r.day.toISOString().slice(0, 10));
  };

  it.each([
    ['2026-03-28T21:59:59Z', '2026-03-28'],
    ['2026-03-28T22:00:00Z', '2026-03-29'],
    ['2026-03-29T00:59:59Z', '2026-03-29'],
    ['2026-03-29T21:00:00Z', '2026-03-30'],
    ['2026-10-24T20:59:59Z', '2026-10-24'],
    ['2026-10-24T21:00:00Z', '2026-10-25'],
    ['2026-10-25T21:59:59Z', '2026-10-25'],
    ['2026-10-25T22:00:00Z', '2026-10-26'],
    ['2026-02-28T22:00:00Z', '2026-03-01'],
    ['2026-12-31T21:59:59Z', '2026-12-31'],
    ['2026-12-31T22:00:00Z', '2027-01-01'],
    ['2028-02-28T22:00:00Z', '2028-02-29'],
    ['2028-02-29T22:00:00Z', '2028-03-01'],
  ])('keys a run at %s to %s', async (at, day) => {
    expect(await keyed(at)).toEqual([day]);
  });

  it('writes the 01:00 runs on the clock-change days to those days', async () => {
    expect(await keyed('2026-03-28T23:00:00Z')).toEqual(['2026-03-29']);
    expect(await keyed('2026-10-24T22:00:00Z')).toEqual(['2026-10-25']);
  });

  it('writes two runs on either side of a month end to two different rows', async () => {
    await writeSnapshot(prisma, new Date('2026-10-30T22:00:00Z'));
    await writeSnapshot(prisma, new Date('2026-10-31T22:00:00Z'));

    const rows = await prisma.platformDaily.findMany({
      orderBy: { day: 'asc' },
    });
    expect(rows.map((r) => r.day.toISOString().slice(0, 10))).toEqual([
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('reads the first-of-month row from the first instant of the month in Bucharest', async () => {
    await prisma.platformDaily.createMany({
      data: [
        ['2026-10-01', 10],
        ['2026-11-01', 20],
      ].map(([day, activeDrivers]) => ({
        activeDrivers: activeDrivers as number,
        day: new Date(day as string),
        garagesApprovedThisMonth: 0,
        garagesListed: 0,
        writtenAt: new Date(`${day}T00:00:00Z`),
      })),
    });

    expect(
      await monthStartSnapshot(prisma, new Date('2026-10-31T21:59:59Z')),
    ).toBe(10);
    expect(
      await monthStartSnapshot(prisma, new Date('2026-10-31T22:00:00Z')),
    ).toBe(20);
  });

  it('finds no month-start row for a month whose first night was missed, whatever the other months hold', async () => {
    await prisma.platformDaily.create({
      data: {
        activeDrivers: 5,
        day: new Date('2026-11-02'),
        garagesApprovedThisMonth: 0,
        garagesListed: 0,
        writtenAt: new Date('2026-11-02T01:00:00Z'),
      },
    });

    expect(
      await monthStartSnapshot(prisma, new Date('2026-11-10T10:00:00Z')),
    ).toBeUndefined();
  });
});

describe('the entries these cases leave behind', () => {
  it('dates none of them after the real clock, so later readers of "since now" never see them', async () => {
    const ahead = await prisma.activityLog.count({
      where: { at: { gt: new Date() }, subjectId: { in: written } },
    });

    expect(written.length).toBeGreaterThan(0);
    expect(ahead).toBe(0);
  });
});
