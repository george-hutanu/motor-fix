import { randomUUID } from 'node:crypto';

import { addDays, atLocal, localDay } from '../../bucharest';
import { quotesApp } from '../quotes-api.testing';

const { bearer, get, post, team, world } = quotesApp();
const { prisma } = world;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let since: Date;
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  [{ since }] = await prisma.$queryRaw<
    { since: Date }[]
  >`SELECT now() AS since`;
});

// Three days out or later, on a day no public holiday closes, at 10:00 in
// Bucharest: inside any day's hours below, and after the default confirm-by.
let DAY: string;
let TEN: Date;
beforeAll(async () => {
  let day = addDays(localDay(new Date()), 3);
  const holiday = (d: string) =>
    prisma.publicHoliday.findUnique({
      where: { day: new Date(`${d}T00:00:00Z`) },
    });
  while (await holiday(day)) day = addDays(day, 1);
  DAY = day;
  TEN = atLocal(DAY, 10);
});

type Team = Awaited<ReturnType<typeof team>>;

// A driver's request quoted by the team's garage and by another, the team's
// quote accepted and its booking awaiting confirmation at `startsAt`.
async function accepted(at: Team, startsAt = TEN) {
  const driver = await world.account('Andrei Ion Marin');
  const other = await world.garage('Service Militari');
  const request = await world.request(driver, { status: 'booked' });
  const quote = await world.quote(request.id, at.garage.id, 'accepted');
  const rival = await world.quote(request.id, other.id);
  const waiting = await world.recipient(
    request.id,
    (await world.garage('Auto Berceni')).id,
  );
  await prisma.booking.create({
    data: {
      confirmBy: new Date(Date.now() + 24 * HOUR),
      driverId: driver,
      durationMinutes: 90,
      garageId: at.garage.id,
      quoteId: quote.id,
      requestId: request.id,
      startsAt,
      status: 'awaiting_confirmation',
    },
  });
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { quoteId: quote.id },
  });
  return { booking, driver, quote, request, rival, waiting };
}

async function lifts(garageId: string, liftCount: number) {
  await prisma.garage.update({ data: { liftCount }, where: { id: garageId } });
}

async function switched(
  garageId: string,
  key: 'team_mechanics' | 'lift_schedule',
  enabled: boolean,
) {
  await prisma.garageFeature.create({ data: { enabled, garageId, key } });
}

const owner = (t: Team) => bearer(t.owner, 'garage');

const confirm = (bookingId: string, auth: string | undefined, body: object) =>
  post(`/bookings/${bookingId}/confirm`, body, auth);

// Every row a confirm could touch, as it stands.
async function snapshot(bookingId: string) {
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
  });
  return {
    booking: [b.status, b.mechanicId, b.lift, b.confirmedAt?.toISOString()],
    events: await prisma.outboxEvent.count(),
    jobs: await prisma.job.count(),
    logged: await prisma.activityLog.count({ where: { at: { gte: since } } }),
    mechanics: await prisma.mechanic.count(),
    quotes: (
      await prisma.quote.findMany({
        orderBy: { id: 'asc' },
        where: { requestId: b.requestId },
      })
    ).map((q) => q.status),
  };
}

// @traces 389-FR-001
// @traces 389-FR-002
describe('POST /bookings/:id/confirm', () => {
  it('confirms the booking with its mechanic and lift, opens the job and closes the rest of the request in one go', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking, quote, request, rival, waiting } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      lift: 2,
      mechanicId: t.answeringMechanic.id,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      confirmedBy: t.owner,
      id: booking.id,
      lift: 2,
      mechanic: { id: t.answeringMechanic.id, name: 'Fixer' },
      mechanicId: t.answeringMechanic.id,
      status: 'confirmed',
    });
    expect(res.body.confirmedAt).not.toBeNull();
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(row).toMatchObject({
      confirmedBy: t.owner,
      lift: 2,
      mechanicId: t.answeringMechanic.id,
      status: 'confirmed',
    });
    const job = await prisma.job.findUniqueOrThrow({
      include: { stages: true },
      where: { bookingId: booking.id },
    });
    expect(job).toMatchObject({
      carId: request.carId,
      driverId: request.driverId,
      garageId: t.garage.id,
      mechanicId: t.answeringMechanic.id,
      status: 'to_do',
    });
    expect(job.stages).toEqual([
      expect.objectContaining({
        actorId: t.owner,
        actorRole: 'owner',
        fromStatus: null,
        toStatus: 'to_do',
      }),
    ]);
    const statuses = async () =>
      Object.fromEntries(
        (await prisma.quote.findMany({ where: { requestId: request.id } })).map(
          (q) => [q.id, q.status],
        ),
      );
    expect(await statuses()).toEqual({
      [quote.id]: 'accepted',
      [rival.id]: 'lost',
    });
    expect(
      (
        await prisma.requestRecipient.findUniqueOrThrow({
          where: { id: waiting.id },
        })
      ).status,
    ).toBe('closed');
    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('booked');
  });

  it('files the moves and writes the confirmation and the closed quotes as events', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking, quote, request, rival } = await accepted(t);

    await confirm(booking.id, owner(t), {
      lift: 1,
      mechanicId: t.plainMechanic.id,
    });

    const entries = await prisma.activityLog.findMany({
      where: { at: { gte: since }, subjectId: booking.id },
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: t.owner,
          field: 'status',
          newValue: 'confirmed',
          oldValue: 'awaiting_confirmation',
        }),
        expect.objectContaining({
          field: 'mechanic_id',
          newValue: t.plainMechanic.id,
        }),
        expect.objectContaining({ field: 'lift', newValue: 1 }),
      ]),
    );
    expect(
      await prisma.activityLog.count({
        where: { at: { gte: since }, field: 'status', subjectId: rival.id },
      }),
    ).toBe(1);
    const events = await prisma.outboxEvent.findMany({
      orderBy: { kind: 'asc' },
    });
    expect(events.map((e) => e.kind)).toEqual([
      'booking.confirmed',
      'quote.closed',
    ]);
    expect(events[0]).toMatchObject({
      payload: {
        bookingId: booking.id,
        durationMinutes: 90,
        lift: 1,
        mechanicId: t.plainMechanic.id,
        quoteId: quote.id,
        requestId: request.id,
        startsAt: TEN.toISOString(),
      },
      subjectId: booking.id,
    });
    expect(events[1].payload).toMatchObject({
      quoteIds: [rival.id],
      requestId: request.id,
    });
  });

  it('lets the receptionist confirm, recording her as the one who did', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);

    const res = await confirm(
      booking.id,
      bearer(t.receptionist, 'receptionist'),
      {
        mechanicId: t.answeringMechanic.id,
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.confirmedBy).toBe(t.receptionist);
    const job = await prisma.job.findUniqueOrThrow({
      include: { stages: true },
      where: { bookingId: booking.id },
    });
    expect(job.stages[0]).toMatchObject({
      actorId: t.receptionist,
      actorRole: 'receptionist',
    });
  });
});

// @traces 389-FR-003
describe('a confirm that cannot happen', () => {
  it('refuses the same booking a second time, writing nothing', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    const body = { mechanicId: t.answeringMechanic.id };
    expect((await confirm(booking.id, owner(t), body)).status).toBe(200);
    const before = await snapshot(booking.id);

    const again = await confirm(booking.id, owner(t), body);

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'confirmed',
      entity: 'booking',
      to: 'confirmed',
    });
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it.each(['lapsed', 'cancelled'] as const)(
    'refuses a %s booking, writing nothing',
    async (status) => {
      const t = await team('Atelier Dinamo');
      const { booking } = await accepted(t);
      await prisma.booking.update({
        data: {
          status,
          ...(status === 'cancelled' && {
            cancelledAt: new Date(),
            cancelledBySide: 'driver',
            cancelReason: 'plans_changed',
          }),
        },
        where: { id: booking.id },
      });
      const before = await snapshot(booking.id);

      const res = await confirm(booking.id, owner(t), {
        mechanicId: t.answeringMechanic.id,
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: status,
      });
      expect(await snapshot(booking.id)).toEqual(before);
    },
  );

  it('refuses a booking whose confirm-by has passed as lapsed, leaving the row to the timer', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    await prisma.booking.update({
      data: { confirmBy: new Date(Date.now() - MINUTE) },
      where: { id: booking.id },
    });
    const before = await snapshot(booking.id);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.answeringMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'lapsed',
      entity: 'booking',
    });
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it.each([
    ['an unknown field', { note: 'hi' }],
    ['a lift that is not a whole number', { lift: 1.5 }],
    ['a mechanic id that is not a uuid', { mechanicId: 'fixer' }],
  ])('refuses %s, writing nothing', async (_, body) => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking } = await accepted(t);
    const before = await snapshot(booking.id);

    const res = await confirm(booking.id, owner(t), body);

    expect(res.status).toBe(400);
    expect(await snapshot(booking.id)).toEqual(before);
  });
});

// @traces 389-FR-001
describe('who may confirm', () => {
  it.each([
    [
      'the mechanic who answers quotes',
      (t: Team) => bearer(t.answering, 'mechanic'),
    ],
    ['the mechanic who does not', (t: Team) => bearer(t.plain, 'mechanic')],
  ])('answers 403 to %s, writing nothing', async (_, auth) => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    const before = await snapshot(booking.id);

    const res = await confirm(booking.id, auth(t), {
      mechanicId: t.answeringMechanic.id,
    });

    expect(res.status).toBe(403);
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('answers 404 to another garage, the driver and an admin, writing nothing', async () => {
    const t = await team('Atelier Dinamo');
    const rival = await team('Service Militari');
    const { booking, driver } = await accepted(t);
    const admin = await world.account('Admin', ['admin']);
    const before = await snapshot(booking.id);

    for (const auth of [
      owner(rival),
      bearer(rival.receptionist, 'receptionist'),
      bearer(driver, 'driver'),
      bearer(admin, 'admin'),
    ]) {
      const res = await confirm(booking.id, auth, {});
      expect(res.status).toBe(404);
    }
    expect((await confirm(randomUUID(), owner(t), {})).status).toBe(404);
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('asks a visitor to sign in, writing nothing', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    const before = await snapshot(booking.id);

    const res = await confirm(booking.id, undefined, {});

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
    expect(await snapshot(booking.id)).toEqual(before);
  });
});

// @traces 389-FR-001
// @traces 389-FR-004
// @traces 389-FR-006
describe('GET /bookings/:id/confirm-options', () => {
  it('names the garage’s mechanics by name and its lift count', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 3);
    const { booking } = await accepted(t);
    await prisma.mechanic.create({
      data: { garageId: (await world.garage('Elsewhere')).id, name: 'Away' },
    });

    const res = await get(`/bookings/${booking.id}/confirm-options`, owner(t));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      liftCount: 3,
      mechanics: [
        { id: t.answeringMechanic.id, name: 'Fixer' },
        { id: t.plainMechanic.id, name: 'Hand' },
      ],
    });
  });

  it('offers no mechanic and no lift when both switches are off', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 3);
    await switched(t.garage.id, 'team_mechanics', false);
    await switched(t.garage.id, 'lift_schedule', false);
    const { booking } = await accepted(t);

    const res = await get(
      `/bookings/${booking.id}/confirm-options`,
      bearer(t.receptionist, 'receptionist'),
    );

    expect(res.body).toEqual({ liftCount: 0, mechanics: [] });
  });

  it('answers 403 to a mechanic, 404 to another garage and 401 to a visitor', async () => {
    const t = await team('Atelier Dinamo');
    const rival = await team('Service Militari');
    const { booking } = await accepted(t);
    const path = `/bookings/${booking.id}/confirm-options`;

    expect((await get(path, bearer(t.answering, 'mechanic'))).status).toBe(403);
    expect((await get(path, owner(rival))).status).toBe(404);
    expect((await get(path)).status).toBe(401);
  });
});

// @traces 389-FR-004
// @traces 389-FR-005
// @traces 389-FR-006
describe('the switches', () => {
  it('refuses a mechanic when the team is off, naming it', async () => {
    const t = await team('Atelier Dinamo');
    await switched(t.garage.id, 'team_mechanics', false);
    const { booking } = await accepted(t);
    const before = await snapshot(booking.id);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.answeringMechanic.id,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('mechanicId');
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('gives the job to the owner when the team is off, making his mechanic row once', async () => {
    const t = await team('Atelier Dinamo');
    await switched(t.garage.id, 'team_mechanics', false);
    const first = await accepted(t);
    const second = await accepted(t, new Date(TEN.getTime() + 3 * HOUR));

    const res = await confirm(first.booking.id, owner(t), {});
    await confirm(second.booking.id, owner(t), {});

    expect(res.status).toBe(200);
    expect(res.body.mechanicId).toBeNull();
    const own = await prisma.mechanic.findMany({
      where: { accountId: t.owner },
    });
    const ownerName = (
      await prisma.account.findUniqueOrThrow({ where: { id: t.owner } })
    ).name;
    expect(own).toEqual([
      expect.objectContaining({
        garageId: t.garage.id,
        name: ownerName,
        onProfile: false,
      }),
    ]);
    const jobs = await prisma.job.findMany({
      where: { garageId: t.garage.id },
    });
    expect(jobs.map((j) => j.mechanicId)).toEqual([own[0].id, own[0].id]);
    expect(
      await prisma.activityLog.count({
        where: { subjectId: own[0].id, subjectType: 'mechanic' },
      }),
    ).toBe(1);
  });

  it('lets two bookings overlap when the team is off', async () => {
    const t = await team('Atelier Dinamo');
    await switched(t.garage.id, 'team_mechanics', false);
    await switched(t.garage.id, 'lift_schedule', false);
    const first = await accepted(t);
    const second = await accepted(t, new Date(TEN.getTime() + 30 * MINUTE));

    expect((await confirm(first.booking.id, owner(t), {})).status).toBe(200);
    expect((await confirm(second.booking.id, owner(t), {})).status).toBe(200);
  });

  it('asks for a mechanic when the team is on, naming the field', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    const before = await snapshot(booking.id);

    const res = await confirm(booking.id, owner(t), {});

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('mechanicId');
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it.each([
    [
      'another garage’s',
      async () => (await team('Service Militari')).plainMechanic.id,
    ],
    ['an unknown', async () => randomUUID()],
  ])('refuses %s mechanic as unavailable', async (_, pick) => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    const mechanicId = await pick();
    const before = await snapshot(booking.id);

    const res = await confirm(booking.id, owner(t), { mechanicId });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'mechanic_unavailable' });
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('refuses a lift when the lift schedule is off, naming it', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    await switched(t.garage.id, 'lift_schedule', false);
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      lift: 1,
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('lift');
  });

  it.each([0, 3])('refuses lift %s of a garage with two', async (lift) => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking } = await accepted(t);
    const before = await snapshot(booking.id);

    const res = await confirm(booking.id, owner(t), {
      lift,
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('lift');
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('confirms with no lift when the garage has lifts but none is chosen', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
    expect(res.body.lift).toBeNull();
  });
});

// @traces 389-FR-007
describe('a mechanic or a lift already taken', () => {
  async function confirmedAt(t: Team, startsAt: Date, lift?: number) {
    const { booking } = await accepted(t, startsAt);
    await confirm(booking.id, owner(t), {
      lift,
      mechanicId: t.plainMechanic.id,
    });
  }

  it('refuses a mechanic with an overlapping confirmed booking', async () => {
    const t = await team('Atelier Dinamo');
    await confirmedAt(t, TEN);
    const { booking } = await accepted(
      t,
      new Date(TEN.getTime() + 60 * MINUTE),
    );
    const before = await snapshot(booking.id);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'mechanic_busy' });
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('refuses a lift with an overlapping confirmed booking', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    await confirmedAt(t, TEN, 1);
    const { booking } = await accepted(
      t,
      new Date(TEN.getTime() + 89 * MINUTE),
    );

    const res = await confirm(booking.id, owner(t), {
      lift: 1,
      mechanicId: t.answeringMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'lift_busy' });
  });

  it('confirms a booking that starts as the other ends, on the same mechanic and lift', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    await confirmedAt(t, TEN, 1);
    const { booking } = await accepted(
      t,
      new Date(TEN.getTime() + 90 * MINUTE),
    );

    const res = await confirm(booking.id, owner(t), {
      lift: 1,
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
  });

  it.each([
    ['mechanic', false, 'mechanic_busy'],
    ['lift', true, 'lift_busy'],
  ])(
    'ends two confirms racing for one %s with one confirmed',
    async (_, sameLift, code) => {
      const t = await team('Atelier Dinamo');
      await lifts(t.garage.id, 2);
      const a = await accepted(t);
      const b = await accepted(t, new Date(TEN.getTime() + 30 * MINUTE));
      const second = sameLift
        ? { lift: 1, mechanicId: t.answeringMechanic.id }
        : { mechanicId: t.plainMechanic.id };

      const answers = await Promise.all([
        confirm(a.booking.id, owner(t), {
          lift: 1,
          mechanicId: t.plainMechanic.id,
        }),
        confirm(b.booking.id, bearer(t.receptionist, 'receptionist'), second),
      ]);

      expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(answers.find((r) => r.status === 409)?.body).toMatchObject({
        code,
      });
      expect(
        await prisma.booking.count({ where: { status: 'confirmed' } }),
      ).toBe(1);
      expect(await prisma.job.count()).toBe(1);
    },
  );
});

// @traces 389-FR-008
describe('the garage’s hours', () => {
  const every = (spans: [string, string][]) =>
    Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, spans]),
    );

  afterEach(() =>
    prisma.publicHoliday.deleteMany({ where: { nameEn: 'Test day' } }),
  );

  it.each([
    ['ends after closing', [['08:00', '11:00']]],
    [
      'falls in the lunch break',
      [
        ['08:00', '10:30'],
        ['12:00', '18:00'],
      ],
    ],
    ['starts before opening', [['10:30', '18:00']]],
  ] as [string, [string, string][]][])(
    'refuses a slot that %s',
    async (_, spans) => {
      const t = await team('Atelier Dinamo');
      await prisma.garage.update({
        data: { hours: every(spans) },
        where: { id: t.garage.id },
      });
      const { booking } = await accepted(t);
      const before = await snapshot(booking.id);

      const res = await confirm(booking.id, owner(t), {
        mechanicId: t.plainMechanic.id,
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'outside_hours' });
      expect(await snapshot(booking.id)).toEqual(before);
    },
  );

  it('confirms a slot that ends as the garage closes', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.garage.update({
      data: { hours: every([['08:00', '11:30']]) },
      where: { id: t.garage.id },
    });
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
  });

  it('refuses a slot on one of the garage’s closed days', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.garage.update({
      data: { hours: every([['08:00', '18:00']]) },
      where: { id: t.garage.id },
    });
    await prisma.garageClosedDay.create({
      data: { day: new Date(`${DAY}T00:00:00Z`), garageId: t.garage.id },
    });
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'outside_hours' });
  });

  it('refuses a slot on a public holiday', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.garage.update({
      data: { hours: every([['08:00', '18:00']]) },
      where: { id: t.garage.id },
    });
    await prisma.publicHoliday.upsert({
      create: {
        day: new Date(`${DAY}T00:00:00Z`),
        nameEn: 'Test day',
        nameRo: 'Zi de test',
      },
      update: {},
      where: { day: new Date(`${DAY}T00:00:00Z`) },
    });
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'outside_hours' });
  });

  it('confirms any slot of a garage that has not set its hours', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t, atLocal(DAY, 23));

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
  });
});
