import { randomUUID } from 'node:crypto';

import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

beforeEach(() => reset());
afterAll(() => prisma.$disconnect());

const holidaysOf = async (year: number) =>
  (
    await prisma.publicHoliday.findMany({
      orderBy: { day: 'asc' },
      where: {
        day: {
          gte: new Date(`${year}-01-01T00:00:00Z`),
          lte: new Date(`${year}-12-31T00:00:00Z`),
        },
      },
    })
  ).map((row) => ({
    day: row.day.toISOString().slice(0, 10),
    nameEn: row.nameEn,
    nameRo: row.nameRo,
  }));

const days = (rows: { day: string }[]) => rows.map((row) => row.day.slice(5));

describe('the legal holiday calendar', () => {
  it('holds the sixteen days of 2026, 1 June once with both of its names', async () => {
    const rows = await holidaysOf(2026);

    expect(days(rows)).toEqual([
      '01-01',
      '01-02',
      '01-06',
      '01-07',
      '01-24',
      '04-10',
      '04-12',
      '04-13',
      '05-01',
      '05-31',
      '06-01',
      '08-15',
      '11-30',
      '12-01',
      '12-25',
      '12-26',
    ]);
    expect(rows.find((row) => row.day === '2026-06-01')).toEqual({
      day: '2026-06-01',
      nameEn: "Children's Day / Whit Monday",
      nameRo: 'Ziua Copilului / A doua zi de Rusalii',
    });
    expect(rows.find((row) => row.day === '2026-12-01')).toEqual({
      day: '2026-12-01',
      nameEn: 'National Day',
      nameRo: 'Ziua Națională',
    });
  });

  it('holds the seventeen days of 2027, with Orthodox Easter on 2 and 3 May', async () => {
    const rows = await holidaysOf(2027);

    expect(days(rows)).toEqual([
      '01-01',
      '01-02',
      '01-06',
      '01-07',
      '01-24',
      '04-30',
      '05-01',
      '05-02',
      '05-03',
      '06-01',
      '06-20',
      '06-21',
      '08-15',
      '11-30',
      '12-01',
      '12-25',
      '12-26',
    ]);
    expect(rows.find((row) => row.day === '2027-05-03')).toMatchObject({
      nameEn: 'Orthodox Easter',
      nameRo: 'Paștele ortodox',
    });
    expect(rows.find((row) => row.day === '2027-06-01')).toMatchObject({
      nameEn: "Children's Day",
      nameRo: 'Ziua Copilului',
    });
  });

  it('gives every day a Romanian and an English name', async () => {
    const rows = [...(await holidaysOf(2026)), ...(await holidaysOf(2027))];

    for (const row of rows) {
      expect(row.nameRo.trim()).not.toBe('');
      expect(row.nameEn.trim()).not.toBe('');
    }
  });

  it('holds a day only once', async () => {
    await expect(
      prisma.publicHoliday.create({
        data: {
          day: new Date('2026-12-25T00:00:00Z'),
          nameEn: 'Christmas',
          nameRo: 'Crăciunul',
        },
      }),
    ).rejects.toThrow();
  });
});

describe("a garage's closed days and facilities", () => {
  const garage = () =>
    prisma.garage.create({
      data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
    });

  it('starts a garage with no hours', async () => {
    expect((await garage()).hours).toEqual({});
  });

  it('keeps a note of 80 characters and refuses one of 81', async () => {
    const { id } = await garage();

    await prisma.garageClosedDay.create({
      data: {
        day: new Date('2026-12-27T00:00:00Z'),
        garageId: id,
        note: 'x'.repeat(80),
      },
    });
    await expect(
      prisma.garageClosedDay.create({
        data: {
          day: new Date('2026-12-28T00:00:00Z'),
          garageId: id,
          note: 'x'.repeat(81),
        },
      }),
    ).rejects.toThrow();
  });

  it('holds a day once per garage', async () => {
    const { id } = await garage();
    const day = new Date('2026-12-27T00:00:00Z');

    await prisma.garageClosedDay.create({ data: { day, garageId: id } });
    await expect(
      prisma.garageClosedDay.create({ data: { day, garageId: id } }),
    ).rejects.toThrow();
  });

  it('lists a facility once per garage, as listed by default', async () => {
    const { id } = await garage();

    const row = await prisma.garageFacility.create({
      data: { facility: 'waiting_area', garageId: id },
    });

    expect(row.status).toBe('listed');
    await expect(
      prisma.garageFacility.create({
        data: { facility: 'waiting_area', garageId: id },
      }),
    ).rejects.toThrow();
  });

  it('loses its closed days and facilities with the garage', async () => {
    const { id } = await garage();
    await prisma.garageClosedDay.create({
      data: { day: new Date('2026-12-27T00:00:00Z'), garageId: id },
    });
    await prisma.garageFacility.create({
      data: { facility: 'courtesy_car', garageId: id },
    });

    await prisma.garage.delete({ where: { id } });

    expect(
      await prisma.garageClosedDay.count({ where: { garageId: id } }),
    ).toBe(0);
    expect(await prisma.garageFacility.count({ where: { garageId: id } })).toBe(
      0,
    );
  });
});
