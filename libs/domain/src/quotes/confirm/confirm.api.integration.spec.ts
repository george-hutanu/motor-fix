import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';

import { ConfirmService } from './confirm.service';
import type { Actor } from '../../auth/policy';
import { addDays, atLocal, localDay } from '../../bucharest';
import { heldOpen, lockWaited } from '../../held-open.testing';
import { quotesApp } from '../quotes-api.testing';

const { bearer, get, post, provider, team, world } = quotesApp();
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

// Three days out or later, on a weekday no public holiday closes, at 10:00 in
// Bucharest: inside any day's hours below, inside a mechanic's default week,
// and after the default confirm-by.
let DAY: string;
let TEN: Date;
let SATURDAY: string;
const weekend = (d: string) => [0, 6].includes(new Date(d).getUTCDay());
const holiday = (d: string) =>
  prisma.publicHoliday.findUnique({
    where: { day: new Date(`${d}T00:00:00Z`) },
  });
beforeAll(async () => {
  let day = addDays(localDay(new Date()), 3);
  while (weekend(day) || (await holiday(day))) day = addDays(day, 1);
  DAY = day;
  TEN = atLocal(DAY, 10);
  let sat = addDays(localDay(new Date()), 3);
  while (new Date(sat).getUTCDay() !== 6 || (await holiday(sat)))
    sat = addDays(sat, 1);
  SATURDAY = sat;
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
    segments: await prisma.bookingSegment.count(),
  };
}

// @traces 389-FR-001
// @traces 389-FR-002
// @traces 276-FR-004
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
        auto: false,
        fromStatus: null,
        mechanicId: t.answeringMechanic.id,
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
          field: 'placement',
          newValue: {
            durationMinutes: 90,
            lift: 1,
            mechanicId: t.plainMechanic.id,
            startsAt: TEN.toISOString(),
          },
        }),
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

// @traces 1255-FR-015
describe('a card invited but not yet accepted', () => {
  it('is given the booking like any mechanic and stays off the profile', async () => {
    const t = await team('Atelier Dinamo');
    const elena = await prisma.mechanic.create({
      data: { garageId: t.garage.id, name: 'Elena Stan' },
    });
    await prisma.staffInvite.create({
      data: {
        email: 'elena@example.test',
        expiresAt: new Date(Date.now() + 24 * HOUR),
        garageId: t.garage.id,
        kind: 'mechanic',
        mechanicId: elena.id,
        name: 'Elena Stan',
        tokenHash: randomUUID(),
      },
    });
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), { mechanicId: elena.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      mechanic: { id: elena.id, name: 'Elena Stan' },
      status: 'confirmed',
    });
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: elena.id } }),
    ).toMatchObject({ accountId: null, onProfile: false });
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

  it('answers 404, not 403, to a mechanic of another garage', async () => {
    const t = await team('Atelier Dinamo');
    const rival = await team('Service Militari');
    const { booking } = await accepted(t);
    const before = await snapshot(booking.id);

    for (const mechanic of [rival.answering, rival.plain]) {
      const auth = bearer(mechanic, 'mechanic');
      expect((await confirm(booking.id, auth, {})).status).toBe(404);
      expect(
        (await get(`/bookings/${booking.id}/confirm-options`, auth)).status,
      ).toBe(404);
    }
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
      mechanicRequired: true,
      mechanics: [
        { id: t.answeringMechanic.id, name: 'Fixer' },
        { id: t.plainMechanic.id, name: 'Hand' },
      ],
      needsLift: false,
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

    expect(res.body).toEqual({
      liftCount: 0,
      mechanicRequired: false,
      mechanics: [],
      needsLift: false,
    });
  });

  it('still asks for a mechanic when the team is on but has none yet', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    await prisma.mechanic.deleteMany({ where: { garageId: t.garage.id } });

    const res = await get(`/bookings/${booking.id}/confirm-options`, owner(t));

    expect(res.body).toEqual({
      liftCount: 0,
      mechanicRequired: true,
      mechanics: [],
      needsLift: false,
    });
    expect((await confirm(booking.id, owner(t), {})).status).toBe(400);
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

  it('makes the owner’s mechanic row once when two first confirms run together', async () => {
    const t = await team('Atelier Dinamo');
    await switched(t.garage.id, 'team_mechanics', false);
    const first = await accepted(t);
    const second = await accepted(t, new Date(TEN.getTime() + 3 * HOUR));

    const answers = await Promise.all([
      confirm(first.booking.id, owner(t), {}),
      confirm(second.booking.id, owner(t), {}),
    ]);

    expect(answers.map((res) => res.status)).toEqual([200, 200]);
    const own = await prisma.mechanic.findMany({
      where: { accountId: t.owner },
    });
    expect(own).toHaveLength(1);
    const jobs = await prisma.job.findMany({
      where: { garageId: t.garage.id },
    });
    expect(jobs.map((j) => j.mechanicId)).toEqual([own[0].id, own[0].id]);
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

  // @traces 056-FR-015
  it("marks the fallback row as the owner's", async () => {
    const t = await team('Atelier Dinamo');
    await switched(t.garage.id, 'team_mechanics', false);
    const { booking } = await accepted(t);

    expect((await confirm(booking.id, owner(t), {})).status).toBe(200);

    expect(
      await prisma.$queryRaw<{ is_owner: boolean }[]>`
        SELECT is_owner FROM mechanic WHERE account_id = ${t.owner}::uuid`,
    ).toEqual([{ is_owner: true }]);
  });

  // @traces 056-FR-015
  it("puts two overlapping bookings both on the owner's row when the team is off", async () => {
    const t = await team('Atelier Dinamo');
    await switched(t.garage.id, 'team_mechanics', false);
    await switched(t.garage.id, 'lift_schedule', false);
    const first = await accepted(t);
    const second = await accepted(t, new Date(TEN.getTime() + 30 * MINUTE));

    expect((await confirm(first.booking.id, owner(t), {})).status).toBe(200);
    expect((await confirm(second.booking.id, owner(t), {})).status).toBe(200);

    const own = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM mechanic
      WHERE garage_id = ${t.garage.id}::uuid AND is_owner`;
    expect(own).toHaveLength(1);
    const jobs = await prisma.job.findMany({
      where: { garageId: t.garage.id },
    });
    expect(jobs.map((j) => j.mechanicId)).toEqual([own[0].id, own[0].id]);
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
      // The loser read before the winner committed (slot_taken) or after
      // its deadlock rerun (the named code).
      expect([code, 'slot_taken']).toContain(
        answers.find((r) => r.status === 409)?.body.code,
      );
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

// @traces 389-FR-003
describe('the refusals in English', () => {
  const englishOwner = (t: Team): Actor => ({
    accountId: t.owner,
    garageId: t.garage.id,
    language: 'en',
    permissions: {
      canAnswerQuotes: true,
      canMoveBookings: true,
      canRecordFinalPrice: true,
    },
    role: 'garage',
    roles: ['garage'],
  });

  const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (e: { getResponse: () => unknown }) => e,
    );
    return error?.getResponse();
  };

  it('says the mechanic is not available', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    const away = await prisma.mechanic.create({
      data: { garageId: (await world.garage('Elsewhere')).id, name: 'Away' },
    });

    const said = await refusal(
      provider(ConfirmService).confirm(englishOwner(t), booking.id, {
        mechanicId: away.id,
      }),
    );

    expect(said).toEqual({
      code: 'mechanic_unavailable',
      message: 'The mechanic is not available',
    });
  });

  it('says the slot is outside opening hours', async () => {
    const t = await team('Atelier Dinamo');
    const hours = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
        d,
        [['08:00', '09:00']],
      ]),
    );
    await prisma.garage.update({ data: { hours }, where: { id: t.garage.id } });
    const { booking } = await accepted(t);

    const said = await refusal(
      provider(ConfirmService).confirm(englishOwner(t), booking.id, {
        mechanicId: t.plainMechanic.id,
      }),
    );

    expect(said).toEqual({
      code: 'outside_hours',
      message: 'Outside opening hours (08:00–09:00)',
      reason: 'outside_opening',
    });
  });
});

// @traces 389-FR-018
describe('counting confirms the pipes refuse', () => {
  const reader = countedMetrics();
  const refused = () =>
    counterTotal(reader, 'motorfix_booking_confirms_total', {
      outcome: 'refused',
    });

  it.each([
    ['a lift that is not a whole number', { lift: 1.5 }],
    ['a mechanic id that is not one', { mechanicId: 'not-an-id' }],
  ])('counts %s as refused', async (_, body) => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking } = await accepted(t);
    const before = await refused();

    const res = await confirm(booking.id, owner(t), body);

    expect(res.status).toBe(400);
    expect(await refused()).toBe(before + 1);
  });

  it('counts a booking id that is not one as refused', async () => {
    const t = await team('Atelier Dinamo');
    const before = await refused();

    const res = await confirm('not-an-id', owner(t), {});

    expect(res.status).toBe(400);
    expect(await refused()).toBe(before + 1);
  });

  // @traces 150-FR-012
  it('counts a refusal with its reason', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.garage.update({
      data: { hours: everyDay([['08:00', '17:00']]) },
      where: { id: t.garage.id },
    });
    await setHours(t.plainMechanic.id, everyDay([['08:00', '11:00']]));
    const { booking } = await accepted(t);
    const counted = () =>
      counterTotal(reader, 'motorfix_booking_confirms_total', {
        outcome: 'mechanic_unavailable',
        reason: 'ends_early',
      });
    const before = await counted();

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: 'ends_early' });
    expect(await counted()).toBe(before + 1);
  });
});

// @traces 058-FR-012
describe("the mechanic's own hours", () => {
  const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const week = (spans: [string, string][]) =>
    Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, spans]),
    );
  const schedule = (
    mechanicId: string,
    hours: object | null,
    worksSaturdays = false,
  ) =>
    prisma.$executeRaw`UPDATE mechanic SET working_hours = ${
      hours === null ? null : JSON.stringify(hours)
    }::jsonb, works_saturdays = ${worksSaturdays} WHERE id = ${mechanicId}::uuid`;
  const dayOff = (mechanicId: string, day: string) =>
    prisma.$executeRaw`
      INSERT INTO mechanic_day_off (mechanic_id, first_day, last_day, created_by)
      VALUES (${mechanicId}::uuid, ${day}::date, ${day}::date, gen_random_uuid())`;
  const garageOpen = (t: Team) =>
    prisma.garage.update({
      data: { hours: week([['08:00', '18:00']]) },
      where: { id: t.garage.id },
    });

  it('refuses a mechanic outside her stretch, writing nothing', async () => {
    const t = await team('Atelier Dinamo');
    await garageOpen(t);
    await schedule(t.plainMechanic.id, week([['12:00', '18:00']]));
    const { booking } = await accepted(t);
    const before = await snapshot(booking.id);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'mechanic_unavailable' });
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('refuses a mechanic on her day off', async () => {
    const t = await team('Atelier Dinamo');
    await garageOpen(t);
    await dayOff(t.plainMechanic.id, DAY);
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.body).toMatchObject({ code: 'mechanic_unavailable' });
  });

  it('waits out a day off being added on that day, then refuses the mechanic', async () => {
    const t = await team('Atelier Dinamo');
    await garageOpen(t);
    const { booking } = await accepted(t);
    const add = heldOpen(prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM mechanic WHERE id = ${t.plainMechanic.id}::uuid FOR UPDATE`;
      await tx.$executeRaw`
        INSERT INTO mechanic_day_off (mechanic_id, first_day, last_day, created_by)
        VALUES (${t.plainMechanic.id}::uuid, ${DAY}::date, ${DAY}::date, gen_random_uuid())`;
    });
    await add.ready;

    // supertest sends on `then`: started now, it meets the held lock.
    const answer = confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    }).then((res) => res);
    await lockWaited(prisma);
    add.release();
    await add.done;

    expect((await answer).body).toMatchObject({ code: 'mechanic_unavailable' });
  });

  it('refuses a Saturday while she does not work Saturdays, and confirms it once she does', async () => {
    const t = await team('Atelier Dinamo');
    await garageOpen(t);
    await schedule(t.plainMechanic.id, week([['08:00', '16:00']]));
    const { booking } = await accepted(t, atLocal(SATURDAY, 10));

    const off = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });
    await schedule(t.plainMechanic.id, week([['08:00', '16:00']]), true);
    const on = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(off.body).toMatchObject({ code: 'mechanic_unavailable' });
    expect(on.status).toBe(200);
  });

  it('confirms a mechanic inside her stretch', async () => {
    const t = await team('Atelier Dinamo');
    await garageOpen(t);
    await schedule(t.plainMechanic.id, {
      ...week([]),
      [WEEKDAYS[new Date(DAY).getUTCDay()]]: [['09:00', '12:00']],
    });
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
  });

  it("still answers outside_hours for the garage's closed day before her own hours", async () => {
    const t = await team('Atelier Dinamo');
    await garageOpen(t);
    await dayOff(t.plainMechanic.id, DAY);
    await prisma.garageClosedDay.create({
      data: { day: new Date(`${DAY}T00:00:00Z`), garageId: t.garage.id },
    });
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.body).toMatchObject({ code: 'outside_hours' });
  });

  it("checks only the garage's hours with the team switched off", async () => {
    const t = await team('Atelier Dinamo');
    await garageOpen(t);
    await switched(t.garage.id, 'team_mechanics', false);
    const { booking } = await accepted(t, atLocal(SATURDAY, 10));

    const res = await confirm(booking.id, owner(t), {});

    expect(res.status).toBe(200);
  });

  it('still offers every mechanic of the garage, at work or not', async () => {
    const t = await team('Atelier Dinamo');
    await dayOff(t.plainMechanic.id, DAY);
    const { booking } = await accepted(t);

    const res = await get(`/bookings/${booking.id}/confirm-options`, owner(t));

    expect((res.body.mechanics as { id: string }[]).map((m) => m.id)).toContain(
      t.plainMechanic.id,
    );
  });
});

const actorOf = (t: Team, language: 'ro' | 'en'): Actor => ({
  accountId: t.owner,
  garageId: t.garage.id,
  language,
  permissions: {
    canAnswerQuotes: true,
    canMoveBookings: true,
    canRecordFinalPrice: true,
  },
  role: 'garage',
  roles: ['garage'],
});

// The problem details a confirm by the owner in `language` is refused with.
const refusedIn = (
  t: Team,
  bookingId: string,
  body: object,
  language: 'ro' | 'en',
) =>
  provider(ConfirmService)
    .confirm(actorOf(t, language), bookingId, body)
    .then(
      () => null,
      (error: { getResponse: () => unknown }) => error.getResponse(),
    );

const everyDay = (spans: [string, string][]) =>
  Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, spans]),
  );
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const setHours = (
  mechanicId: string,
  hours: object | null,
  saturdays = false,
) =>
  prisma.$executeRaw`UPDATE mechanic SET working_hours = ${
    hours === null ? null : JSON.stringify(hours)
  }::jsonb, works_saturdays = ${saturdays} WHERE id = ${mechanicId}::uuid`;

// @traces 150-FR-004
// @traces 150-FR-005
describe('the placement a confirm writes', () => {
  it('writes the booking as one segment on its mechanic and lift, with one placement entry', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      lift: 2,
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
    expect(
      await prisma.bookingSegment.findMany({
        where: { bookingId: booking.id },
      }),
    ).toEqual([
      expect.objectContaining({
        endsAt: new Date(TEN.getTime() + 90 * MINUTE),
        garageId: t.garage.id,
        lift: 2,
        mechanicId: t.plainMechanic.id,
        startsAt: TEN,
      }),
    ]);
    const fields = (
      await prisma.activityLog.findMany({
        where: { at: { gte: since }, subjectId: booking.id },
      })
    ).map((entry) => entry.field);
    expect(fields.filter((field) => field === 'placement')).toHaveLength(1);
    expect(fields).not.toContain('mechanic_id');
    expect(fields).not.toContain('lift');
    expect(
      await prisma.activityLog.findFirstOrThrow({
        where: { field: 'placement', subjectId: booking.id },
      }),
    ).toMatchObject({
      action: 'update',
      actorId: t.owner,
      newValue: {
        durationMinutes: 90,
        lift: 2,
        mechanicId: t.plainMechanic.id,
        startsAt: TEN.toISOString(),
      },
      oldValue: null,
      subjectType: 'booking',
    });
  });

  it('writes a confirm with no lift as a segment with none, though the garage has lifts', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
    expect(
      await prisma.bookingSegment.findMany({
        where: { bookingId: booking.id },
      }),
    ).toEqual([expect.objectContaining({ lift: null })]);
  });

  it('writes a segment with no mechanic while the team is off', async () => {
    const t = await team('Atelier Dinamo');
    await switched(t.garage.id, 'team_mechanics', false);
    const { booking } = await accepted(t);

    expect((await confirm(booking.id, owner(t), {})).status).toBe(200);
    expect(
      await prisma.bookingSegment.findMany({
        where: { bookingId: booking.id },
      }),
    ).toEqual([expect.objectContaining({ lift: null, mechanicId: null })]);
  });

  it.each([
    ['ro', 'Locul tocmai a fost ocupat'],
    ['en', 'The slot was just taken'],
  ] as const)(
    'answers slot_taken to a confirm another one beat past its read (%s)',
    async (language, message) => {
      const t = await team('Atelier Dinamo');
      const { booking } = await accepted(t);
      const rival = await accepted(t, new Date(TEN.getTime() + 60 * MINUTE));
      const taking = heldOpen(prisma, (tx) =>
        tx.bookingSegment.create({
          data: {
            bookingId: rival.booking.id,
            endsAt: new Date(TEN.getTime() + 150 * MINUTE),
            garageId: t.garage.id,
            mechanicId: t.plainMechanic.id,
            startsAt: new Date(TEN.getTime() + 60 * MINUTE),
          },
        }),
      );
      await taking.ready;
      const before = await snapshot(booking.id);

      const said = refusedIn(
        t,
        booking.id,
        { mechanicId: t.plainMechanic.id },
        language,
      );
      await lockWaited(prisma);
      taking.release();
      await taking.done;

      expect(await said).toEqual({ code: 'slot_taken', message });
      expect({ ...(await snapshot(booking.id)), segments: 0 }).toEqual({
        ...before,
        segments: 0,
      });
      expect(
        await prisma.bookingSegment.count({ where: { bookingId: booking.id } }),
      ).toBe(0);
    },
  );
});

// @traces 150-FR-006
describe('a refusal names its cause', () => {
  const RO_MONTHS = [
    'ianuarie',
    'februarie',
    'martie',
    'aprilie',
    'mai',
    'iunie',
    'iulie',
    'august',
    'septembrie',
    'octombrie',
    'noiembrie',
    'decembrie',
  ];
  const EN_MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const RO_WEEKDAYS = [
    'duminică',
    'luni',
    'marți',
    'miercuri',
    'joi',
    'vineri',
    'sâmbătă',
  ];
  const EN_WEEKDAYS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const named = (day: string, months: string[]) =>
    `${Number(day.slice(8, 10))} ${months[Number(day.slice(5, 7)) - 1]}`;

  afterEach(() =>
    prisma.publicHoliday.deleteMany({ where: { nameEn: 'Test day' } }),
  );

  // A team whose garage opens 08:00 to 17:00 every day.
  async function open() {
    const t = await team('Atelier Dinamo');
    await prisma.garage.update({
      data: { hours: everyDay([['08:00', '17:00']]) },
      where: { id: t.garage.id },
    });
    return t;
  }

  async function both(
    t: Team,
    bookingId: string,
    body: object,
    expected: { code: string; reason?: string; ro: string; en: string },
  ) {
    const { code, reason, ro, en } = expected;
    const problem = (message: string) => ({
      code,
      message,
      ...(reason && { reason }),
    });
    expect(await refusedIn(t, bookingId, body, 'ro')).toEqual(problem(ro));
    expect(await refusedIn(t, bookingId, body, 'en')).toEqual(problem(en));
  }

  it('names a public holiday by its day', async () => {
    const t = await open();
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

    await both(
      t,
      booking.id,
      { mechanicId: t.plainMechanic.id },
      {
        code: 'outside_hours',
        en: `${named(DAY, EN_MONTHS)} is a legal holiday`,
        reason: 'public_holiday',
        ro: `${named(DAY, RO_MONTHS)} e sărbătoare legală`,
      },
    );
  });

  it.each([
    ['one of its closed days', true, [['08:00', '17:00']]],
    ['a weekday it has no hours on', false, []],
  ] as [string, boolean, [string, string][]][])(
    'names the garage closed on %s',
    async (_, closedDay, spans) => {
      const t = await open();
      await prisma.garage.update({
        data: {
          hours: {
            ...everyDay([['08:00', '17:00']]),
            [WEEKDAY_KEYS[new Date(DAY).getUTCDay()]]: spans,
          },
        },
        where: { id: t.garage.id },
      });
      if (closedDay) {
        await prisma.garageClosedDay.create({
          data: { day: new Date(`${DAY}T00:00:00Z`), garageId: t.garage.id },
        });
      }
      const { booking } = await accepted(t);

      await both(
        t,
        booking.id,
        { mechanicId: t.plainMechanic.id },
        {
          code: 'outside_hours',
          en: 'The garage is closed that day',
          reason: 'closed_day',
          ro: 'Service-ul e închis în ziua aceea',
        },
      );
    },
  );

  it("names the garage's opening hours for a start outside them", async () => {
    const t = await open();
    await prisma.garage.update({
      data: {
        hours: everyDay([
          ['08:00', '09:30'],
          ['13:00', '17:00'],
        ]),
      },
      where: { id: t.garage.id },
    });
    const { booking } = await accepted(t);

    await both(
      t,
      booking.id,
      { mechanicId: t.plainMechanic.id },
      {
        code: 'outside_hours',
        en: 'Outside opening hours (08:00–09:30, 13:00–17:00)',
        reason: 'outside_opening',
        ro: 'În afara programului (08:00–09:30, 13:00–17:00)',
      },
    );
  });

  it('names a day off of the mechanic', async () => {
    const t = await open();
    await prisma.$executeRaw`
      INSERT INTO mechanic_day_off (mechanic_id, first_day, last_day, created_by)
      VALUES (${t.plainMechanic.id}::uuid, ${DAY}::date, ${DAY}::date, gen_random_uuid())`;
    const { booking } = await accepted(t);

    await both(
      t,
      booking.id,
      { mechanicId: t.plainMechanic.id },
      {
        code: 'mechanic_unavailable',
        en: 'Hand is off that day',
        reason: 'day_off',
        ro: 'Hand e liberă în ziua aceea',
      },
    );
  });

  it('names a Saturday the mechanic does not work', async () => {
    const t = await open();
    await setHours(t.plainMechanic.id, everyDay([['08:00', '16:00']]));
    const { booking } = await accepted(t, atLocal(SATURDAY, 10));

    await both(
      t,
      booking.id,
      { mechanicId: t.plainMechanic.id },
      {
        code: 'mechanic_unavailable',
        en: 'Hand does not work on Saturdays',
        reason: 'saturday_off',
        ro: 'Hand nu lucrează sâmbăta',
      },
    );
  });

  it('names a weekday the mechanic has no hours on', async () => {
    const t = await open();
    await setHours(t.plainMechanic.id, {
      ...everyDay([['08:00', '16:00']]),
      [WEEKDAY_KEYS[new Date(DAY).getUTCDay()]]: [],
    });
    const { booking } = await accepted(t);

    await both(
      t,
      booking.id,
      { mechanicId: t.plainMechanic.id },
      {
        code: 'mechanic_unavailable',
        en: 'Hand does not work that day',
        reason: 'not_working',
        ro: 'Hand nu lucrează în ziua aceea',
      },
    );
  });

  it("names the end of the mechanic's day when it comes before the job's", async () => {
    const t = await open();
    await setHours(t.plainMechanic.id, everyDay([['08:00', '11:00']]));
    const { booking } = await accepted(t);

    await both(
      t,
      booking.id,
      { mechanicId: t.plainMechanic.id },
      {
        code: 'mechanic_unavailable',
        en: 'Hand works until 11:00 that day',
        reason: 'ends_early',
        ro: 'Hand lucrează până la 11:00 în ziua aceea',
      },
    );
  });

  it("names the mechanic's other booking by its time", async () => {
    const t = await open();
    await world.booked(
      t.garage.id,
      new Date(TEN.getTime() + 30 * MINUTE).toISOString(),
      'confirmed',
      { mechanicId: t.plainMechanic.id },
    );
    const { booking } = await accepted(t);

    await both(
      t,
      booking.id,
      { mechanicId: t.plainMechanic.id },
      {
        code: 'mechanic_busy',
        en: 'Hand has a booking 10:30–12:00',
        ro: 'Hand are o programare 10:30–12:00',
      },
    );
  });

  it('names the busy lift by its time and car', async () => {
    const t = await open();
    await lifts(t.garage.id, 2);
    await world.booked(
      t.garage.id,
      new Date(TEN.getTime() + 30 * MINUTE).toISOString(),
      'confirmed',
      { lift: 1 },
    );
    const { booking } = await accepted(t);

    await both(
      t,
      booking.id,
      { lift: 1, mechanicId: t.plainMechanic.id },
      {
        code: 'lift_busy',
        en: 'Lift 1 is busy 10:30–12:00 (Mini Cooper S)',
        ro: 'Elevatorul 1 e ocupat 10:30–12:00 (Mini Cooper S)',
      },
    );
  });

  it('names a busy segment on a later day by its weekday', async () => {
    const t = await open();
    let next = addDays(DAY, 1);
    while (
      [0, 6].includes(new Date(next).getUTCDay()) ||
      (await prisma.publicHoliday.findUnique({
        where: { day: new Date(`${next}T00:00:00Z`) },
      }))
    )
      next = addDays(next, 1);
    await prisma.garage.update({
      data: {
        hours: {
          ...everyDay([['08:00', '16:00']]),
          sat: [],
          sun: [],
        },
      },
      where: { id: t.garage.id },
    });
    await world.booked(
      t.garage.id,
      atLocal(next, 9).toISOString(),
      'confirmed',
      {
        mechanicId: t.plainMechanic.id,
      },
    );
    const { booking } = await accepted(t, atLocal(DAY, 15));
    await prisma.booking.update({
      data: { durationMinutes: 540 },
      where: { id: booking.id },
    });
    const weekday = new Date(next).getUTCDay();

    await both(
      t,
      booking.id,
      { mechanicId: t.plainMechanic.id },
      {
        code: 'mechanic_busy',
        en: `Hand has a booking ${EN_WEEKDAYS[weekday]} 09:00–10:30`,
        ro: `Hand are o programare ${RO_WEEKDAYS[weekday]} 09:00–10:30`,
      },
    );
  });

  it('keeps the shipped words, with no reason, for a mechanic not of the garage', async () => {
    const t = await open();
    const away = await prisma.mechanic.create({
      data: { garageId: (await world.garage('Elsewhere')).id, name: 'Away' },
    });
    const { booking } = await accepted(t);

    await both(
      t,
      booking.id,
      { mechanicId: away.id },
      {
        code: 'mechanic_unavailable',
        en: 'The mechanic is not available',
        ro: 'Mecanicul nu e disponibil',
      },
    );
  });
});

// The first day from three days out on the UTC weekday `weekday` (0 Sunday)
// whose own day and each of `clear` days after it no public holiday closes.
async function nextOn(weekday: number, clear: number[] = []) {
  let day = addDays(localDay(new Date()), 3);
  for (;;) {
    if (new Date(day).getUTCDay() === weekday) {
      const days = [0, ...clear].map((n) => addDays(day, n));
      const closed = await Promise.all(days.map(holiday));
      if (closed.every((row) => !row)) return day;
    }
    day = addDays(day, 1);
  }
}

// The last Sunday of `month` (1 to 12) from three days out on.
function lastSunday(month: number) {
  const soon = addDays(localDay(new Date()), 3);
  for (let year = Number(soon.slice(0, 4)); ; year++) {
    const end = new Date(Date.UTC(year, month, 0));
    const day = addDays(end.toISOString().slice(0, 10), -end.getUTCDay());
    if (day >= soon) return day;
  }
}

const segmentsOf = async (bookingId: string) =>
  (
    await prisma.bookingSegment.findMany({
      orderBy: { startsAt: 'asc' },
      where: { bookingId },
    })
  ).map(({ endsAt, lift, mechanicId, startsAt }) => ({
    endsAt,
    lift,
    mechanicId,
    startsAt,
  }));

const span = (day: string, from: number, to: number) => ({
  endsAt: atLocal(day, to),
  startsAt: atLocal(day, from),
});

// @traces 150-FR-003
describe('a job longer than its working stretch', () => {
  const WEEKDAYS_8_16 = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, [['08:00', '16:00']]]),
  );

  // A team whose garage opens 08:00 to 17:00 every day, its mechanic Hand
  // working 08:00 to 16:00 on weekdays, and a booking of `minutes` at `at`.
  async function long(at: Date, minutes: number) {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    await prisma.garage.update({
      data: { hours: everyDay([['08:00', '17:00']]) },
      where: { id: t.garage.id },
    });
    await setHours(t.plainMechanic.id, WEEKDAYS_8_16);
    const { booking } = await accepted(t, at);
    await prisma.booking.update({
      data: { durationMinutes: minutes },
      where: { id: booking.id },
    });
    return { booking, t };
  }

  it('fills the day and goes on the next morning, on the same mechanic and lift', async () => {
    const monday = await nextOn(1, [1]);
    const { booking, t } = await long(atLocal(monday, 8), 720);

    const res = await confirm(booking.id, owner(t), {
      lift: 2,
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
    const on = { lift: 2, mechanicId: t.plainMechanic.id };
    expect(await segmentsOf(booking.id)).toEqual([
      { ...on, ...span(monday, 8, 16) },
      { ...on, ...span(addDays(monday, 1), 8, 12) },
    ]);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .durationMinutes,
    ).toBe(720);
  });

  it('skips a day off of the mechanic', async () => {
    const monday = await nextOn(1, [2]);
    const { booking, t } = await long(atLocal(monday, 8), 720);
    const tuesday = new Date(`${addDays(monday, 1)}T00:00:00Z`);
    await prisma.mechanicDayOff.create({
      data: {
        createdBy: t.owner,
        firstDay: tuesday,
        lastDay: tuesday,
        mechanicId: t.plainMechanic.id,
      },
    });

    expect(
      (await confirm(booking.id, owner(t), { mechanicId: t.plainMechanic.id }))
        .status,
    ).toBe(200);
    expect(
      (await segmentsOf(booking.id)).map(({ startsAt }) => startsAt),
    ).toEqual([atLocal(monday, 8), atLocal(addDays(monday, 2), 8)]);
  });

  it('skips a weekend she does not work', async () => {
    const friday = await nextOn(5, [3]);
    const { booking, t } = await long(atLocal(friday, 8), 720);

    expect(
      (await confirm(booking.id, owner(t), { mechanicId: t.plainMechanic.id }))
        .status,
    ).toBe(200);
    expect((await segmentsOf(booking.id))[1]).toMatchObject(
      span(addDays(friday, 3), 8, 12),
    );
  });

  it('refuses a job shorter than her stretch that runs past its end', async () => {
    const { booking, t } = await long(atLocal(DAY, 15), 120);

    expect(
      await refusedIn(t, booking.id, { mechanicId: t.plainMechanic.id }, 'en'),
    ).toEqual({
      code: 'mechanic_unavailable',
      message: 'Hand works until 16:00 that day',
      reason: 'ends_early',
    });
    expect(
      await prisma.bookingSegment.count({ where: { bookingId: booking.id } }),
    ).toBe(0);
  });

  it('goes on after the lunch break of a two-interval day with the team off', async () => {
    const t = await team('Atelier Dinamo');
    await switched(t.garage.id, 'team_mechanics', false);
    await prisma.garage.update({
      data: {
        hours: everyDay([
          ['08:00', '12:00'],
          ['13:00', '17:00'],
        ]),
      },
      where: { id: t.garage.id },
    });
    const { booking } = await accepted(t);
    await prisma.booking.update({
      data: { durationMinutes: 300 },
      where: { id: booking.id },
    });

    expect((await confirm(booking.id, owner(t), {})).status).toBe(200);
    const none = { lift: null, mechanicId: null };
    expect(await segmentsOf(booking.id)).toEqual([
      { ...none, ...span(DAY, 10, 12) },
      { ...none, ...span(DAY, 13, 16) },
    ]);
  });

  it('refuses a busy lift on a later day, naming the weekday and the car', async () => {
    const tuesday = await nextOn(2, [1]);
    const wednesday = addDays(tuesday, 1);
    const { booking, t } = await long(atLocal(tuesday, 8), 720);
    await world.booked(
      t.garage.id,
      atLocal(wednesday, 8).toISOString(),
      'confirmed',
      {
        lift: 1,
      },
    );
    const before = await snapshot(booking.id);
    const body = { lift: 1, mechanicId: t.plainMechanic.id };

    expect(await refusedIn(t, booking.id, body, 'ro')).toEqual({
      code: 'lift_busy',
      message: 'Elevatorul 1 e ocupat miercuri 08:00–09:30 (Mini Cooper S)',
    });
    expect(await refusedIn(t, booking.id, body, 'en')).toEqual({
      code: 'lift_busy',
      message: 'Lift 1 is busy Wednesday 08:00–09:30 (Mini Cooper S)',
    });
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it.each([
    ['March', 3, 1, 240, 6],
    ['October', 10, 0, 540, 8],
  ] as const)(
    'counts real minutes across the %s clock change',
    async (_, month, from, minutes, to) => {
      const sunday = lastSunday(month);
      const t = await team('Atelier Dinamo');
      await switched(t.garage.id, 'team_mechanics', false);
      await prisma.garage.update({
        data: { hours: { sun: [['00:00', '08:00']] } },
        where: { id: t.garage.id },
      });
      const { booking } = await accepted(t, atLocal(sunday, from));
      await prisma.booking.update({
        data: { durationMinutes: minutes },
        where: { id: booking.id },
      });

      expect((await confirm(booking.id, owner(t), {})).status).toBe(200);
      const [segment, ...rest] = await segmentsOf(booking.id);
      expect(rest).toEqual([]);
      expect(segment).toMatchObject(span(sunday, from, to));
      expect(segment.endsAt.getTime() - segment.startsAt.getTime()).toBe(
        minutes * MINUTE,
      );
    },
  );

  it('refuses a job its minutes cannot fill within thirty days', async () => {
    const { booking, t } = await long(TEN, 31 * 8 * 60);

    expect(
      await refusedIn(t, booking.id, { mechanicId: t.plainMechanic.id }, 'en'),
    ).toMatchObject({ code: 'outside_hours', reason: 'outside_opening' });
    expect(
      await prisma.bookingSegment.count({ where: { bookingId: booking.id } }),
    ).toBe(0);
  });

  it.each([
    ['on', true],
    ['off', false],
  ] as const)(
    'places a garage with no hours set as one span, the team %s',
    async (_, teamOn) => {
      const t = await team('Atelier Dinamo');
      if (!teamOn) await switched(t.garage.id, 'team_mechanics', false);
      await prisma.garage.update({
        data: { hours: {} },
        where: { id: t.garage.id },
      });
      await setHours(t.plainMechanic.id, null);
      const { booking } = await accepted(t);
      await prisma.booking.update({
        data: { durationMinutes: 720 },
        where: { id: booking.id },
      });
      const body = teamOn ? { mechanicId: t.plainMechanic.id } : {};

      expect((await confirm(booking.id, owner(t), body)).status).toBe(200);
      expect(await segmentsOf(booking.id)).toEqual([
        expect.objectContaining({
          endsAt: new Date(TEN.getTime() + 720 * MINUTE),
          startsAt: TEN,
        }),
      ]);
    },
  );
});

// @traces 150-FR-007
describe('a lift the jobs ask for', () => {
  // Adds to the booking's quote one included job per flag, done on a lift or not.
  async function jobs(bookingId: string, needsLift: boolean[]) {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    for (const [n, flag] of needsLift.entries()) {
      const type = await prisma.jobType.create({
        data: {
          key: `job-${randomUUID()}`,
          nameEn: 'Job',
          nameRo: 'Lucrare',
          needsLift: flag,
          status: 'approved',
        },
      });
      const asked = await prisma.requestJob.create({
        data: {
          jobTypeId: type.id,
          position: n + 1,
          requestId: booking.requestId,
        },
      });
      await prisma.quoteJob.create({
        data: {
          included: true,
          quoteId: booking.quoteId,
          requestJobId: asked.id,
        },
      });
    }
  }
  const options = async (t: Team, bookingId: string) =>
    (await get(`/bookings/${bookingId}/confirm-options`, owner(t))).body;

  it('says no lift for a diagnosis alone', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    await jobs(booking.id, [false]);

    expect(await options(t, booking.id)).toMatchObject({ needsLift: false });
  });

  it('asks for a lift when any job needs one', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    await jobs(booking.id, [false, true]);

    expect(await options(t, booking.id)).toMatchObject({ needsLift: true });
  });

  it('still confirms such a booking with no lift, its segments carrying none', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking } = await accepted(t);
    await jobs(booking.id, [true]);

    expect(
      (await confirm(booking.id, owner(t), { mechanicId: t.plainMechanic.id }))
        .status,
    ).toBe(200);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .lift,
    ).toBeNull();
    expect(await segmentsOf(booking.id)).toEqual([
      expect.objectContaining({ lift: null }),
    ]);
  });

  it('offers no lift and refuses one while the lift schedule is off', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    await switched(t.garage.id, 'lift_schedule', false);
    const { booking } = await accepted(t);
    await jobs(booking.id, [true]);

    expect(await options(t, booking.id)).toMatchObject({
      liftCount: 0,
      needsLift: true,
    });
    const res = await confirm(booking.id, owner(t), {
      lift: 1,
      mechanicId: t.plainMechanic.id,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
    expect(
      await prisma.bookingSegment.count({ where: { bookingId: booking.id } }),
    ).toBe(0);
  });
});
