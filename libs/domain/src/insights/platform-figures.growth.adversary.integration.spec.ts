import { readGrowth } from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE platform_daily');
});

const row = (day: string, activeDrivers: number, garagesListed: number) =>
  prisma.platformDaily.create({
    data: {
      activeDrivers,
      day: new Date(day),
      garagesApprovedThisMonth: 0,
      garagesListed,
      writtenAt: new Date(`${day}T00:00:00Z`),
    },
  });

const monthOf = async (at: Date, month: string) =>
  (await readGrowth(prisma, at)).months.find((m) => m.month === month);

describe('the growth across year boundaries', () => {
  it('ends with January and starts twelve months earlier when the current month is January', async () => {
    const { months } = await readGrowth(
      prisma,
      new Date('2026-01-15T10:00:00Z'),
    );

    expect(months.map((m) => m.month)).toEqual([
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('closes December with the row of the first of January', async () => {
    await row('2025-12-31', 1, 1);
    await row('2026-01-01', 900, 90);

    await expect(
      monthOf(new Date('2026-03-10T10:00:00Z'), '2025-12'),
    ).resolves.toStrictEqual({
      activeDrivers: 900,
      garagesListed: 90,
      month: '2025-12',
    });
  });

  it('closes December with its own last day when the first of January is missing', async () => {
    await row('2025-12-31', 800, 80);

    await expect(
      monthOf(new Date('2026-03-10T10:00:00Z'), '2025-12'),
    ).resolves.toStrictEqual({
      activeDrivers: 800,
      garagesListed: 80,
      month: '2025-12',
    });
  });

  it('never closes December of one year with the row of December thirty-first of another', async () => {
    await row('2024-12-31', 5, 5);
    await row('2027-01-01', 6, 6);

    await expect(
      monthOf(new Date('2026-03-10T10:00:00Z'), '2025-12'),
    ).resolves.toStrictEqual({ month: '2025-12' });
  });

  it('reads January live and closes the month before it from the first of January', async () => {
    await row('2026-01-01', 700, 70);
    await row('2026-01-15', 999, 99);

    const { months } = await readGrowth(
      prisma,
      new Date('2026-01-15T10:00:00Z'),
    );

    expect(months.at(-2)).toStrictEqual({
      activeDrivers: 700,
      garagesListed: 70,
      month: '2025-12',
    });
    expect(months.at(-1)).toStrictEqual({
      activeDrivers: 0,
      garagesListed: 0,
      month: '2026-01',
    });
  });
});

describe('the growth around clock changes and month ends', () => {
  it('is still March at the last second of March in Bucharest, summer time', async () => {
    const last = await readGrowth(prisma, new Date('2026-03-31T20:59:59Z'));
    const first = await readGrowth(prisma, new Date('2026-03-31T21:00:00Z'));

    expect(last.months.at(-1)?.month).toBe('2026-03');
    expect(first.months.at(-1)?.month).toBe('2026-04');
  });

  it('is still October at the last second of October in Bucharest, winter time', async () => {
    const last = await readGrowth(prisma, new Date('2026-10-31T21:59:59Z'));
    const first = await readGrowth(prisma, new Date('2026-10-31T22:00:00Z'));

    expect(last.months.at(-1)?.month).toBe('2026-10');
    expect(first.months.at(-1)?.month).toBe('2026-11');
  });

  it('stays in the same month across the day the clocks go forward', async () => {
    const before = await readGrowth(prisma, new Date('2026-03-29T00:30:00Z'));
    const after = await readGrowth(prisma, new Date('2026-03-29T23:30:00Z'));

    expect(before.months.map((m) => m.month)).toEqual(
      after.months.map((m) => m.month),
    );
    expect(before.months.at(-1)?.month).toBe('2026-03');
  });

  it('closes October with the first of November across the day the clocks go back', async () => {
    await row('2026-10-25', 11, 1);
    await row('2026-10-31', 22, 2);
    await row('2026-11-01', 33, 3);

    await expect(
      monthOf(new Date('2026-12-05T10:00:00Z'), '2026-10'),
    ).resolves.toStrictEqual({
      activeDrivers: 33,
      garagesListed: 3,
      month: '2026-10',
    });
  });

  it('falls back to the twenty-ninth of February in a leap year', async () => {
    await row('2028-02-28', 1, 1);
    await row('2028-02-29', 2, 2);

    await expect(
      monthOf(new Date('2028-04-10T10:00:00Z'), '2028-02'),
    ).resolves.toStrictEqual({
      activeDrivers: 2,
      garagesListed: 2,
      month: '2028-02',
    });
  });

  it('falls back to the twenty-eighth of February in a common year', async () => {
    await row('2027-02-28', 4, 4);

    await expect(
      monthOf(new Date('2027-04-10T10:00:00Z'), '2027-02'),
    ).resolves.toStrictEqual({
      activeDrivers: 4,
      garagesListed: 4,
      month: '2027-02',
    });
  });
});

describe('the growth reading closing rows', () => {
  const now = new Date('2026-11-10T10:00:00Z');

  it('ignores a row that is neither the first nor the last day of a month', async () => {
    await row('2026-03-02', 10, 1);
    await row('2026-03-15', 20, 2);
    await row('2026-03-30', 30, 3);
    await row('2026-04-02', 40, 4);

    await expect(monthOf(now, '2026-03')).resolves.toStrictEqual({
      month: '2026-03',
    });
  });

  it('prefers the first-day row over the last-day row even when the first is lower', async () => {
    await row('2026-05-31', 500, 50);
    await row('2026-06-01', 0, 0);

    await expect(monthOf(now, '2026-05')).resolves.toStrictEqual({
      activeDrivers: 0,
      garagesListed: 0,
      month: '2026-05',
    });
  });

  it('does not let one month take the row that closes its neighbour', async () => {
    await row('2026-06-01', 600, 60);

    await expect(monthOf(now, '2026-05')).resolves.toStrictEqual({
      activeDrivers: 600,
      garagesListed: 60,
      month: '2026-05',
    });
    await expect(monthOf(now, '2026-06')).resolves.toStrictEqual({
      month: '2026-06',
    });
  });

  it('leaves a month empty when only the first day of its own month has a row', async () => {
    await row('2026-07-01', 700, 70);

    await expect(monthOf(now, '2026-07')).resolves.toStrictEqual({
      month: '2026-07',
    });
  });

  it('ignores rows older than the window and answers exactly twelve months', async () => {
    await row('2024-01-01', 9, 9);
    await row('2025-11-30', 8, 8);
    await row('2025-12-01', 7, 7);

    const { months } = await readGrowth(prisma, now);

    expect(months).toHaveLength(12);
    expect(months[0]).toStrictEqual({ month: '2025-12' });
    expect(JSON.stringify(months)).not.toContain('"activeDrivers":9');
  });

  it('shows a zero in each figure independently of the other', async () => {
    await row('2026-09-01', 0, 12);
    await row('2026-10-01', 34, 0);

    await expect(monthOf(now, '2026-08')).resolves.toStrictEqual({
      activeDrivers: 0,
      garagesListed: 12,
      month: '2026-08',
    });
    await expect(monthOf(now, '2026-09')).resolves.toStrictEqual({
      activeDrivers: 34,
      garagesListed: 0,
      month: '2026-09',
    });
  });

  it('answers the same twice, with only the month key on an empty database', async () => {
    const first = await readGrowth(prisma, now);
    const second = await readGrowth(prisma, now);

    expect(second).toStrictEqual(first);
    expect(first.months.slice(0, 11)).toStrictEqual(
      [
        '2025-12',
        '2026-01',
        '2026-02',
        '2026-03',
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
        '2026-10',
      ].map((month) => ({ month })),
    );
  });

  it('serialises a missing figure as an absent field, not null', async () => {
    const { months } = await readGrowth(prisma, now);

    expect(JSON.parse(JSON.stringify(months[0]))).toStrictEqual({
      month: '2025-12',
    });
  });
});
