// @traces 374-FR-003
// @traces 374-FR-005
// @traces 374-FR-009
// @traces 374-FR-010
// @traces 374-FR-012
import { randomUUID } from 'node:crypto';

import { GarageScheduleService } from './garage-schedule.service';
import type { Actor } from '../../auth/policy';
import type { BookingStatus } from '../../generated/prisma/enums';
import { garageActor } from '../quotes.testing';
import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;
const service = new GarageScheduleService(prisma);
// The read of the actor's own garage.
const list = (
  actor: Actor,
  query: Parameters<typeof service.list>[2],
  now: Date,
) => service.list(actor, actor.garageId as string, query, now);

// Friday 9 October 2026, 10:00 in Bucharest.
const NOW = new Date('2026-10-09T07:00:00Z');

type Team = Awaited<ReturnType<typeof team>>;

const booked = (
  t: Team,
  startsAt: string,
  status?: BookingStatus,
  options?: Parameters<typeof world.booked>[3],
) => world.booked(t.garage.id, startsAt, status, options);

const owner = (t: Team) => garageActor(t.owner, t.garage.id);
const ids = (answer: { entries: { id: string }[] }) =>
  answer.entries.map((e) => e.id);

describe('the garage schedule read', () => {
  it('lists today’s bookings in start order with car, jobs, mechanic, lift and state', async () => {
    const t = await team('Atelier Dinamo');
    const late = await booked(t, '2026-10-09T12:00:00Z', 'confirmed', {
      lift: 2,
      mechanicId: t.answeringMechanic.id,
    });
    const early = await booked(t, '2026-10-09T05:30:00Z', 'completed', {
      lift: 1,
    });

    const answer = await list(owner(t), {}, NOW);

    expect(answer).toMatchObject({
      from: '2026-10-09',
      lifts: true,
      to: '2026-10-09',
    });
    expect(ids(answer)).toEqual([early.id, late.id]);
    expect(answer.entries[1]).toEqual({
      car: { brand: 'Mini', model: 'Cooper S', year: 2019 },
      confirmBy: null,
      customer: 'Andrei M.',
      durationMinutes: 90,
      id: late.id,
      jobStatus: null,
      jobs: ['Schimb ulei'],
      lift: 2,
      mechanic: { id: t.answeringMechanic.id, name: 'Fixer' },
      minutesLeft: null,
      segments: [
        {
          endsAt: '2026-10-09T13:30:00.000Z',
          lift: 2,
          mechanicId: t.answeringMechanic.id,
          startsAt: '2026-10-09T12:00:00.000Z',
        },
      ],
      startsAt: '2026-10-09T12:00:00.000Z',
      status: 'confirmed',
    });
    expect(answer.entries[0].mechanic).toBeNull();
  });

  it('carries the time left to confirm a booking still awaiting the garage', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-09T14:00:00Z', 'awaiting_confirmation', {
      confirmBy: '2026-10-09T07:37:30Z',
    });

    const [entry] = (await list(owner(t), {}, NOW)).entries;

    expect(entry).toMatchObject({
      confirmBy: '2026-10-09T07:37:30.000Z',
      minutesLeft: 37,
      status: 'awaiting_confirmation',
    });
  });

  it('leaves out lapsed and cancelled bookings and keeps no-shows', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-09T06:00:00Z', 'lapsed');
    await booked(t, '2026-10-09T07:00:00Z', 'cancelled');
    const missed = await booked(t, '2026-10-09T08:00:00Z', 'no_show');

    const answer = await list(owner(t), {}, NOW);

    expect(ids(answer)).toEqual([missed.id]);
    expect(answer.entries[0].status).toBe('no_show');
  });

  it('covers whole Bucharest days, across the autumn clock change', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-24T19:30:00Z');
    const first = await booked(t, '2026-10-24T21:30:00Z');
    const last = await booked(t, '2026-10-25T21:30:00Z');
    await booked(t, '2026-10-25T22:30:00Z');

    const answer = await list(
      owner(t),
      { from: '2026-10-25', to: '2026-10-25' },
      NOW,
    );

    expect(ids(answer)).toEqual([first.id, last.id]);
  });

  it('spans up to seven days and refuses more', async () => {
    const t = await team('Atelier Dinamo');
    const monday = await booked(t, '2026-10-12T07:00:00Z');
    const sunday = await booked(t, '2026-10-18T07:00:00Z');

    const week = await list(
      owner(t),
      { from: '2026-10-12', to: '2026-10-18' },
      NOW,
    );

    expect(ids(week)).toEqual([monday.id, sunday.id]);
    await expect(
      list(owner(t), { from: '2026-10-12', to: '2026-10-19' }, NOW),
    ).rejects.toMatchObject({
      response: { code: 'validation_failed' },
      status: 400,
    });
    await expect(
      list(owner(t), { from: '2026-10-12', to: '2026-10-11' }, NOW),
    ).rejects.toMatchObject({
      response: { code: 'validation_failed' },
      status: 400,
    });
  });

  it('filters by lift and by mechanic', async () => {
    const t = await team('Atelier Dinamo');
    const onTwo = await booked(t, '2026-10-09T06:00:00Z', 'confirmed', {
      lift: 2,
    });
    const fixers = await booked(t, '2026-10-09T08:00:00Z', 'confirmed', {
      lift: 1,
      mechanicId: t.answeringMechanic.id,
    });

    expect(ids(await list(owner(t), { lift: 2 }, NOW))).toEqual([onTwo.id]);
    expect(
      ids(await list(owner(t), { mechanicId: t.answeringMechanic.id }, NOW)),
    ).toEqual([fixers.id]);
  });

  it('drops the lift and refuses a lift filter when the garage schedules without lifts', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-09T06:00:00Z', 'confirmed', { lift: 2 });
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: t.garage.id, key: 'lift_schedule' },
    });

    const answer = await list(owner(t), {}, NOW);

    expect(answer.lifts).toBe(false);
    expect(answer.entries).toHaveLength(1);
    expect(answer.entries[0]).not.toHaveProperty('lift');
    await expect(list(owner(t), { lift: 2 }, NOW)).rejects.toMatchObject({
      response: { code: 'validation_failed' },
      status: 400,
    });
  });

  it('answers as empty for another garage’s mechanic or lift, and never shows its bookings', async () => {
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    await booked(militari, '2026-10-09T06:00:00Z', 'confirmed', {
      lift: 2,
      mechanicId: militari.answeringMechanic.id,
    });

    expect((await list(owner(dinamo), {}, NOW)).entries).toEqual([]);
    expect(
      (
        await list(
          owner(dinamo),
          { mechanicId: militari.answeringMechanic.id },
          NOW,
        )
      ).entries,
    ).toEqual([]);
    expect(
      (await list(owner(dinamo), { mechanicId: randomUUID() }, NOW)).entries,
    ).toEqual([]);
  });

  it('lets the receptionist read it and no driver', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-09T06:00:00Z');

    const desk = await list(
      garageActor(t.receptionist, t.garage.id, 'receptionist'),
      {},
      NOW,
    );

    expect(desk.entries).toHaveLength(1);
    await expect(
      list(garageActor(t.owner, t.garage.id, 'driver'), {}, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });

  // @traces 102-FR-008
  it.each([
    ['without', false],
    ['with', true],
  ])(
    'shows a mechanic only her own bookings, %s the right to answer quotes',
    async (_, canAnswerQuotes) => {
      const t = await team('Atelier Dinamo');
      const hers = await booked(t, '2026-10-09T06:00:00Z', 'confirmed', {
        mechanicId: t.answeringMechanic.id,
      });
      await booked(t, '2026-10-09T08:00:00Z', 'confirmed', {
        mechanicId: t.plainMechanic.id,
      });
      await booked(t, '2026-10-09T10:00:00Z');
      const mechanic = garageActor(t.answering, t.garage.id, 'mechanic', {
        canAnswerQuotes,
      });

      const answer = await list(mechanic, {}, NOW);

      expect(ids(answer)).toEqual([hers.id]);
      expect(JSON.stringify(answer)).not.toContain('phone');
      expect(
        ids(await list(mechanic, { mechanicId: t.answeringMechanic.id }, NOW)),
      ).toEqual([hers.id]);
      await expect(
        list(mechanic, { mechanicId: t.plainMechanic.id }, NOW),
      ).rejects.toMatchObject({
        response: { code: 'forbidden' },
        status: 403,
      });
    },
  );

  // @traces 1381-FR-002
  it('answers a mechanic 403 for another garage’s mechanic, and 404 once her card is removed', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Militari');
    await booked(t, '2026-10-09T06:00:00Z', 'confirmed', {
      mechanicId: t.answeringMechanic.id,
    });
    const mechanic = garageActor(t.answering, t.garage.id, 'mechanic');

    await expect(
      service.list(
        mechanic,
        t.garage.id,
        { mechanicId: other.plainMechanic.id },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: t.answeringMechanic.id },
    });
    await expect(
      service.list(mechanic, t.garage.id, {}, NOW),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('shows no plate and changes nothing', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-09T06:00:00Z');
    const before = await prisma.booking.findMany({ orderBy: { id: 'asc' } });
    const logged = await prisma.activityLog.count();

    const answer = await list(owner(t), {}, NOW);

    expect(JSON.stringify(answer)).not.toContain('B123ABC');
    expect(await prisma.booking.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before,
    );
    expect(await prisma.activityLog.count()).toBe(logged);
  });
});

// @traces 150-FR-009
describe('GET /garages/:garageId/schedule', () => {
  const path = (garageId: string, query = 'from=2026-11-05') =>
    `/garages/${garageId}/schedule?${query}`;
  const read = async (garageId: string, auth: string, query?: string) =>
    (await get(path(garageId, query), auth)).body;
  const idsOf = (body: { entries: { id: string }[] }) =>
    body.entries.map((e) => e.id);

  // Thursday 5 November 2026 at `hour` in Bucharest, as an ISO instant.
  const on5 = (hour: number) =>
    new Date(Date.UTC(2026, 10, 5, hour - 2)).toISOString();

  it('gives the owner and the receptionist every booking of the day, with its customer, job and segments', async () => {
    const t = await team('Atelier Dinamo');
    const confirmed = await booked(t, on5(9), 'confirmed', {
      lift: 1,
      mechanicId: t.plainMechanic.id,
    });
    await world.job(confirmed.id, 'in_work', {
      mechanicId: t.plainMechanic.id,
    });
    const awaiting = await booked(t, on5(12), 'awaiting_confirmation');
    await booked(t, on5(13), 'lapsed');
    await booked(t, on5(14), 'cancelled');

    const answer = await read(t.garage.id, bearer(t.owner, 'garage'));

    expect(answer).toMatchObject({
      from: '2026-11-05',
      lifts: true,
      to: '2026-11-05',
    });
    expect(idsOf(answer)).toEqual([confirmed.id, awaiting.id]);
    expect(answer.entries[0]).toMatchObject({
      customer: 'Andrei M.',
      durationMinutes: 90,
      jobStatus: 'in_work',
      lift: 1,
      mechanic: { id: t.plainMechanic.id, name: 'Hand' },
      segments: [
        {
          endsAt: new Date(Date.UTC(2026, 10, 5, 8, 30)).toISOString(),
          lift: 1,
          mechanicId: t.plainMechanic.id,
          startsAt: on5(9),
        },
      ],
      startsAt: on5(9),
      status: 'confirmed',
    });
    expect(answer.entries[1]).toMatchObject({
      jobStatus: null,
      segments: [],
      status: 'awaiting_confirmation',
    });
    expect(
      await read(t.garage.id, bearer(t.receptionist, 'receptionist')),
    ).toEqual(answer);
  });

  it('shows a mechanic her own bookings, and all of them once she may move bookings', async () => {
    const t = await team('Atelier Dinamo');
    const hers = await booked(t, on5(9), 'confirmed', {
      mechanicId: t.plainMechanic.id,
    });
    const his = await booked(t, on5(11), 'confirmed', {
      mechanicId: t.answeringMechanic.id,
    });
    const auth = bearer(t.plain, 'mechanic');

    expect(idsOf(await read(t.garage.id, auth))).toEqual([hers.id]);
    await prisma.mechanic.update({
      data: { canMoveBookings: true },
      where: { id: t.plainMechanic.id },
    });
    expect(idsOf(await read(t.garage.id, auth))).toEqual([hers.id, his.id]);
  });

  it('answers 404 to another garage, a driver, an admin and an unknown garage, and 401 to a visitor', async () => {
    const t = await team('Atelier Dinamo');
    const rival = await team('Service Militari');
    await booked(t, on5(9));
    const driver = await world.account('Dan Vasile');
    const admin = await world.account('Ana Admin', ['admin']);

    for (const auth of [
      bearer(rival.owner, 'garage'),
      bearer(rival.plain, 'mechanic'),
      bearer(driver, 'driver'),
      bearer(admin, 'admin'),
    ]) {
      const res = await get(path(t.garage.id), auth);
      // The app's problem filter names a 404 not_found; this test app has none.
      expect(res.status).toBe(404);
    }
    expect(
      (await get(path(randomUUID()), bearer(t.owner, 'garage'))).status,
    ).toBe(404);
    const visitor = await get(path(t.garage.id));
    expect(visitor.status).toBe(401);
    expect(visitor.body).toMatchObject({ code: 'sign_in_required' });
  });

  it.each([
    ['eight days', 'from=2026-11-05&to=2026-11-12'],
    ['a to before the from', 'from=2026-11-05&to=2026-11-04'],
    ['a day that is not one', 'from=2026-13-45'],
  ])('refuses %s as validation_failed', async (name, query) => {
    const t = await team('Atelier Dinamo');

    const res = await get(path(t.garage.id, query), bearer(t.owner, 'garage'));

    expect(res.status).toBe(400);
    // The DTO pipe's refusal gets its code from the app's problem filter,
    // which this test app leaves out; the read's own refusal carries it.
    if (name !== 'a day that is not one')
      expect(res.body).toMatchObject({ code: 'validation_failed' });
  });

  it('carries no lift while the garage schedules without lifts', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, on5(9), 'confirmed', { lift: 2 });
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: t.garage.id, key: 'lift_schedule' },
    });

    const answer = await read(t.garage.id, bearer(t.owner, 'garage'));

    expect(answer.lifts).toBe(false);
    expect(answer.entries[0]).not.toHaveProperty('lift');
    expect(answer.entries[0].segments[0]).not.toHaveProperty('lift');
  });

  it('shows a long job on its second day with all its segments', async () => {
    const t = await team('Atelier Dinamo');
    // Wednesday 4 November 08:00 to 16:00, then Thursday 08:00 to 12:00.
    const wednesday = new Date(Date.UTC(2026, 10, 4, 6)).toISOString();
    const long = await booked(t, wednesday, 'confirmed', {
      mechanicId: t.plainMechanic.id,
    });
    await prisma.booking.update({
      data: { durationMinutes: 720 },
      where: { id: long.id },
    });
    await prisma.bookingSegment.deleteMany({ where: { bookingId: long.id } });
    const spans = [
      [new Date(Date.UTC(2026, 10, 4, 6)), new Date(Date.UTC(2026, 10, 4, 14))],
      [new Date(Date.UTC(2026, 10, 5, 6)), new Date(Date.UTC(2026, 10, 5, 10))],
    ];
    await prisma.bookingSegment.createMany({
      data: spans.map(([startsAt, endsAt]) => ({
        bookingId: long.id,
        endsAt,
        garageId: t.garage.id,
        mechanicId: t.plainMechanic.id,
        startsAt,
      })),
    });

    const answer = await read(t.garage.id, bearer(t.owner, 'garage'));

    expect(idsOf(answer)).toEqual([long.id]);
    expect(answer.entries[0].startsAt).toBe(wednesday);
    expect(
      answer.entries[0].segments.map((s: { startsAt: string }) => s.startsAt),
    ).toEqual(spans.map(([startsAt]) => startsAt.toISOString()));
    expect(
      idsOf(
        await read(t.garage.id, bearer(t.owner, 'garage'), 'from=2026-11-06'),
      ),
    ).toEqual([]);
  });

  it('keeps a no-show and a completed booking without segments on their start day', async () => {
    const t = await team('Atelier Dinamo');
    const missed = await booked(t, on5(9), 'no_show');
    const done = await booked(t, on5(11), 'completed');

    expect(idsOf(await read(t.garage.id, bearer(t.owner, 'garage')))).toEqual([
      missed.id,
      done.id,
    ]);
    expect(
      idsOf(
        await read(t.garage.id, bearer(t.owner, 'garage'), 'from=2026-11-04'),
      ),
    ).toEqual([]);
  });

  it("reads sixty bookings over seven days in one request, none of another garage's", async () => {
    const t = await team('Atelier Dinamo');
    const rival = await team('Service Militari');
    const ours = new Set<string>();
    for (let n = 0; n < 60; n++) {
      const at = new Date(Date.UTC(2026, 10, 2 + (n % 7), 6 + (n % 9)));
      ours.add((await booked(t, at.toISOString(), 'confirmed')).id);
    }
    for (let n = 0; n < 5; n++) {
      await booked(
        rival,
        new Date(Date.UTC(2026, 10, 3 + n, 7)).toISOString(),
        'confirmed',
      );
    }

    const answer = await read(
      t.garage.id,
      bearer(t.owner, 'garage'),
      'from=2026-11-02&to=2026-11-08',
    );

    expect(answer.entries).toHaveLength(60);
    expect(idsOf(answer).every((id) => ours.has(id))).toBe(true);
  });
});

// @traces 427-FR-011
describe('the blocked time on the schedule read', () => {
  // Thursday 5 November 2026 at `hour` in Bucharest, as an ISO instant.
  const on5 = (hour: number, day = 5) =>
    new Date(Date.UTC(2026, 10, day, hour - 2)).toISOString();
  const read = async (t: Team, auth: string, query = 'from=2026-11-05') =>
    (await get(`/garages/${t.garage.id}/schedule?${query}`, auth)).body;
  const blockIds = (body: { blocks: { id: string }[] }) =>
    body.blocks.map((b) => b.id);

  // A block stored as the routes store it: the row and its one-day segment.
  async function blocked(
    t: Team,
    from: string,
    to: string,
    holds: { mechanicId?: string; lift?: number; note?: string },
  ) {
    const block = await prisma.timeBlock.create({
      data: {
        createdBy: t.owner,
        endsAt: new Date(to),
        garageId: t.garage.id,
        lift: holds.lift ?? null,
        mechanicId: holds.mechanicId ?? null,
        note: holds.note ?? null,
        startsAt: new Date(from),
        updatedBy: t.owner,
      },
    });
    await prisma.bookingSegment.create({
      data: {
        endsAt: new Date(to),
        garageId: t.garage.id,
        lift: holds.lift ?? null,
        mechanicId: holds.mechanicId ?? null,
        startsAt: new Date(from),
        timeBlockId: block.id,
      },
    });
    return block;
  }

  it('gives the owner and the receptionist every block with its note, lift and segments', async () => {
    const t = await team('Atelier Dinamo');
    const hand = await blocked(t, on5(9), on5(10), {
      lift: 2,
      mechanicId: t.plainMechanic.id,
      note: 'Client la telefon',
    });
    const lift = await blocked(t, on5(11), on5(12), { lift: 3 });

    const owner = await read(t, bearer(t.owner, 'garage'));
    const desk = await read(t, bearer(t.receptionist, 'receptionist'));

    expect(owner.blocks).toEqual([
      {
        endsAt: on5(10),
        id: hand.id,
        lift: 2,
        mechanic: { id: t.plainMechanic.id, name: 'Hand' },
        note: 'Client la telefon',
        segments: [{ endsAt: on5(10), startsAt: on5(9) }],
        startsAt: on5(9),
      },
      expect.objectContaining({ id: lift.id, lift: 3, mechanic: null }),
    ]);
    expect(blockIds(desk)).toEqual([hand.id, lift.id]);
  });

  it('shows a mechanic the blocks on her own card, and all of them once she may move bookings', async () => {
    const t = await team('Atelier Dinamo');
    const hers = await blocked(t, on5(9), on5(10), {
      mechanicId: t.plainMechanic.id,
    });
    const his = await blocked(t, on5(9), on5(10), {
      mechanicId: t.answeringMechanic.id,
    });
    const lift = await blocked(t, on5(11), on5(12), { lift: 1 });
    const auth = bearer(t.plain, 'mechanic');

    expect(blockIds(await read(t, auth))).toEqual([hers.id]);
    await prisma.mechanic.update({
      data: { canMoveBookings: true },
      where: { id: t.plainMechanic.id },
    });
    // Two blocks starting together come in id order.
    expect(blockIds(await read(t, auth))).toEqual([
      ...[hers.id, his.id].sort(),
      lift.id,
    ]);
  });

  it('filters blocks by lift and by mechanic, a lift-only block never matching a mechanic', async () => {
    const t = await team('Atelier Dinamo');
    const hand = await blocked(t, on5(9), on5(10), {
      lift: 2,
      mechanicId: t.plainMechanic.id,
    });
    const lift = await blocked(t, on5(11), on5(12), { lift: 2 });
    const auth = bearer(t.owner, 'garage');

    expect(
      blockIds(
        await read(t, auth, `from=2026-11-05&mechanicId=${t.plainMechanic.id}`),
      ),
    ).toEqual([hand.id]);
    expect(blockIds(await read(t, auth, 'from=2026-11-05&lift=2'))).toEqual([
      hand.id,
      lift.id,
    ]);
    expect(blockIds(await read(t, auth, 'from=2026-11-06'))).toEqual([]);
  });

  it('carries no lift on a block while the garage schedules without lifts', async () => {
    const t = await team('Atelier Dinamo');
    await blocked(t, on5(9), on5(10), { lift: 2 });
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: t.garage.id, key: 'lift_schedule' },
    });

    const answer = await read(t, bearer(t.owner, 'garage'));

    expect(answer.blocks).toHaveLength(1);
    expect(answer.blocks[0]).not.toHaveProperty('lift');
  });

  it('reads sixty bookings and twenty blocks over seven days in one request', async () => {
    const t = await team('Atelier Dinamo');
    for (let n = 0; n < 60; n++) {
      const at = new Date(Date.UTC(2026, 10, 2 + (n % 7), 6 + (n % 9)));
      await booked(t, at.toISOString(), 'confirmed');
    }
    for (let n = 0; n < 20; n++) {
      const day = 2 + (n % 7);
      const hour = 8 + 2 * Math.floor(n / 7);
      await blocked(t, on5(hour, day), on5(hour + 1, day), { lift: 1 });
    }

    const answer = await read(
      t,
      bearer(t.owner, 'garage'),
      'from=2026-11-02&to=2026-11-08',
    );

    expect(answer.entries).toHaveLength(60);
    expect(answer.blocks).toHaveLength(20);
  });
});
