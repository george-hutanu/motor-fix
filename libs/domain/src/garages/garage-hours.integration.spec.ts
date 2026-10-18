import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { writeGarageHours } from './garage-hours';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
const audit = new AuditService();
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
let actorId: string;

beforeEach(async () => {
  await reset();
  actorId = await account('Mihai Pop', ['garage']);
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
});
afterAll(() => prisma.$disconnect());

const write = (section: Record<string, unknown>, today = TODAY) =>
  prisma.$transaction((tx) =>
    writeGarageHours(tx, garageId, section, today, { actorId, audit }),
  );

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

  it('writes no row for a day past the two-year window, keeping its last day', async () => {
    await write({
      closedDays: [
        { day: '2028-10-07' },
        { day: '2028-10-08' },
        { day: '2030-01-02' },
      ],
      hours,
    });

    expect((await stored()).closedDays).toEqual([
      { day: '2028-10-07', note: null },
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

  it('writes nothing to the outbox', async () => {
    const events = await prisma.outboxEvent.count();

    await write({ facilities: ['waiting_area'], hours });

    expect(await prisma.outboxEvent.count()).toBe(events);
  });
});

describe("the history of a garage's hours, closed days and facilities", () => {
  const entries = () =>
    prisma.activityLog.findMany({
      orderBy: [{ subjectType: 'asc' }, { action: 'asc' }, { at: 'asc' }],
      where: { garageId },
    });
  const lines = async () =>
    (await entries()).map((e) => [
      e.subjectType,
      e.action,
      e.field,
      e.oldValue,
      e.newValue,
    ]);

  // @traces 304-request-garage-details-FR-010
  it('records the hours changed, each closed day and facility added or removed, by the garage', async () => {
    await write({
      closedDays: [
        { day: '2026-12-27' },
        { day: '2026-12-28', note: 'Inventar' },
      ],
      facilities: ['waiting_area', 'courtesy_car'],
      hours,
    });
    const seen = (await entries()).map((e) => e.id);
    const saturday = { ...hours, sat: [] };

    await write({
      closedDays: [
        { day: '2026-12-28', note: 'Inventar anual' },
        { day: '2026-12-29' },
      ],
      facilities: ['waiting_area', 'pickup_dropoff'],
      hours: saturday,
    });

    const second = (await entries()).filter((e) => !seen.includes(e.id));
    expect(second.every((e) => e.actorId === actorId)).toBe(true);
    expect(second.every((e) => e.actorRole === 'owner')).toBe(true);
    expect(second.every((e) => !e.internal)).toBe(true);
    expect(
      second.map((e) => [
        e.subjectType,
        e.action,
        e.field,
        e.oldValue,
        e.newValue,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['garage', 'update', 'hours', hours, saturday],
        [
          'garage_closed_day',
          'delete',
          null,
          { day: '2026-12-27', note: null },
          null,
        ],
        [
          'garage_closed_day',
          'update',
          'note',
          { day: '2026-12-28', note: 'Inventar' },
          { day: '2026-12-28', note: 'Inventar anual' },
        ],
        [
          'garage_closed_day',
          'create',
          null,
          null,
          { day: '2026-12-29', note: null },
        ],
        ['garage_facility', 'delete', null, { facility: 'courtesy_car' }, null],
        [
          'garage_facility',
          'create',
          null,
          null,
          { facility: 'pickup_dropoff' },
        ],
      ]),
    );
    expect(second).toHaveLength(6);
  });

  // @traces 304-request-garage-details-FR-010
  it('records the first write whole: the hours, every closed day and facility', async () => {
    await write({
      closedDays: [{ day: '2026-12-27' }],
      facilities: ['waiting_area'],
      hours,
    });

    expect(await lines()).toEqual([
      ['garage', 'update', 'hours', {}, hours],
      [
        'garage_closed_day',
        'create',
        null,
        null,
        { day: '2026-12-27', note: null },
      ],
      ['garage_facility', 'create', null, null, { facility: 'waiting_area' }],
    ]);
  });

  // @traces 304-request-garage-details-FR-010
  it('records nothing when the same section is written again', async () => {
    const section = {
      closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
      facilities: ['waiting_area'],
      hours,
    };
    await write(section);
    const before = await prisma.activityLog.count();

    await write(section);

    expect(await prisma.activityLog.count()).toBe(before);
  });

  // @traces 304-request-garage-details-FR-010
  it('records nothing for a write that is refused or rolled back', async () => {
    await refusalOf(write({ hours: { mon: 'all day' } }));
    await expect(
      prisma.$transaction(async (tx) => {
        await writeGarageHours(tx, garageId, { hours }, TODAY, {
          actorId,
          audit,
        });
        throw new Error('sending failed');
      }),
    ).rejects.toThrow('sending failed');

    expect(await prisma.activityLog.count({ where: { garageId } })).toBe(0);
  });
});
