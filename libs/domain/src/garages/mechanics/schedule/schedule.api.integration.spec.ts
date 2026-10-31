import { randomUUID } from 'node:crypto';

import { todayInBucharest, type WeeklyHours } from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { addDays, atLocal } from '../../../bucharest';
import { outboxMark } from '../../../events/outbox.testing';
import { heldOpen } from '../../../held-open.testing';
import { BrevoMock } from '../../../notifications/brevo/brevo-mock.testing';
import { NotificationsModule } from '../../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../../notifications/notifications.testing';
import { quotesWorld } from '../../../quotes/quotes.testing';
import { UNUSED_STORAGE } from '../../../storage/s3-test-store';
import { StorageModule } from '../../../storage/storage.module';
import { GaragesModule } from '../../garages.module';

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
const bookings = quotesWorld(prisma);
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;
let mark: bigint;

beforeAll(async () => {
  await brevo.start();
  const email = testConfig(brevo.url);
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    {
      databaseUrl,
      email,
      push: {
        privateKey: 'private',
        publicKey: 'public',
        subject: 'mailto:ops@example.test',
      },
      redisUrl,
    },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      StorageModule.register(UNUSED_STORAGE),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  brevo.reset();
  mark = await outboxMark(prisma);
});

afterEach(() => jest.restoreAllMocks());

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const http = () => request(app.getHttpServer());
const signed = (call: request.Test, auth?: string) =>
  auth ? call.set('Authorization', auth) : call;
const base = (garageId: string, mechanicId: string) =>
  `/garages/${garageId}/mechanics/${mechanicId}`;
const read = (garageId: string, mechanicId: string, auth?: string) =>
  signed(http().get(`${base(garageId, mechanicId)}/hours`), auth);
const write = (
  garageId: string,
  mechanicId: string,
  body: object,
  auth?: string,
) => signed(http().put(`${base(garageId, mechanicId)}/hours`), auth).send(body);
const addOff = (
  garageId: string,
  mechanicId: string,
  body: object,
  auth?: string,
) =>
  signed(http().post(`${base(garageId, mechanicId)}/days-off`), auth).send(
    body,
  );
const removeOff = (
  garageId: string,
  mechanicId: string,
  dayOffId: string,
  auth?: string,
) =>
  signed(
    http().delete(`${base(garageId, mechanicId)}/days-off/${dayOffId}`),
    auth,
  );

const SPLIT: WeeklyHours[keyof WeeklyHours] = [
  ['08:00', '12:00'],
  ['13:00', '18:00'],
];
const GARAGE_HOURS: WeeklyHours = {
  fri: SPLIT,
  mon: SPLIT,
  sat: [['09:00', '13:00']],
  sun: [],
  thu: SPLIT,
  tue: SPLIT,
  wed: SPLIT,
};
const week = (
  day: WeeklyHours[keyof WeeklyHours],
  extra: Partial<WeeklyHours> = {},
): WeeklyHours => ({
  fri: day,
  mon: day,
  sat: [],
  sun: [],
  thu: day,
  tue: day,
  wed: day,
  ...extra,
});
const OWN = week([['08:00', '16:30']]);

const today = () => todayInBucharest();
// The first day after today that falls on `weekday` (0 Sunday … 6 Saturday).
const next = (weekday: number) => {
  let day = addDays(today(), 1);
  while (new Date(day).getUTCDay() !== weekday) day = addDays(day, 1);
  return day;
};
const date = (day: string) => new Date(`${day}T00:00:00Z`);

// Atelier Dinamo (Monday to Friday split, Saturday morning) with its owner
// Mihai, a receptionist, a mechanic with an account and Elena's card;
// Atelier Nord with its owner Radu and a card of its own.
async function world({ hours = GARAGE_HOURS }: { hours?: object } = {}) {
  const dinamo = await prisma.garage.create({
    data: { hours, name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const nord = await prisma.garage.create({
    data: { name: 'Atelier Nord', slug: `nord-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: dinamo.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: dinamo.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic']);
  await prisma.mechanic.create({
    data: { accountId: vlad, garageId: dinamo.id, name: 'Tudor Vlad' },
  });
  const elena = await prisma.mechanic.create({
    data: { garageId: dinamo.id, name: 'Elena Stan' },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: nord.id, role: 'owner' },
  });
  const nordCard = await prisma.mechanic.create({
    data: { garageId: nord.id, name: 'Ion Nord' },
  });
  const owner = bearer(mihai, 'garage');
  return { dinamo, elena, ioana, mihai, nord, nordCard, owner, radu, vlad };
}

const setHours = (mechanicId: string, workingHours: object | null) =>
  prisma.$executeRaw`UPDATE mechanic SET working_hours = ${
    workingHours === null ? null : JSON.stringify(workingHours)
  }::jsonb WHERE id = ${mechanicId}::uuid`;

const dayOff = (mechanicId: string, firstDay: string, lastDay = firstDay) =>
  prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO mechanic_day_off (mechanic_id, first_day, last_day, created_by)
    VALUES (${mechanicId}::uuid, ${firstDay}::date, ${lastDay}::date, gen_random_uuid())
    RETURNING id`.then(([row]) => row.id);

const daysOffOf = (mechanicId: string) =>
  prisma.$queryRaw<{ first_day: Date; last_day: Date; note: string | null }[]>`
    SELECT first_day, last_day, note FROM mechanic_day_off
    WHERE mechanic_id = ${mechanicId}::uuid ORDER BY first_day`;

const rowOf = (mechanicId: string) =>
  prisma.$queryRaw<{ working_hours: unknown; works_saturdays: boolean }[]>`
    SELECT working_hours, works_saturdays FROM mechanic
    WHERE id = ${mechanicId}::uuid`.then(([row]) => row);

const outbox = () =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { id: { gt: mark }, kind: 'mechanic.updated' },
  });
const entries = (subjectType: string, garageId: string) =>
  prisma.activityLog.findMany({
    orderBy: [{ at: 'asc' }, { field: 'asc' }],
    where: { garageId, subjectType },
  });

async function writesOf(garageId: string) {
  const [cards, daysOff, audit, events] = await Promise.all([
    prisma.$queryRaw`SELECT id, working_hours, works_saturdays FROM mechanic WHERE garage_id = ${garageId}::uuid ORDER BY id`,
    prisma.$queryRaw`SELECT d.* FROM mechanic_day_off d JOIN mechanic m ON m.id = d.mechanic_id WHERE m.garage_id = ${garageId}::uuid ORDER BY d.id`,
    prisma.activityLog.count({ where: { garageId } }),
    prisma.outboxEvent.count({
      where: { id: { gt: mark }, kind: { startsWith: 'mechanic.' } },
    }),
  ]);
  return { audit, cards, daysOff, events };
}

const switchOff = (garageId: string) =>
  prisma.garageFeature.create({
    data: { enabled: false, garageId, key: 'team_mechanics' },
  });

const codes = (res: request.Response) =>
  (res.body.errors as { code: string; field: string }[]).map(
    ({ code, field }) => [field, code],
  );

// @traces 058-FR-002 058-FR-008
describe('reading a mechanic schedule', () => {
  it("answers a card with no hours of its own the garage's weekdays, each as one stretch, and no weekend", async () => {
    const { dinamo, elena, owner } = await world();

    const res = await read(dinamo.id, elena.id, owner);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      daysOff: [],
      garageHours: GARAGE_HOURS,
      isDefault: true,
      workingHours: week([['08:00', '18:00']]),
      worksSaturdays: false,
    });
  });

  it('answers an empty week for a garage that set no hours', async () => {
    const { dinamo, elena, owner } = await world({ hours: {} });

    const res = await read(dinamo.id, elena.id, owner);

    expect(res.body).toMatchObject({ isDefault: true, workingHours: week([]) });
  });

  it('reads garage hours stored in another shape as a day with no hours', async () => {
    const { dinamo, elena, owner } = await world({
      hours: { mon: 'closed', tue: [['08:00', '16:00']] },
    });

    const res = await read(dinamo.id, elena.id, owner);

    expect(res.status).toBe(200);
    expect(res.body.workingHours).toMatchObject({
      mon: [],
      tue: [['08:00', '16:00']],
    });
  });

  it('reads a day stored with two intervals as one stretch, leaving the row as it was', async () => {
    const { dinamo, elena, owner } = await world();
    const stored = week(SPLIT);
    await setHours(elena.id, stored);

    const res = await read(dinamo.id, elena.id, owner);

    expect(res.body).toMatchObject({
      isDefault: false,
      workingHours: week([['08:00', '18:00']]),
    });
    expect((await rowOf(elena.id)).working_hours).toEqual(stored);
  });

  // @traces 058-FR-005
  it('lists the days off ending today or later by first day, and none that ended', async () => {
    const { dinamo, elena, owner } = await world();
    const later = await dayOff(
      elena.id,
      addDays(today(), 20),
      addDays(today(), 22),
    );
    const running = await dayOff(elena.id, addDays(today(), -2), today());
    await dayOff(elena.id, addDays(today(), -9), addDays(today(), -5));
    await prisma.$executeRaw`UPDATE mechanic_day_off SET note = 'Concediu' WHERE id = ${later}::uuid`;

    const res = await read(dinamo.id, elena.id, owner);

    expect(res.body.daysOff).toEqual([
      {
        firstDay: addDays(today(), -2),
        id: running,
        lastDay: today(),
        note: null,
      },
      {
        firstDay: addDays(today(), 20),
        id: later,
        lastDay: addDays(today(), 22),
        note: 'Concediu',
      },
    ]);
  });
});

// @traces 058-FR-001 058-FR-003 058-FR-008
describe('saving a mechanic week', () => {
  it('saves her stretches and the Saturday switch, and reads them back', async () => {
    const { dinamo, elena, owner } = await world();
    const hours = week([['08:00', '16:30']], { sat: [['09:00', '13:00']] });

    const res = await write(
      dinamo.id,
      elena.id,
      { workingHours: hours, worksSaturdays: true },
      owner,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      isDefault: false,
      workingHours: hours,
      worksSaturdays: true,
    });
    expect((await read(dinamo.id, elena.id, owner)).body).toMatchObject({
      workingHours: hours,
      worksSaturdays: true,
    });
    expect(await rowOf(elena.id)).toEqual({
      working_hours: hours,
      works_saturdays: true,
    });
  });

  it("takes a stretch at the garage's first opening and last closing, across its lunch break", async () => {
    const { dinamo, elena, owner } = await world();

    const res = await write(
      dinamo.id,
      elena.id,
      { workingHours: week([['08:00', '18:00']]), worksSaturdays: false },
      owner,
    );

    expect(res.status).toBe(200);
  });

  it.each([
    ['an end at its start', [['10:00', '10:00']], 'order'],
    ['an end before its start', [['12:00', '10:00']], 'order'],
    ['a time off the grid', [['08:10', '12:00']], 'grid'],
    ['two intervals', SPLIT, 'count'],
    [
      'a start before the garage opens',
      [['07:45', '12:00']],
      'outside_opening',
    ],
    ['an end after the garage closes', [['08:00', '18:15']], 'outside_opening'],
    ['a value that is not a list', 'all day', 'invalid'],
  ])(
    'refuses %s with its code on the day, writing nothing',
    async (_, monday, code) => {
      const { dinamo, elena, owner } = await world();
      const before = await writesOf(dinamo.id);

      const res = await write(
        dinamo.id,
        elena.id,
        { workingHours: { ...OWN, mon: monday }, worksSaturdays: false },
        owner,
      );

      expect([res.status, res.body.code]).toEqual([422, 'validation_failed']);
      expect(codes(res)).toEqual([['workingHours.mon', code]]);
      expect(await writesOf(dinamo.id)).toEqual(before);
    },
  );

  it('refuses a week missing a day', async () => {
    const { dinamo, elena, owner } = await world();
    const { sun: _, ...noSunday } = OWN;

    const res = await write(
      dinamo.id,
      elena.id,
      { workingHours: noSunday, worksSaturdays: false },
      owner,
    );

    expect(res.status).toBe(422);
    expect(codes(res)).toContainEqual(
      expect.arrayContaining([
        expect.stringMatching(/^workingHours/),
        'invalid',
      ]),
    );
  });

  it('refuses a Sunday stretch while the garage is closed on Sundays, and takes one once it opens', async () => {
    const { dinamo, elena, owner } = await world();
    const body = {
      workingHours: week([['08:00', '16:30']], { sun: [['10:00', '12:00']] }),
      worksSaturdays: false,
    };

    const closed = await write(dinamo.id, elena.id, body, owner);
    await prisma.garage.update({
      data: { hours: { ...GARAGE_HOURS, sun: [['10:00', '14:00']] } },
      where: { id: dinamo.id },
    });
    const open = await write(dinamo.id, elena.id, body, owner);

    expect(codes(closed)).toEqual([['workingHours.sun', 'outside_opening']]);
    expect(open.status).toBe(200);
  });

  it('judges a week saved during a garage hours save against the hours that save leaves', async () => {
    const { dinamo, elena, owner } = await world();
    const narrowing = heldOpen(prisma, (tx) =>
      tx.garage.update({
        data: { hours: { ...GARAGE_HOURS, mon: [['10:00', '12:00']] } },
        where: { id: dinamo.id },
      }),
    );
    await narrowing.ready;

    // supertest sends on `then`: started now, it meets the held lock.
    const answer = write(
      dinamo.id,
      elena.id,
      { workingHours: week([['08:00', '16:30']]), worksSaturdays: false },
      owner,
    ).then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 300));
    narrowing.release();
    await narrowing.done;

    expect(codes(await answer)).toEqual([
      ['workingHours.mon', 'outside_opening'],
    ]);
  });

  it('refuses working Saturdays while the garage is closed on Saturdays, writing nothing', async () => {
    const { dinamo, elena, owner } = await world({
      hours: { ...GARAGE_HOURS, sat: [] },
    });
    const before = await writesOf(dinamo.id);

    const res = await write(
      dinamo.id,
      elena.id,
      { workingHours: OWN, worksSaturdays: true },
      owner,
    );

    expect(res.status).toBe(422);
    expect(codes(res)).toEqual([['worksSaturdays', 'garage_closed_saturday']]);
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it('refuses a switch that is not true or false', async () => {
    const { dinamo, elena, owner } = await world();

    const res = await write(
      dinamo.id,
      elena.id,
      { workingHours: OWN, worksSaturdays: 'yes' },
      owner,
    );

    expect(codes(res)).toEqual([['worksSaturdays', 'invalid']]);
  });

  it('names every problem at once', async () => {
    const { dinamo, elena, owner } = await world({
      hours: { ...GARAGE_HOURS, sat: [] },
    });

    const res = await write(
      dinamo.id,
      elena.id,
      {
        workingHours: {
          ...OWN,
          mon: [['12:00', '10:00']],
          tue: [['08:10', '12:00']],
        },
        worksSaturdays: true,
      },
      owner,
    );

    expect(codes(res).sort()).toEqual(
      [
        ['workingHours.mon', 'order'],
        ['workingHours.tue', 'grid'],
        ['worksSaturdays', 'garage_closed_saturday'],
      ].sort(),
    );
  });

  it('answers 200 to a save that changes nothing, writing nothing', async () => {
    const { dinamo, elena, owner } = await world();
    await setHours(elena.id, OWN);
    const before = await writesOf(dinamo.id);

    const res = await write(
      dinamo.id,
      elena.id,
      { workingHours: OWN, worksSaturdays: false },
      owner,
    );

    expect(res.status).toBe(200);
    expect(await writesOf(dinamo.id)).toEqual(before);
  });
});

// @traces 058-FR-004 058-FR-006 058-FR-008
describe('adding a day off', () => {
  it('saves a single day and answers the schedule listing it', async () => {
    const { dinamo, elena, owner } = await world();
    const day = addDays(today(), 3);

    const res = await addOff(dinamo.id, elena.id, { firstDay: day }, owner);

    expect(res.status).toBe(201);
    expect(res.body.daysOff).toEqual([
      { firstDay: day, id: expect.any(String), lastDay: day, note: null },
    ]);
  });

  it('saves a range with its note trimmed, and a blank note as none', async () => {
    const { dinamo, elena, owner } = await world();
    const first = addDays(today(), 10);

    await addOff(
      dinamo.id,
      elena.id,
      { firstDay: first, lastDay: addDays(first, 4), note: '  Concediu  ' },
      owner,
    );
    await addOff(
      dinamo.id,
      elena.id,
      { firstDay: addDays(first, 6), note: '   ' },
      owner,
    );

    expect(await daysOffOf(elena.id)).toEqual([
      {
        first_day: date(first),
        last_day: date(addDays(first, 4)),
        note: 'Concediu',
      },
      {
        first_day: date(addDays(first, 6)),
        last_day: date(addDays(first, 6)),
        note: null,
      },
    ]);
  });

  it('takes today, a year ahead and a note of 120 characters', async () => {
    const { dinamo, elena, owner } = await world();

    const res = await addOff(
      dinamo.id,
      elena.id,
      {
        firstDay: today(),
        lastDay: addDays(today(), 365),
        note: 'ă'.repeat(120),
      },
      owner,
    );

    expect(res.status).toBe(201);
  });

  it.each([
    ['a first day before today', { firstDay: -1 }, ['firstDay', 'past']],
    [
      'a last day before the first',
      { firstDay: 5, lastDay: 4 },
      ['lastDay', 'order'],
    ],
    [
      'a last day more than a year ahead',
      { firstDay: 5, lastDay: 366 },
      ['lastDay', 'too_far'],
    ],
    [
      'a note of 121 characters',
      { firstDay: 5, note: 'ă'.repeat(121) },
      ['note', 'too_long'],
    ],
    [
      'a day that is not a date',
      { firstDay: '12.05.2027' },
      ['firstDay', 'invalid'],
    ],
  ])('refuses %s, writing nothing', async (_, body, error) => {
    const { dinamo, elena, owner } = await world();
    const before = await writesOf(dinamo.id);
    const dated = Object.fromEntries(
      Object.entries(body).map(([key, value]) => [
        key,
        typeof value === 'number' ? addDays(today(), value) : value,
      ]),
    );

    const res = await addOff(dinamo.id, elena.id, dated, owner);

    expect([res.status, res.body.code]).toEqual([422, 'validation_failed']);
    expect(codes(res)).toEqual([error]);
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it('refuses a range sharing a day with a saved one', async () => {
    const { dinamo, elena, owner } = await world();
    await dayOff(elena.id, addDays(today(), 10), addDays(today(), 12));
    const before = await writesOf(dinamo.id);

    const res = await addOff(
      dinamo.id,
      elena.id,
      { firstDay: addDays(today(), 12), lastDay: addDays(today(), 14) },
      owner,
    );

    expect([res.status, res.body.code]).toEqual([409, 'day_off_overlap']);
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it("takes a range touching a saved one, and one on another mechanic's day off", async () => {
    const { dinamo, elena, nordCard, owner } = await world();
    await dayOff(elena.id, addDays(today(), 10), addDays(today(), 12));
    await dayOff(nordCard.id, addDays(today(), 13));

    const res = await addOff(
      dinamo.id,
      elena.id,
      { firstDay: addDays(today(), 13) },
      owner,
    );

    expect(res.status).toBe(201);
  });

  it('judges the fields before the overlap', async () => {
    const { dinamo, elena, owner } = await world();
    await dayOff(elena.id, addDays(today(), 10));

    const res = await addOff(
      dinamo.id,
      elena.id,
      { firstDay: addDays(today(), 10), note: 'x'.repeat(121) },
      owner,
    );

    expect(res.status).toBe(422);
  });

  it('refuses a range over confirmed bookings once, naming them, then saves it when told to', async () => {
    const { dinamo, elena, owner } = await world();
    const monday = next(1);
    const tuesday = addDays(monday, 1);
    const starts = [
      atLocal(monday, 9),
      atLocal(monday, 14),
      atLocal(tuesday, 10),
    ];
    const booked = [];
    for (const at of starts) {
      booked.push(
        await bookings.booked(dinamo.id, at.toISOString(), 'confirmed', {
          mechanicId: elena.id,
        }),
      );
    }
    await bookings.booked(
      dinamo.id,
      atLocal(monday, 11).toISOString(),
      'cancelled',
      {
        mechanicId: elena.id,
      },
    );
    await bookings.booked(
      dinamo.id,
      atLocal(addDays(tuesday, 1), 9).toISOString(),
      'confirmed',
      {
        mechanicId: elena.id,
      },
    );
    const body = { firstDay: monday, lastDay: tuesday };
    const before = await writesOf(dinamo.id);

    const warned = await addOff(dinamo.id, elena.id, body, owner);
    const unchanged = await writesOf(dinamo.id);
    const saved = await addOff(
      dinamo.id,
      elena.id,
      { ...body, acknowledgeBookings: true },
      owner,
    );

    expect([warned.status, warned.body.code]).toEqual([
      409,
      'bookings_on_days_off',
    ]);
    expect(
      [...warned.body.bookings].sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt),
      ),
    ).toEqual(
      booked.map((b) => ({ id: b.id, startsAt: b.startsAt.toISOString() })),
    );
    expect(unchanged).toEqual(before);
    expect(saved.status).toBe(201);
    expect(
      await prisma.booking.count({
        where: { id: { in: booked.map((b) => b.id) }, status: 'confirmed' },
      }),
    ).toBe(3);
  });

  it('saves a range with no confirmed booking at once', async () => {
    const { dinamo, elena, owner } = await world();

    const res = await addOff(
      dinamo.id,
      elena.id,
      { acknowledgeBookings: false, firstDay: next(1) },
      owner,
    );

    expect(res.status).toBe(201);
  });

  it('meets only the overlap on an acknowledged re-send once the days were taken', async () => {
    const { dinamo, elena, owner } = await world();
    const monday = next(1);
    await bookings.booked(
      dinamo.id,
      atLocal(monday, 9).toISOString(),
      'confirmed',
      {
        mechanicId: elena.id,
      },
    );
    await dayOff(elena.id, monday);

    const res = await addOff(
      dinamo.id,
      elena.id,
      { acknowledgeBookings: true, firstDay: monday },
      owner,
    );

    expect([res.status, res.body.code]).toEqual([409, 'day_off_overlap']);
  });

  it('keeps two adds of the same days at once to one row', async () => {
    const { dinamo, elena, owner } = await world();
    const body = {
      firstDay: addDays(today(), 7),
      lastDay: addDays(today(), 9),
    };

    const answers = await Promise.all([
      addOff(dinamo.id, elena.id, body, owner),
      addOff(dinamo.id, elena.id, body, owner),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await daysOffOf(elena.id)).toHaveLength(1);
  });
});

// @traces 058-FR-005
describe('removing a day off', () => {
  it('deletes one still ahead', async () => {
    const { dinamo, elena, owner } = await world();
    const id = await dayOff(elena.id, addDays(today(), 4));

    const res = await removeOff(dinamo.id, elena.id, id, owner);

    expect(res.status).toBe(204);
    expect(await daysOffOf(elena.id)).toEqual([]);
  });

  it('deletes one starting today', async () => {
    const { dinamo, elena, owner } = await world();
    const id = await dayOff(elena.id, today(), addDays(today(), 2));

    expect((await removeOff(dinamo.id, elena.id, id, owner)).status).toBe(204);
    expect(await daysOffOf(elena.id)).toEqual([]);
  });

  it('ends a running one yesterday, keeping its past days', async () => {
    const { dinamo, elena, owner } = await world();
    const id = await dayOff(
      elena.id,
      addDays(today(), -3),
      addDays(today(), 3),
    );

    const res = await removeOff(dinamo.id, elena.id, id, owner);

    expect(res.status).toBe(204);
    expect(await daysOffOf(elena.id)).toEqual([
      {
        first_day: date(addDays(today(), -3)),
        last_day: date(addDays(today(), -1)),
        note: null,
      },
    ]);
    expect((await read(dinamo.id, elena.id, owner)).body.daysOff).toEqual([]);
  });

  it('refuses one that already ended, writing nothing', async () => {
    const { dinamo, elena, owner } = await world();
    const id = await dayOff(
      elena.id,
      addDays(today(), -5),
      addDays(today(), -1),
    );
    const before = await writesOf(dinamo.id);

    const res = await removeOff(dinamo.id, elena.id, id, owner);

    expect([res.status, res.body.code]).toEqual([409, 'past_day_off']);
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it('answers 204 then 404 to two removes of the same day at once', async () => {
    const { dinamo, elena, owner } = await world();
    const id = await dayOff(elena.id, addDays(today(), 4));

    const answers = await Promise.all([
      removeOff(dinamo.id, elena.id, id, owner),
      removeOff(dinamo.id, elena.id, id, owner),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([204, 404]);
    expect(await daysOffOf(elena.id)).toEqual([]);
  });

  it("answers 404 to an unknown id and to another mechanic's day off", async () => {
    const { dinamo, elena, owner } = await world();
    const tudor = await prisma.mechanic.findFirstOrThrow({
      where: { name: 'Tudor Vlad' },
    });
    const his = await dayOff(tudor.id, addDays(today(), 4));

    for (const id of [randomUUID(), his]) {
      const res = await removeOff(dinamo.id, elena.id, id, owner);
      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    }
    expect(await daysOffOf(tudor.id)).toHaveLength(1);
  });
});

// @traces 058-FR-010
describe('the history and the live channel of a schedule', () => {
  // @traces 059-FR-011
  it("reaches the mechanic's public page only while the profile shows the card", async () => {
    const { dinamo, owner, vlad } = await world();
    await prisma.garage.update({
      data: { status: 'approved' },
      where: { id: dinamo.id },
    });
    const card = await prisma.mechanic.update({
      data: { onProfile: true },
      where: { accountId: vlad },
    });
    const hours = {
      workingHours: week([['08:00', '16:30']], { sat: [['09:00', '13:00']] }),
      worksSaturdays: false,
    };

    await write(dinamo.id, card.id, hours, owner);
    await prisma.garage.update({
      data: { teamOnProfile: false },
      where: { id: dinamo.id },
    });
    await write(dinamo.id, card.id, { ...hours, worksSaturdays: true }, owner);

    const [shown, hidden] = await outbox();
    expect(shown.audience).toEqual(
      expect.arrayContaining([`public:mechanic:${card.id}`]),
    );
    expect(hidden.audience).toEqual([
      `garage:${dinamo.id}`,
      `mechanic:${card.id}`,
    ]);
  });

  it('records one entry per changed field with the old and new value, and none for one unchanged', async () => {
    const { dinamo, elena, mihai, owner } = await world();
    const hours = week([['08:00', '16:30']], { sat: [['09:00', '13:00']] });

    await write(
      dinamo.id,
      elena.id,
      { workingHours: hours, worksSaturdays: false },
      owner,
    );
    await write(
      dinamo.id,
      elena.id,
      { workingHours: hours, worksSaturdays: true },
      owner,
    );

    const written = await entries('mechanic', dinamo.id);
    expect(
      written.map(
        ({ action, actorId, actorRole, field, newValue, oldValue }) => ({
          action,
          actorId,
          actorRole,
          field,
          newValue,
          oldValue,
        }),
      ),
    ).toEqual([
      {
        action: 'update',
        actorId: mihai,
        actorRole: 'owner',
        field: 'workingHours',
        newValue: hours,
        oldValue: null,
      },
      {
        action: 'update',
        actorId: mihai,
        actorRole: 'owner',
        field: 'worksSaturdays',
        newValue: true,
        oldValue: false,
      },
    ]);
  });

  it('tells the garage which schedule fields changed', async () => {
    const { dinamo, elena, owner } = await world();

    await write(
      dinamo.id,
      elena.id,
      {
        workingHours: week([['08:00', '16:30']], { sat: [['09:00', '13:00']] }),
        worksSaturdays: true,
      },
      owner,
    );

    const events = await outbox();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: [`garage:${dinamo.id}`, `mechanic:${elena.id}`],
      payload: {
        fields: ['working_hours', 'works_saturdays'],
        garageId: dinamo.id,
        mechanicId: elena.id,
      },
      subjectId: elena.id,
    });
  });

  it('records the day off added, shortened and removed, each with its event', async () => {
    const { dinamo, elena, mihai, owner } = await world();
    const first = addDays(today(), 5);
    const running = await dayOff(
      elena.id,
      addDays(today(), -2),
      addDays(today(), 2),
    );

    const added = await addOff(
      dinamo.id,
      elena.id,
      { firstDay: first, lastDay: addDays(first, 1), note: 'Concediu' },
      owner,
    );
    const [ahead] = added.body.daysOff.filter(
      (d: { id: string }) => d.id !== running,
    );
    await removeOff(dinamo.id, elena.id, ahead.id, owner);
    await removeOff(dinamo.id, elena.id, running, owner);

    const written = await entries('mechanic_day_off', dinamo.id);
    expect(
      written.map(
        ({
          action,
          actorId,
          actorRole,
          field,
          newValue,
          oldValue,
          subjectId,
        }) => ({
          action,
          actorId,
          actorRole,
          field,
          newValue,
          oldValue,
          subjectId,
        }),
      ),
    ).toEqual([
      {
        action: 'create',
        actorId: mihai,
        actorRole: 'owner',
        field: null,
        newValue: {
          firstDay: first,
          lastDay: addDays(first, 1),
          note: 'Concediu',
        },
        oldValue: null,
        subjectId: ahead.id,
      },
      {
        action: 'delete',
        actorId: mihai,
        actorRole: 'owner',
        field: null,
        newValue: null,
        oldValue: {
          firstDay: first,
          lastDay: addDays(first, 1),
          note: 'Concediu',
        },
        subjectId: ahead.id,
      },
      {
        action: 'update',
        actorId: mihai,
        actorRole: 'owner',
        field: 'lastDay',
        newValue: addDays(today(), -1),
        oldValue: addDays(today(), 2),
        subjectId: running,
      },
    ]);
    const events = await outbox();
    expect(
      events.map((e) => (e.payload as { fields: string[] }).fields),
    ).toEqual([['days_off'], ['days_off'], ['days_off']]);
  });

  it('writes nothing when the event cannot be recorded', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { dinamo, elena, owner } = await world();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION refuse_schedule_event() RETURNS trigger AS $$
       BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER refuse_schedule_event BEFORE INSERT ON outbox_event FOR EACH ROW EXECUTE FUNCTION refuse_schedule_event()',
    );
    const before = await writesOf(dinamo.id);
    try {
      const hours = await write(
        dinamo.id,
        elena.id,
        { workingHours: OWN, worksSaturdays: false },
        owner,
      );
      const off = await addOff(
        dinamo.id,
        elena.id,
        { firstDay: addDays(today(), 3) },
        owner,
      );

      expect([hours.status, off.status]).toEqual([500, 500]);
      expect(await writesOf(dinamo.id)).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS refuse_schedule_event ON outbox_event',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS refuse_schedule_event()',
      );
    }
  });
});

// @traces 058-FR-009
describe('who reaches a mechanic schedule', () => {
  const calls = (garageId: string, mechanicId: string, dayOffId: string) => [
    (auth?: string) => read(garageId, mechanicId, auth),
    (auth?: string) =>
      write(
        garageId,
        mechanicId,
        { workingHours: OWN, worksSaturdays: false },
        auth,
      ),
    (auth?: string) =>
      addOff(garageId, mechanicId, { firstDay: addDays(today(), 30) }, auth),
    (auth?: string) => removeOff(garageId, mechanicId, dayOffId, auth),
  ];

  it('answers the owner on every route', async () => {
    const { dinamo, elena, owner } = await world();
    const id = await dayOff(elena.id, addDays(today(), 40));

    const statuses = [];
    for (const call of calls(dinamo.id, elena.id, id)) {
      statuses.push((await call(owner)).status);
    }

    expect(statuses).toEqual([200, 200, 201, 204]);
  });

  it('answers the receptionist and the mechanic 403 forbidden, writing nothing', async () => {
    const { dinamo, elena, ioana, vlad } = await world();
    const id = await dayOff(elena.id, addDays(today(), 40));
    const before = await writesOf(dinamo.id);

    for (const auth of [
      bearer(ioana, 'receptionist'),
      bearer(vlad, 'mechanic'),
    ]) {
      for (const call of calls(dinamo.id, elena.id, id)) {
        const res = await call(auth);
        expect([res.status, res.body.code]).toEqual([403, 'forbidden']);
      }
    }
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it("answers a driver, an admin and another garage's owner 404 not_found", async () => {
    const { dinamo, elena, radu } = await world();
    const id = await dayOff(elena.id, addDays(today(), 40));
    const driver = await account('andrei', ['driver']);
    const admin = await account('admin', ['admin']);
    const before = await writesOf(dinamo.id);

    for (const auth of [
      bearer(driver, 'driver'),
      bearer(admin, 'admin'),
      bearer(radu, 'garage'),
    ]) {
      for (const call of calls(dinamo.id, elena.id, id)) {
        const res = await call(auth);
        expect([res.status, res.body.code]).toEqual([404, 'not_found']);
      }
    }
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const { dinamo, elena } = await world();
    const id = await dayOff(elena.id, addDays(today(), 40));

    for (const call of calls(dinamo.id, elena.id, id)) {
      const res = await call();
      expect([res.status, res.body.code]).toEqual([401, 'sign_in_required']);
    }
  });

  it('answers the owner 404 feature_off with the team switched off, after the access check', async () => {
    const { dinamo, elena, ioana, owner } = await world();
    const id = await dayOff(elena.id, addDays(today(), 40));
    await switchOff(dinamo.id);

    for (const call of calls(dinamo.id, elena.id, id)) {
      const mine = await call(owner);
      const staff = await call(bearer(ioana, 'receptionist'));
      expect([mine.status, mine.body.code]).toEqual([404, 'feature_off']);
      expect([staff.status, staff.body.code]).toEqual([403, 'forbidden']);
    }
  });

  it("answers 404 to an unknown, a removed and another garage's card", async () => {
    const { dinamo, nordCard, owner } = await world();
    const gone = await prisma.mechanic.create({
      data: { garageId: dinamo.id, name: 'Dan Plecat', removedAt: new Date() },
    });

    for (const mechanicId of [randomUUID(), gone.id, nordCard.id]) {
      for (const call of calls(dinamo.id, mechanicId, randomUUID())) {
        const res = await call(owner);
        expect([res.status, res.body.code]).toEqual([404, 'not_found']);
      }
    }
  });
});

// @traces 058-FR-004
describe('the day-off table', () => {
  it('refuses a last day before the first and a note over 120 characters', async () => {
    const { elena } = await world();
    const insert = (lastDay: string, note: string | null) =>
      prisma.$executeRaw`
        INSERT INTO mechanic_day_off (mechanic_id, first_day, last_day, note, created_by)
        VALUES (${elena.id}::uuid, '2027-05-12', ${lastDay}::date, ${note}, gen_random_uuid())`;

    await expect(insert('2027-05-11', null)).rejects.toThrow();
    await expect(insert('2027-05-12', 'x'.repeat(121))).rejects.toThrow();
    await expect(insert('2027-05-12', 'x'.repeat(120))).resolves.toBe(1);
  });

  it('leaves with its mechanic', async () => {
    const { elena } = await world();
    await dayOff(elena.id, '2027-05-12');

    await prisma.mechanic.delete({ where: { id: elena.id } });

    expect(await daysOffOf(elena.id)).toEqual([]);
  });
});
