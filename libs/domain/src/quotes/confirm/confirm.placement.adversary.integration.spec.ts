import { AuditService } from '../../audit/audit.service';
import { atLocal } from '../../bucharest';
import { outbox } from '../../events/event.port';
import type { BookingStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../quotes-api.testing';
import { moveBooking } from '../transitions';

const { bearer, get, post, team, world } = quotesApp();
const { prisma } = world;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Fri 5 Feb to Tue 9 Feb 2027 in Bucharest.
const FRI = '2027-02-05';
const SAT = '2027-02-06';
const MON = '2027-02-08';
const TUE = '2027-02-09';

type Team = Awaited<ReturnType<typeof team>>;

const weekdays = (to = '16:00') =>
  Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, [['08:00', to]]]),
  );

const hoursOf = (t: Team, hours: object) =>
  prisma.garage.update({ data: { hours }, where: { id: t.garage.id } });

const lifts = (t: Team, liftCount: number) =>
  prisma.garage.update({ data: { liftCount }, where: { id: t.garage.id } });

async function accepted(t: Team, startsAt: Date, durationMinutes = 90) {
  const driver = await world.account('Andrei Ion Marin');
  const request = await world.request(driver, { status: 'booked' });
  const quote = await world.quote(request.id, t.garage.id, 'accepted');
  const [asked] = await prisma.requestJob.findMany({
    where: { requestId: request.id },
  });
  await prisma.quoteJob.create({
    data: { included: true, quoteId: quote.id, requestJobId: asked.id },
  });
  const booking = await prisma.booking.create({
    data: {
      confirmBy: new Date(Date.now() + 24 * HOUR),
      driverId: driver,
      durationMinutes,
      garageId: t.garage.id,
      quoteId: quote.id,
      requestId: request.id,
      startsAt,
      status: 'awaiting_confirmation',
    },
  });
  return { booking, driver };
}

const confirm = (id: string, t: Team, body: unknown) =>
  post(`/bookings/${id}/confirm`, body, bearer(t.owner, 'garage'));

const segmentsOf = (bookingId: string) =>
  prisma.bookingSegment.findMany({
    orderBy: { startsAt: 'asc' },
    where: { bookingId },
  });

const at = (day: string, hour: number, minute = 0) =>
  new Date(atLocal(day, hour).getTime() + minute * MINUTE);

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE outbox_event'));

// @traces 150-FR-003
describe('a job longer than its stretch', () => {
  it('runs over the weekend into Monday and Tuesday on the same mechanic and lift', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t, 2);
    await hoursOf(t, weekdays());
    const { booking } = await accepted(t, at(FRI, 14), 720);

    const res = await confirm(booking.id, t, {
      lift: 2,
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
    const segments = await segmentsOf(booking.id);
    expect(
      segments.map((s) => [
        s.startsAt.toISOString(),
        s.endsAt.toISOString(),
        s.mechanicId,
        s.lift,
      ]),
    ).toEqual([
      [
        at(FRI, 14).toISOString(),
        at(FRI, 16).toISOString(),
        t.plainMechanic.id,
        2,
      ],
      [
        at(MON, 8).toISOString(),
        at(MON, 16).toISOString(),
        t.plainMechanic.id,
        2,
      ],
      [
        at(TUE, 8).toISOString(),
        at(TUE, 10).toISOString(),
        t.plainMechanic.id,
        2,
      ],
    ]);
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(row.durationMinutes).toBe(720);
  });

  it('adds a one minute segment on the next day for one minute over the stretch', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, weekdays());
    const { booking } = await accepted(t, at(MON, 8), 481);

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
    expect(
      (await segmentsOf(booking.id)).map((s) => [
        s.startsAt.toISOString(),
        s.endsAt.toISOString(),
      ]),
    ).toEqual([
      [at(MON, 8).toISOString(), at(MON, 16).toISOString()],
      [at(TUE, 8).toISOString(), at(TUE, 8, 1).toISOString()],
    ]);
  });

  it('keeps a job that fits the stretch from spilling: one minute past close is refused', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, weekdays());
    const { booking } = await accepted(t, at(MON, 15), 61);

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'outside_hours',
      reason: 'outside_opening',
    });
    expect(await prisma.bookingSegment.count()).toBe(0);
  });

  it('takes a job that ends exactly at closing as one segment', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, weekdays());
    const { booking } = await accepted(t, at(MON, 15), 60);

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
    expect(await prisma.bookingSegment.count()).toBe(1);
  });

  it('refuses a job that needs more than thirty days of stretches and writes nothing', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, weekdays());
    const { booking } = await accepted(t, at(MON, 8), 60 * 8 * 200);
    const events = await prisma.outboxEvent.count();

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'outside_hours',
      reason: 'outside_opening',
    });
    expect(await prisma.bookingSegment.count()).toBe(0);
    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(events);
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect([row.status, row.mechanicId]).toEqual([
      'awaiting_confirmation',
      null,
    ]);
  });

  it('ends a full day job on the clock-change Sunday at closing time, with one minute over spilling', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, { ...weekdays(), sun: [['08:00', '16:00']] });
    await prisma.mechanic.update({
      data: { workingHours: { sun: [['08:00', '16:00']] } },
      where: { id: t.plainMechanic.id },
    });
    const SPRING = '2027-03-28';
    const { booking } = await accepted(t, at(SPRING, 8), 480);

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });
    expect(res.status).toBe(200);
    const segments = await segmentsOf(booking.id);
    expect(segments).toHaveLength(1);
    expect(segments[0].endsAt.toISOString()).toBe(at(SPRING, 16).toISOString());

    const second = await accepted(t, at(SPRING, 8), 481);
    const other = await prisma.mechanic.create({
      data: {
        garageId: t.garage.id,
        name: 'Third',
        workingHours: { mon: [['08:00', '16:00']], sun: [['08:00', '16:00']] },
      },
    });
    const again = await confirm(second.booking.id, t, { mechanicId: other.id });
    expect(again.status).toBe(200);
    expect((await segmentsOf(second.booking.id)).length).toBe(2);
    expect((await segmentsOf(second.booking.id))[0].endsAt.toISOString()).toBe(
      '2027-03-28T13:00:00.000Z',
    );
  });
});

// @traces 150-FR-006
describe('the first cause named', () => {
  it('names a closed day that is also the mechanic’s day off as the garage’s', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, weekdays());
    await prisma.garageClosedDay.create({
      data: { day: new Date(`${MON}T00:00:00Z`), garageId: t.garage.id },
    });
    await prisma.mechanicDayOff.create({
      data: {
        createdBy: t.owner,
        firstDay: new Date(`${MON}T00:00:00Z`),
        lastDay: new Date(`${MON}T00:00:00Z`),
        mechanicId: t.plainMechanic.id,
      },
    });
    const { booking } = await accepted(t, at(MON, 10));

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'outside_hours',
      reason: 'closed_day',
    });
  });

  it('names the holiday before the closed day', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, weekdays());
    await prisma.publicHoliday.upsert({
      create: {
        day: new Date(`${TUE}T00:00:00Z`),
        nameEn: 'Test day',
        nameRo: 'Zi de test',
      },
      update: {},
      where: { day: new Date(`${TUE}T00:00:00Z`) },
    });
    await prisma.garageClosedDay.create({
      data: { day: new Date(`${TUE}T00:00:00Z`), garageId: t.garage.id },
    });
    const { booking } = await accepted(t, at(TUE, 10));

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });
    await prisma.publicHoliday.deleteMany({ where: { nameEn: 'Test day' } });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'outside_hours',
      reason: 'public_holiday',
    });
  });

  it('names a day off before the Saturday switch', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, { ...weekdays(), sat: [['08:00', '16:00']] });
    await prisma.mechanicDayOff.create({
      data: {
        createdBy: t.owner,
        firstDay: new Date(`${SAT}T00:00:00Z`),
        lastDay: new Date(`${SAT}T00:00:00Z`),
        mechanicId: t.plainMechanic.id,
      },
    });
    const { booking } = await accepted(t, at(SAT, 10));

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'mechanic_unavailable',
      reason: 'day_off',
    });
  });

  it('names Saturday off for a mechanic without the switch and takes one with it', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, { ...weekdays(), sat: [['08:00', '16:00']] });
    const a = await accepted(t, at(SAT, 10));
    const refused = await confirm(a.booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });
    await prisma.mechanic.update({
      data: {
        workingHours: { sat: [['08:00', '16:00']] },
        worksSaturdays: true,
      },
      where: { id: t.plainMechanic.id },
    });

    const taken = await confirm(a.booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: 'mechanic_unavailable',
      reason: 'saturday_off',
    });
    expect(taken.status).toBe(200);
  });

  it('names the mechanic busy before the lift when both are taken in one segment', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t, 2);
    await hoursOf(t, weekdays());
    const first = await accepted(t, at(MON, 10));
    const liftHolder = await accepted(t, at(MON, 12));
    const other = await prisma.mechanic.create({
      data: { garageId: t.garage.id, name: 'Elena Stan' },
    });
    await confirm(first.booking.id, t, { mechanicId: t.plainMechanic.id });
    await confirm(liftHolder.booking.id, t, { lift: 1, mechanicId: other.id });
    const both = await accepted(t, at(MON, 11), 120);

    const res = await confirm(both.booking.id, t, {
      lift: 1,
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'mechanic_busy' });
  });

  it('names a refusal on a later day with its weekday', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, weekdays());
    const holder = await accepted(t, at(MON, 9), 60);
    await confirm(holder.booking.id, t, { mechanicId: t.plainMechanic.id });
    const spill = await accepted(t, at(FRI, 15), 600);

    const res = await confirm(spill.booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'mechanic_busy',
      message: 'Hand are o programare luni 09:00–10:00',
    });
    expect(await segmentsOf(spill.booking.id)).toEqual([]);
  });

  it('touching a stored segment at its end is not a clash', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t, 1);
    await hoursOf(t, weekdays());
    const a = await accepted(t, at(MON, 10), 60);
    const b = await accepted(t, at(MON, 11), 60);
    const c = await accepted(t, at(MON, 9), 60);

    const results = [a, b, c].map(({ booking }) => booking.id);
    const statuses: number[] = [];
    for (const id of results) {
      statuses.push(
        (await confirm(id, t, { lift: 1, mechanicId: t.plainMechanic.id }))
          .status,
      );
    }

    expect(statuses).toEqual([200, 200, 200]);
  });
});

// @traces 150-FR-001
describe('the places a booking gives back', () => {
  const ports = { audit: new AuditService(), events: outbox };

  async function move(t: Team, id: string, to: BookingStatus) {
    const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
    await prisma.$transaction((tx) =>
      moveBooking(tx, ports, {
        actor: { accountId: t.owner, role: 'garage' },
        cancellation: { reason: 'parts_not_available', side: 'garage' },
        event: {
          audience: {
            driverAccountId: row.driverId,
            garageId: t.garage.id,
            mechanicId: row.mechanicId,
            type: 'booking',
          },
          kind: 'booking.cancelled',
        },
        id,
        to,
      } as Parameters<typeof moveBooking>[2]),
    );
  }

  it.each([
    ['cancelled', 200],
    ['no_show', 200],
    ['completed', 409],
  ] as const)(
    'a booking moved to %s leaves its slot to a rival with %i',
    async (to, expected) => {
      const t = await team('Atelier Dinamo');
      await lifts(t, 1);
      await hoursOf(t, weekdays());
      const a = await accepted(t, at(MON, 10));
      await confirm(a.booking.id, t, {
        lift: 1,
        mechanicId: t.plainMechanic.id,
      });
      expect(await prisma.bookingSegment.count()).toBe(1);
      await move(t, a.booking.id, to);
      const rival = await accepted(t, at(MON, 10));

      const res = await confirm(rival.booking.id, t, {
        lift: 1,
        mechanicId: t.plainMechanic.id,
      });

      expect(res.status).toBe(expected);
      expect(await segmentsOf(a.booking.id)).toHaveLength(
        to === 'completed' ? 1 : 0,
      );
    },
  );

  it('frees every segment of a long job at once', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, weekdays());
    const a = await accepted(t, at(FRI, 14), 720);
    await confirm(a.booking.id, t, { mechanicId: t.plainMechanic.id });
    expect(await segmentsOf(a.booking.id)).toHaveLength(3);

    await move(t, a.booking.id, 'cancelled');

    expect(await prisma.bookingSegment.count()).toBe(0);
  });
});

// @traces 150-FR-005
describe('two confirms racing for one place', () => {
  it.each([
    ['one lift', { lift: 1 }],
    ['one mechanic', {}],
  ] as const)(
    'end with exactly one confirmed on %s, never a 500',
    async (_, shared) => {
      for (let round = 0; round < 3; round++) {
        const t = await team(`Atelier ${round}`);
        await lifts(t, 1);
        await hoursOf(t, weekdays());
        const other = await prisma.mechanic.create({
          data: { garageId: t.garage.id, name: 'Elena Stan' },
        });
        const a = await accepted(t, at(MON, 10));
        const b = await accepted(t, at(MON, 10, 30));
        const mechanics =
          'lift' in shared
            ? [t.plainMechanic.id, other.id]
            : [t.plainMechanic.id, t.plainMechanic.id];

        const [x, y] = await Promise.all([
          confirm(a.booking.id, t, { ...shared, mechanicId: mechanics[0] }),
          confirm(b.booking.id, t, { ...shared, mechanicId: mechanics[1] }),
        ]);

        expect([x.status, y.status].sort()).toEqual([200, 409]);
        const loser = x.status === 409 ? x : y;
        expect(['slot_taken', 'lift_busy', 'mechanic_busy']).toContain(
          loser.body.code,
        );
        expect(
          await prisma.bookingSegment.count({
            where: { garageId: t.garage.id },
          }),
        ).toBe(1);
        expect(
          await prisma.booking.count({
            where: { garageId: t.garage.id, status: 'confirmed' },
          }),
        ).toBe(1);
      }
    },
  );
});

// @traces 150-FR-008
describe('a garage with its team switched off', () => {
  it('lets two overlapping bookings without a lift both be confirmed with no mechanic on the segments', async () => {
    const t = await team('Atelier Dinamo');
    await hoursOf(t, weekdays());
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: t.garage.id, key: 'team_mechanics' },
    });
    const a = await accepted(t, at(MON, 10));
    const b = await accepted(t, at(MON, 10, 30));

    const first = await confirm(a.booking.id, t, {});
    const second = await confirm(b.booking.id, t, {});

    expect([first.status, second.status]).toEqual([200, 200]);
    const segments = await prisma.bookingSegment.findMany({
      where: { garageId: t.garage.id },
    });
    expect(segments.map((s) => s.mechanicId)).toEqual([null, null]);
  });

  it('keeps the lift constraint: two overlapping bookings on one lift end 409 lift_busy', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t, 2);
    await hoursOf(t, weekdays());
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: t.garage.id, key: 'team_mechanics' },
    });
    const a = await accepted(t, at(MON, 10));
    const b = await accepted(t, at(MON, 10, 30));
    await confirm(a.booking.id, t, { lift: 2 });

    const res = await confirm(b.booking.id, t, { lift: 2 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'lift_busy' });
  });
});

// @traces 150-FR-007
describe('GET /bookings/:id/confirm-options needsLift', () => {
  const options = (id: string, t: Team) =>
    get(`/bookings/${id}/confirm-options`, bearer(t.owner, 'garage'));

  it('is false for a quote whose jobs need no lift and true for one that does', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t, at(MON, 10));
    await prisma.jobType.updateMany({ data: { needsLift: false } });
    const without = await options(booking.id, t);
    await prisma.jobType.updateMany({ data: { needsLift: true } });
    const withLift = await options(booking.id, t);

    expect(without.body).toMatchObject({ needsLift: false });
    expect(withLift.body).toMatchObject({ needsLift: true });
  });

  it('saves no lift when none is given whatever needsLift says', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t, 2);
    await prisma.jobType.updateMany({ data: { needsLift: true } });
    const { booking } = await accepted(t, at(MON, 10));

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(row.lift).toBeNull();
    expect((await segmentsOf(booking.id))[0].lift).toBeNull();
  });
});
