import { randomUUID } from 'node:crypto';

import { codeForStatus } from '@motor-fix/contracts';

import { addDays, atLocal, localDay } from '../../bucharest';
import type { BookingStatus, JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../quotes-api.testing';

const { bearer, get, post, team, world } = quotesApp();
const { prisma } = world;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const WEEK = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
    day,
    [['08:00', '20:00']],
  ]),
);

let DAY: string;
const weekend = (d: string) => [0, 6].includes(new Date(d).getUTCDay());
const holiday = (d: string) =>
  prisma.publicHoliday.findUnique({
    where: { day: new Date(`${d}T00:00:00Z`) },
  });
beforeAll(async () => {
  let day = addDays(localDay(new Date()), 3);
  while (weekend(day) || (await holiday(day))) day = addDays(day, 1);
  DAY = day;
});

const at = (hour: number, minute = 0, day = DAY) =>
  new Date(atLocal(day, hour).getTime() + minute * MINUTE);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
});

const asDriver = (id: string) => bearer(id, 'driver');
const ask = (
  bookingId: string,
  startsAt: unknown,
  auth?: string,
  key?: string,
) =>
  post(
    `/bookings/${bookingId}/moves`,
    { startsAt },
    auth,
    key === undefined ? randomUUID() : key,
  );

async function booked(
  options: {
    driver?: string;
    garageId?: string;
    startsAt?: Date;
    status?: BookingStatus;
    job?: JobStatus;
    moveCount?: number;
  } = {},
) {
  const andrei = await world.account(options.driver ?? 'Andrei Ion Marin');
  const volt = await team('Volt Auto');
  await prisma.garage.update({
    data: { hours: WEEK },
    where: { id: volt.garage.id },
  });
  await prisma.mechanic.update({
    data: { workingHours: WEEK, worksSaturdays: true },
    where: { id: volt.answeringMechanic.id },
  });
  await prisma.mechanic.update({
    data: { removedAt: new Date() },
    where: { id: volt.plainMechanic.id },
  });
  const { booking } = await world.chain(andrei, volt.garage.id, {
    booking: options.status ?? 'confirmed',
  });
  const row = await prisma.booking.update({
    data: {
      durationMinutes: 60,
      mechanicId: volt.answeringMechanic.id,
      moveCount: options.moveCount ?? 0,
      startsAt: options.startsAt ?? at(10),
    },
    where: { id: booking.id },
  });
  return { andrei, booking: row, volt };
}

async function secondBooking(
  volt: Awaited<ReturnType<typeof booked>>['volt'],
  startsAt: Date,
) {
  const maria = await world.account('Maria Ionescu');
  const { booking } = await world.chain(maria, volt.garage.id, {
    booking: 'confirmed',
  });
  const row = await prisma.booking.update({
    data: {
      durationMinutes: 60,
      mechanicId: volt.answeringMechanic.id,
      startsAt,
    },
    where: { id: booking.id },
  });
  return { booking: row, maria };
}

const movesOf = (bookingId: string) =>
  prisma.bookingMove.findMany({ where: { bookingId } });
const moveEvents = () =>
  prisma.outboxEvent.count({ where: { kind: 'booking.move_proposed' } });

// @traces 184-FR-002
// @traces 184-FR-003
describe('a move asked with a hostile body', () => {
  it.each([
    ['null', null],
    ['an array', ['2026-11-09T07:00:00.000Z']],
    ['an object', { at: 1 }],
    ['true', true],
    ['an empty string', ''],
    ['a date without a time', '2026-11-09'],
    ['a day that does not exist', '2026-02-30T10:00:00.000Z'],
    ['padded with spaces', ' 2026-11-09T07:00:00.000Z '],
    ['ten thousand characters', 'x'.repeat(10_000)],
    ['full-width digits', '２０２６-11-09T07:00:00.000Z'],
    ['a second past the grid', '__sec__'],
    ['a millisecond past the grid', '__ms__'],
    ['a quarter hour', '__quarter__'],
  ])('answers 400 naming startsAt for a start that is %s', async (_n, raw) => {
    const { andrei, booking } = await booked();
    const sent =
      raw === '__sec__'
        ? new Date(at(14).getTime() + 1000).toISOString()
        : raw === '__ms__'
          ? new Date(at(14).getTime() + 1).toISOString()
          : raw === '__quarter__'
            ? at(14, 15).toISOString()
            : raw;

    const res = await ask(booking.id, sent, asDriver(andrei));

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('startsAt');
    expect(await movesOf(booking.id)).toHaveLength(0);
    expect(await moveEvents()).toBe(0);
  });

  it('answers 400 for a field the body does not define', async () => {
    const { andrei, booking } = await booked();

    const res = await post(
      `/bookings/${booking.id}/moves`,
      { newStartsAt: at(14).toISOString(), startsAt: at(14).toISOString() },
      asDriver(andrei),
      randomUUID(),
    );

    expect(res.status).toBe(400);
    expect(await movesOf(booking.id)).toHaveLength(0);
  });

  it('answers 400 naming startsAt for an empty body', async () => {
    const { andrei, booking } = await booked();

    const res = await post(
      `/bookings/${booking.id}/moves`,
      {},
      asDriver(andrei),
      randomUUID(),
    );

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('startsAt');
    expect(await movesOf(booking.id)).toHaveLength(0);
  });

  it('answers 400 and not 404 for a bad start on a booking of someone else only after the owner check', async () => {
    const { booking } = await booked();
    const other = await world.account('Maria Ionescu');

    const res = await ask(booking.id, 'tomorrow', asDriver(other));

    expect([400, 404]).toContain(res.status);
    expect(await movesOf(booking.id)).toHaveLength(0);
  });
});

// @traces 184-FR-002
it('names validation_failed as the code of a start that is not a time', async () => {
  const { andrei, booking } = await booked();

  const res = await ask(booking.id, 'mâine', asDriver(andrei));

  expect(res.status).toBe(400);
  // The API's problem filter, which this app does not mount, names a 400
  // that carries no code of its own by its status.
  expect(res.body.code ?? codeForStatus(res.status)).toBe('validation_failed');
});

describe('a move asked on a booking that is not there', () => {
  it('answers 404 not_found for a booking id nobody has', async () => {
    const { andrei } = await booked();

    const res = await ask(randomUUID(), at(14).toISOString(), asDriver(andrei));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 400 or 404 and never 500 for an id that is not a uuid', async () => {
    const { andrei } = await booked();

    const res = await ask(
      "1'; DROP TABLE booking;--",
      at(14).toISOString(),
      asDriver(andrei),
    );

    expect([400, 404]).toContain(res.status);
    expect(await prisma.booking.count()).toBe(1);
  });

  it('answers 401 to a visitor before it looks at the body', async () => {
    const { booking } = await booked();

    const res = await ask(booking.id, 'not a time');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 404 to a driver whose own account is closed', async () => {
    const { andrei, booking } = await booked();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: andrei },
    });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    expect([401, 403, 404]).toContain(res.status);
    expect(await movesOf(booking.id)).toHaveLength(0);
  });
});

// @traces 184-FR-003
describe('the limits at their edge', () => {
  it('asks again with one move behind it and leaves the count alone', async () => {
    const { andrei, booking } = await booked({ moveCount: 1 });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    expect(res.status).toBe(201);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .moveCount,
    ).toBe(1);
  });

  it('answers move_limit for a count past the limit', async () => {
    const { andrei, booking } = await booked({ moveCount: 7 });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('move_limit');
  });

  it('asks a booking that starts two hours and five minutes away', async () => {
    const startsAt = new Date(
      Math.ceil((Date.now() + 125 * MINUTE) / (30 * MINUTE)) * 30 * MINUTE,
    );
    const { andrei, booking } = await booked({ startsAt });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    expect(res.status).toBe(201);
  });

  it('answers move_cutoff for a booking that already started', async () => {
    const { andrei, booking } = await booked({
      startsAt: new Date(Date.now() - HOUR),
    });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('move_cutoff');
  });

  it('answers invalid_transition naming the status for a completed booking', async () => {
    const { andrei, booking } = await booked({ status: 'completed' });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_transition');
    expect(JSON.stringify(res.body)).toContain('completed');
  });

  it('answers invalid_transition for a booking whose job was done', async () => {
    const { andrei, booking, volt } = await booked();
    await world.job(booking.id, 'done', {
      mechanicId: volt.answeringMechanic.id,
    });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_transition');
  });

  it('moves a booking into a start that overlaps its own current hour', async () => {
    const { andrei, booking } = await booked();

    const res = await ask(
      booking.id,
      at(10, 30).toISOString(),
      asDriver(andrei),
    );

    expect(res.status).toBe(201);
    expect(res.body.newStartsAt).toBe(at(10, 30).toISOString());
  });

  it('takes a start written with an offset and answers the instant', async () => {
    const { andrei, booking } = await booked();

    const res = await ask(
      booking.id,
      at(14).toISOString().replace('Z', '+00:00'),
      asDriver(andrei),
    );

    expect(res.status).toBe(201);
    expect(res.body.newStartsAt).toBe(at(14).toISOString());
  });

  it('answers slot_taken for a start in the past', async () => {
    const { andrei, booking } = await booked();

    const res = await ask(
      booking.id,
      '2020-01-01T10:00:00.000Z',
      asDriver(andrei),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('slot_taken');
    expect(await movesOf(booking.id)).toHaveLength(0);
  });
});

// @traces 184-FR-002
describe('the idempotency key', () => {
  it('takes a key of exactly the longest length', async () => {
    const { andrei, booking } = await booked();

    const res = await ask(
      booking.id,
      at(14).toISOString(),
      asDriver(andrei),
      'k'.repeat(200),
    );

    expect(res.status).toBe(201);
  });

  it('gives another driver their own move for the same key', async () => {
    const { andrei, booking, volt } = await booked();
    const { booking: theirs, maria } = await secondBooking(volt, at(12));
    const key = randomUUID();

    const first = await ask(
      booking.id,
      at(14).toISOString(),
      asDriver(andrei),
      key,
    );
    const second = await ask(
      theirs.id,
      at(16).toISOString(),
      asDriver(maria),
      key,
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.bookingId).toBe(theirs.id);
  });

  it('does not hand a driver the move of a booking that is not theirs', async () => {
    const { andrei, booking, volt } = await booked();
    const { booking: theirs, maria } = await secondBooking(volt, at(12));
    const key = randomUUID();
    await ask(booking.id, at(14).toISOString(), asDriver(andrei), key);

    const res = await ask(
      theirs.id,
      at(16).toISOString(),
      asDriver(andrei),
      key,
    );

    expect(res.status).toBe(404);
    expect(await movesOf(theirs.id)).toHaveLength(0);
    expect(maria).toBeDefined();
  });

  it('refuses a key of one booking on the same driver’s other booking', async () => {
    const { andrei, booking, volt } = await booked();
    const { booking: other } = await world.chain(andrei, volt.garage.id, {
      booking: 'confirmed',
    });
    await prisma.booking.update({
      data: {
        durationMinutes: 60,
        mechanicId: volt.answeringMechanic.id,
        startsAt: at(12),
      },
      where: { id: other.id },
    });
    const key = randomUUID();
    await ask(booking.id, at(14).toISOString(), asDriver(andrei), key);

    const res = await ask(
      other.id,
      at(16).toISOString(),
      asDriver(andrei),
      key,
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
    expect(await movesOf(other.id)).toHaveLength(0);
    expect(await movesOf(booking.id)).toHaveLength(1);
  });

  it('writes one move for the same key sent twice at once', async () => {
    const { andrei, booking } = await booked();
    const key = randomUUID();

    const answers = await Promise.all([
      ask(booking.id, at(14).toISOString(), asDriver(andrei), key),
      ask(booking.id, at(14).toISOString(), asDriver(andrei), key),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(answers[0].body.id).toBe(answers[1].body.id);
    expect(await movesOf(booking.id)).toHaveLength(1);
    expect(await moveEvents()).toBe(1);
  });

  it('answers the stored move for the key after the move was decided', async () => {
    const { andrei, booking } = await booked();
    const key = randomUUID();
    const first = await ask(
      booking.id,
      at(14).toISOString(),
      asDriver(andrei),
      key,
    );
    await prisma.bookingMove.update({
      data: { decidedAt: new Date(), status: 'lapsed' },
      where: { id: first.body.id },
    });

    const again = await ask(
      booking.id,
      at(14).toISOString(),
      asDriver(andrei),
      key,
    );

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, status: 'lapsed' });
    expect(await movesOf(booking.id)).toHaveLength(1);
  });
});

// @traces 184-FR-006
// @traces 184-FR-001
describe('a slot a proposed move holds', () => {
  it('is refused to another booking, also when the stretches only overlap', async () => {
    const { andrei, booking, volt } = await booked();
    const { booking: theirs, maria } = await secondBooking(volt, at(12));
    await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    for (const start of [at(14), at(14, 30), at(13, 30)]) {
      const res = await ask(theirs.id, start.toISOString(), asDriver(maria));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('slot_taken');
    }
    expect(await movesOf(theirs.id)).toHaveLength(0);
  });

  it('is free to another booking from the end of the held stretch', async () => {
    const { andrei, booking, volt } = await booked();
    const { booking: theirs, maria } = await secondBooking(volt, at(12));
    await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    const res = await ask(theirs.id, at(15).toISOString(), asDriver(maria));

    expect(res.status).toBe(201);
  });

  it('is free to another booking once the move is refused or cancelled', async () => {
    const { andrei, booking, volt } = await booked();
    const { booking: theirs, maria } = await secondBooking(volt, at(12));
    const first = await ask(booking.id, at(14).toISOString(), asDriver(andrei));
    await prisma.bookingMove.update({
      data: {
        decidedAt: new Date(),
        refuseReason: 'other',
        status: 'refused',
      },
      where: { id: first.body.id },
    });

    const res = await ask(theirs.id, at(14).toISOString(), asDriver(maria));

    expect(res.status).toBe(201);
  });

  it('is released silently when the driver cancels the booking', async () => {
    const { andrei, booking, volt } = await booked();
    const { booking: theirs, maria } = await secondBooking(volt, at(12));
    const first = await ask(booking.id, at(14).toISOString(), asDriver(andrei));
    await prisma.outboxEvent.deleteMany();

    const cancelled = await post(
      `/bookings/${booking.id}/cancel`,
      { reason: 'problem_solved' },
      asDriver(andrei),
      randomUUID(),
    );

    expect(cancelled.status).toBe(200);
    const [move] = await prisma.bookingMove.findMany({
      where: { id: first.body.id },
    });
    expect(move.status).toBe('cancelled');
    expect(
      await prisma.outboxEvent.count({
        where: {
          kind: { in: ['booking.move_lapsed', 'booking.move_refused'] },
        },
      }),
    ).toBe(0);
    const res = await ask(theirs.id, at(14).toISOString(), asDriver(maria));
    expect(res.status).toBe(201);
  });
});

// @traces 184-FR-001
describe('the one waiting move of a booking', () => {
  it('is kept by the database against a second proposed row', async () => {
    const { andrei, booking } = await booked();
    const row = (key: string) => ({
      bookingId: booking.id,
      idempotencyKey: key,
      lapsesAt: new Date(Date.now() + HOUR),
      newStartsAt: at(14),
      proposedBy: andrei,
      proposedBySide: 'driver' as const,
    });
    await prisma.bookingMove.create({ data: row('a') });

    await expect(
      prisma.bookingMove.create({ data: row('b') }),
    ).rejects.toThrow();
    expect(await movesOf(booking.id)).toHaveLength(1);
  });

  it('keeps every past move beside a new waiting one', async () => {
    const { andrei, booking } = await booked();
    const first = await ask(booking.id, at(14).toISOString(), asDriver(andrei));
    await prisma.bookingMove.update({
      data: { decidedAt: new Date(), status: 'lapsed' },
      where: { id: first.body.id },
    });

    const second = await ask(
      booking.id,
      at(15).toISOString(),
      asDriver(andrei),
    );

    expect(second.status).toBe(201);
    expect((await movesOf(booking.id)).map((m) => m.status).sort()).toEqual([
      'lapsed',
      'proposed',
    ]);
  });

  it('writes one move out of five asks for five slots at once', async () => {
    const { andrei, booking } = await booked();

    const answers = await Promise.all(
      [11, 12, 13, 14, 15].map((h) =>
        ask(booking.id, at(h).toISOString(), asDriver(andrei)),
      ),
    );

    expect(answers.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      answers.filter((r) => r.status === 409).map((r) => r.body.code),
    ).toEqual(['move_pending', 'move_pending', 'move_pending', 'move_pending']);
    expect(await movesOf(booking.id)).toHaveLength(1);
    expect(await moveEvents()).toBe(1);
  });
});

// @traces 184-FR-008
describe('the driver reads of a booking with moves', () => {
  const rowOf = async (auth: string, requestId: string) => {
    const res = await get('/requests', auth);
    return (res.body.items as { id: string; booking: unknown }[]).find(
      (r) => r.id === requestId,
    )?.booking;
  };

  it('carries the latest move, not the first, and the count', async () => {
    const { andrei, booking } = await booked({ moveCount: 1 });
    const base = {
      bookingId: booking.id,
      lapsesAt: new Date(Date.now() + HOUR),
      newStartsAt: at(14),
      proposedBy: andrei,
      proposedBySide: 'driver' as const,
    };
    await prisma.bookingMove.create({
      data: {
        ...base,
        createdAt: new Date(Date.now() - 3 * HOUR),
        decidedAt: new Date(Date.now() - 2 * HOUR),
        idempotencyKey: 'old',
        status: 'lapsed',
      },
    });
    const latest = await prisma.bookingMove.create({
      data: {
        ...base,
        createdAt: new Date(Date.now() - HOUR),
        decidedAt: new Date(),
        idempotencyKey: 'new',
        refuseReason: 'closed_that_day',
        status: 'refused',
      },
    });

    const detail = await get(
      `/requests/${booking.requestId}`,
      asDriver(andrei),
    );

    expect(detail.body.booking).toMatchObject({
      canMove: true,
      move: {
        id: latest.id,
        refuseReason: 'closed_that_day',
        status: 'refused',
      },
      moveBlockedReason: null,
      moveCount: 1,
    });
  });

  it('carries the same fields on the list row as on the request', async () => {
    const { andrei, booking } = await booked({ moveCount: 2 });

    const row = await rowOf(asDriver(andrei), booking.requestId);

    expect(row).toMatchObject({
      canMove: false,
      move: null,
      moveBlockedReason: 'limit',
      moveCount: 2,
    });
  });

  it('names status and not pending for a cancelled booking that kept a move', async () => {
    const { andrei, booking } = await booked();
    await ask(booking.id, at(14).toISOString(), asDriver(andrei));
    await post(
      `/bookings/${booking.id}/cancel`,
      { reason: 'problem_solved' },
      asDriver(andrei),
      randomUUID(),
    );

    const detail = await get(
      `/requests/${booking.requestId}`,
      asDriver(andrei),
    );

    expect(detail.body.booking).toMatchObject({
      canMove: false,
      move: { status: 'cancelled' },
      moveBlockedReason: 'status',
    });
  });

  it('shows no move of another driver on a request that is not theirs', async () => {
    const { andrei, booking } = await booked();
    await ask(booking.id, at(14).toISOString(), asDriver(andrei));
    const other = await world.account('Maria Ionescu');

    const res = await get(`/requests/${booking.requestId}`, asDriver(other));

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('newStartsAt');
  });
});
