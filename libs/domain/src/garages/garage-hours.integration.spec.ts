import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { writeGarageHours } from './garage-hours';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const TODAY = '2026-10-07';

const hours = {
  fri: [['08:00', '17:00']],
  mon: [
    ['08:00', '12:00'],
    ['13:00', '17:00'],
  ],
  sat: [['09:00', '13:00']],
  sun: [],
  thu: [['08:00', '17:00']],
  tue: [['08:00', '17:00']],
  wed: [['08:00', '17:00']],
};

let garageId: string;

beforeEach(async () => {
  await reset();
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
});
afterAll(() => prisma.$disconnect());

const write = (section: Record<string, unknown>, today = TODAY) =>
  prisma.$transaction((tx) => writeGarageHours(tx, garageId, section, today));

const stored = async () => {
  const garage = await prisma.garage.findUniqueOrThrow({
    where: { id: garageId },
  });
  const closedDays = await prisma.garageClosedDay.findMany({
    orderBy: { day: 'asc' },
    where: { garageId },
  });
  const facilities = await prisma.garageFacility.findMany({
    orderBy: { facility: 'asc' },
    where: { garageId },
  });
  return {
    closedDays: closedDays.map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      note: row.note,
    })),
    facilities: facilities.map((row) => [row.facility, row.status]),
    hours: garage.hours,
  };
};

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
};

describe("writing a garage's hours, closed days and facilities", () => {
  it('writes the weekly hours, one closed day with its note and one listed facility', async () => {
    await write({
      closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
      facilities: ['waiting_area'],
      hours,
    });

    expect(await stored()).toEqual({
      closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
      facilities: [['waiting_area', 'listed']],
      hours,
    });
  });

  it('writes a closed day without a note as no note', async () => {
    await write({ closedDays: [{ day: '2026-12-27' }] });

    expect((await stored()).closedDays).toEqual([
      { day: '2026-12-27', note: null },
    ]);
  });

  it('writes the starting timetable when the section holds no hours', async () => {
    await write({ facilities: ['courtesy_car'] });

    expect((await stored()).hours).toEqual({
      fri: [['08:00', '17:00']],
      mon: [['08:00', '17:00']],
      sat: [],
      sun: [],
      thu: [['08:00', '17:00']],
      tue: [['08:00', '17:00']],
      wed: [['08:00', '17:00']],
    });
  });

  it('writes no row for a legal holiday or a day already past', async () => {
    await write({
      closedDays: [
        { day: '2026-12-01', note: 'Ziua Națională' },
        { day: '2026-10-06', note: 'ieri' },
        { day: '2026-12-27', note: 'Inventar' },
      ],
      hours,
    });

    expect((await stored()).closedDays).toEqual([
      { day: '2026-12-27', note: 'Inventar' },
    ]);
  });

  it("keeps a closed day on the write's own today", async () => {
    await write({ closedDays: [{ day: TODAY }] });

    expect((await stored()).closedDays).toEqual([{ day: TODAY, note: null }]);
  });

  it('replaces the closed days and facilities whole on a second write', async () => {
    await write({
      closedDays: [{ day: '2026-12-27' }, { day: '2026-12-28' }],
      facilities: ['waiting_area', 'courtesy_car'],
      hours,
    });

    await write({
      closedDays: [{ day: '2026-12-29', note: 'Inventar' }],
      facilities: ['pickup_dropoff'],
    });

    expect(await stored()).toEqual({
      closedDays: [{ day: '2026-12-29', note: 'Inventar' }],
      facilities: [['pickup_dropoff', 'listed']],
      hours: expect.objectContaining({ sat: [], sun: [] }),
    });
  });

  it('leaves other garages alone', async () => {
    const other = await prisma.garage.create({
      data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
    });
    await prisma.garageFacility.create({
      data: { facility: 'courtesy_car', garageId: other.id },
    });

    await write({ facilities: [] });

    expect(
      await prisma.garageFacility.count({ where: { garageId: other.id } }),
    ).toBe(1);
  });

  it.each([
    [
      'a third interval',
      {
        hours: {
          ...hours,
          mon: [
            ['08:00', '10:00'],
            ['11:00', '12:00'],
            ['13:00', '17:00'],
          ],
        },
      },
    ],
    [
      'two overlapping intervals',
      {
        hours: {
          ...hours,
          mon: [
            ['08:00', '13:00'],
            ['12:00', '17:00'],
          ],
        },
      },
    ],
    ['a time off the grid', { hours: { ...hours, tue: [['08:10', '17:00']] } }],
    [
      'a note of 81 characters',
      { closedDays: [{ day: '2026-12-27', note: 'x'.repeat(81) }] },
    ],
    ['an unknown facility', { facilities: ['car_wash'] }],
  ])('refuses %s whole and keeps what was there', async (_, section) => {
    await write({
      closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
      facilities: ['waiting_area'],
      hours,
    });
    const before = await stored();

    const refused = await refusalOf(write(section));

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    expect(await stored()).toEqual(before);
  });

  it('writes nothing to the history or the outbox', async () => {
    const history = await prisma.activityLog.count();
    const events = await prisma.outboxEvent.count();

    await write({ facilities: ['waiting_area'], hours });

    expect(await prisma.activityLog.count()).toBe(history);
    expect(await prisma.outboxEvent.count()).toBe(events);
  });
});
