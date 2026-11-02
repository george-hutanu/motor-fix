import { randomUUID } from 'node:crypto';

import { MovesService } from './moves.service';
import { AuditService } from '../../audit/audit.service';
import { addDays, atLocal, localDay } from '../../bucharest';
import { outbox } from '../../events/event.port';
import type { BookingStatus, JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../quotes-api.testing';

const { bearer, get, post, team, world } = quotesApp();
const { prisma } = world;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const HALF = 30 * MINUTE;
const WEEK = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
    day,
    [['08:00', '20:00']],
  ]),
);

// Three days out or later, on a weekday no public holiday closes.
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

let since: Date;
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  [{ since }] = await prisma.$queryRaw<
    { since: Date }[]
  >`SELECT now() AS since`;
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

// Andrei's confirmed hour at Volt Auto, open 08:00 to 20:00 every day with
// Fixer the only mechanic, on DAY at 10:00 unless `startsAt` says otherwise.
async function booked(
  options: {
    startsAt?: Date;
    status?: BookingStatus;
    job?: JobStatus;
    received?: boolean;
    moveCount?: number;
  } = {},
) {
  const andrei = await world.account('Andrei Ion Marin');
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
  if (options.job) {
    const job = await world.job(booking.id, options.job, {
      mechanicId: volt.answeringMechanic.id,
    });
    if (options.received) {
      await prisma.job.update({
        data: { receivedAt: new Date() },
        where: { id: job.id },
      });
    }
  }
  return { andrei, booking: row, volt };
}

const movesOf = (bookingId: string) =>
  prisma.bookingMove.findMany({ where: { bookingId } });
const bookingRow = (id: string) =>
  prisma.booking.findUniqueOrThrow({ where: { id } });

// @traces 184-FR-002
// @traces 184-FR-005
// @traces 184-FR-015
// @traces 184-FR-013
describe('POST /bookings/:id/moves', () => {
  it('asks the garage for a free start, holding the booking as it is', async () => {
    const { andrei, booking, volt } = await booked();
    const before = Date.now();

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      bookingId: booking.id,
      decidedAt: null,
      newStartsAt: at(14).toISOString(),
      proposedBySide: 'driver',
      refuseReason: null,
      status: 'proposed',
    });
    const [move] = await movesOf(booking.id);
    expect(move).toMatchObject({
      id: res.body.id,
      proposedBy: andrei,
      proposedBySide: 'driver',
      status: 'proposed',
    });
    const lapse = move.lapsesAt.getTime() - (before + 24 * HOUR);
    expect(lapse).toBeGreaterThanOrEqual(0);
    expect(lapse).toBeLessThan(MINUTE);
    expect(await bookingRow(booking.id)).toMatchObject({
      moveCount: 0,
      startsAt: at(10),
      status: 'confirmed',
    });

    const [entry] = await prisma.activityLog.findMany({
      where: { at: { gte: since }, field: 'move', subjectId: booking.id },
    });
    expect(entry).toMatchObject({
      actorId: andrei,
      isKeyChange: true,
      newValue: at(14).toISOString(),
      oldValue: at(10).toISOString(),
      subjectType: 'booking',
    });

    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'booking.move_proposed' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      bookingId: booking.id,
      by: 'driver',
      moveId: move.id,
      newStartsAt: at(14).toISOString(),
    });
    expect([...events[0].audience].sort()).toEqual(
      [`account:${andrei}`, `garage:${volt.garage.id}`].sort(),
    );
  });

  it('answers the stored move for the same key, writing one', async () => {
    const { andrei, booking } = await booked();
    const key = randomUUID();

    const first = await ask(
      booking.id,
      at(14).toISOString(),
      asDriver(andrei),
      key,
    );
    const again = await ask(
      booking.id,
      at(15).toISOString(),
      asDriver(andrei),
      key,
    );

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.newStartsAt).toBe(at(14).toISOString());
    expect(await movesOf(booking.id)).toHaveLength(1);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['too long', 'k'.repeat(201)],
  ])('refuses a %s key', async (_name, key) => {
    const { andrei, booking } = await booked();

    const call = post(
      `/bookings/${booking.id}/moves`,
      { startsAt: at(14).toISOString() },
      asDriver(andrei),
      key ?? undefined,
    );
    const res = await call;

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [expect.objectContaining({ field: 'idempotency-key' })],
    });
    expect(await movesOf(booking.id)).toHaveLength(0);
  });

  it.each([
    ['not a time', 'mâine dimineață'],
    ['a number', 42],
    ['missing', undefined],
    ['off the half-hour grid', '__offgrid__'],
  ])('refuses a start that is %s', async (_name, startsAt) => {
    const { andrei, booking } = await booked();

    const sent =
      startsAt === '__offgrid__' ? at(14, 10).toISOString() : startsAt;
    const res = await ask(booking.id, sent, asDriver(andrei));

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('startsAt');
    expect(await movesOf(booking.id)).toHaveLength(0);
  });

  it('shows the asked move on the driver’s request', async () => {
    const { andrei, booking } = await booked();
    await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    const res = await get(`/requests/${booking.requestId}`, asDriver(andrei));

    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({
      canMove: false,
      move: { newStartsAt: at(14).toISOString(), status: 'proposed' },
      moveBlockedReason: 'pending',
      moveCount: 0,
    });
  });
});

// @traces 184-FR-002
// @traces 184-FR-003
describe('a move the rules refuse', () => {
  const refused = async (
    res: { status: number; body: { code: string } },
    bookingId: string,
    code: string,
  ) => {
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(code);
    expect(await movesOf(bookingId)).toHaveLength(0);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'booking.move_proposed' },
      }),
    ).toBe(0);
  };

  it.each([
    ['awaiting confirmation', { status: 'awaiting_confirmation' as const }],
    ['cancelled', { status: 'cancelled' as const }],
    ['with its job started', { job: 'in_work' as const }],
    ['with its car received', { job: 'to_do' as const, received: true }],
  ])('answers invalid_transition for a booking %s', async (_name, options) => {
    const { andrei, booking } = await booked(options);

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    await refused(res, booking.id, 'invalid_transition');
  });

  it('answers move_cutoff an hour and 59 minutes before the start', async () => {
    const startsAt = new Date(Date.now() + 119 * MINUTE);
    const { andrei, booking } = await booked({ startsAt });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    await refused(res, booking.id, 'move_cutoff');
  });

  it('answers move_limit after two moves', async () => {
    const { andrei, booking } = await booked({ moveCount: 2 });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    await refused(res, booking.id, 'move_limit');
  });

  it.each(['driver', 'garage'] as const)(
    'answers move_pending while a %s move waits',
    async (side) => {
      const { andrei, booking, volt } = await booked();
      await prisma.bookingMove.create({
        data: {
          bookingId: booking.id,
          idempotencyKey: 'earlier',
          lapsesAt: new Date(Date.now() + HOUR),
          newStartsAt: at(16),
          proposedBy: side === 'driver' ? andrei : volt.owner,
          proposedBySide: side,
        },
      });

      const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('move_pending');
      expect(await movesOf(booking.id)).toHaveLength(1);
    },
  );

  it('names the first rule broken', async () => {
    const startsAt = new Date(Date.now() + 60 * MINUTE);
    const { andrei, booking } = await booked({ moveCount: 2, startsAt });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    await refused(res, booking.id, 'move_cutoff');
  });

  it('answers 404 for another driver, a garage account and an admin', async () => {
    const { booking, volt } = await booked();
    const other = await world.account('Maria Ionescu');
    const admin = await world.account('Admin', ['admin']);

    for (const auth of [
      asDriver(other),
      bearer(volt.owner, 'garage'),
      bearer(admin, 'admin'),
    ]) {
      const res = await ask(booking.id, at(14).toISOString(), auth);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
    expect(await movesOf(booking.id)).toHaveLength(0);
  });

  it('answers 401 to a visitor', async () => {
    const { booking } = await booked();

    const res = await ask(booking.id, at(14).toISOString());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });
});

// @traces 184-FR-003
// @traces 184-FR-006
describe('a start the free slots do not offer', () => {
  it.each([
    [
      'earlier than two hours from now',
      () => new Date(Math.ceil((Date.now() + 90 * MINUTE) / HALF) * HALF),
    ],
    [
      'beyond fourteen days',
      () => atLocal(addDays(localDay(new Date()), 15), 10),
    ],
    ['outside the opening hours', () => at(21)],
  ])('answers slot_taken for a start %s', async (_name, start) => {
    const { andrei, booking } = await booked();

    const res = await ask(booking.id, start().toISOString(), asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('slot_taken');
    expect(await movesOf(booking.id)).toHaveLength(0);
  });

  it('answers slot_taken when another booking holds the mechanic then', async () => {
    const { andrei, booking, volt } = await booked();
    const { booking: other } = await world.chain(
      await world.account('Maria Ionescu'),
      volt.garage.id,
      { booking: 'confirmed' },
    );
    await prisma.bookingSegment.create({
      data: {
        bookingId: other.id,
        endsAt: at(15),
        garageId: volt.garage.id,
        mechanicId: volt.answeringMechanic.id,
        startsAt: at(14),
      },
    });

    const res = await ask(booking.id, at(14).toISOString(), asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('slot_taken');
  });

  it('writes one move for two asks on one booking at once', async () => {
    const { andrei, booking } = await booked();

    const answers = await Promise.all([
      ask(booking.id, at(14).toISOString(), asDriver(andrei)),
      ask(booking.id, at(15).toISOString(), asDriver(andrei)),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await movesOf(booking.id)).toHaveLength(1);
  });

  it('writes one move for two bookings asking one slot at once', async () => {
    const { andrei, booking, volt } = await booked();
    const maria = await world.account('Maria Ionescu');
    const { booking: second } = await world.chain(maria, volt.garage.id, {
      booking: 'confirmed',
    });
    await prisma.booking.update({
      data: { durationMinutes: 60, startsAt: at(11) },
      where: { id: second.id },
    });

    const answers = await Promise.all([
      ask(booking.id, at(14).toISOString(), asDriver(andrei)),
      ask(second.id, at(14).toISOString(), asDriver(maria)),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.bookingMove.count()).toBe(1);
  });
});

// The assistant's move runs the same ask inside the approval's transaction,
// keyed by the approval, once the driver approves in the app.
// @traces 184-FR-012
describe("the assistant's approved move", () => {
  const moves = new MovesService(prisma, new AuditService(), outbox);

  async function viaAssistant(andrei: string) {
    const grant = await prisma.assistantGrant.create({
      data: {
        accountId: andrei,
        canAct: true,
        canRead: true,
        clientId: 'claude',
        clientName: 'Claude',
      },
    });
    return {
      accountId: andrei,
      assistantGrantId: grant.id,
      garageId: null,
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      requestId: 'api-request-1',
      role: 'driver' as const,
      roles: ['driver' as const],
      via: 'assistant' as const,
    };
  }

  it('writes the move at approval, recorded as the assistant acting for the driver', async () => {
    const { andrei, booking } = await booked();
    const actor = await viaAssistant(andrei);
    const approvalId = randomUUID();

    await prisma.$transaction((tx) =>
      moves.ask(
        tx,
        actor,
        booking.id,
        { startsAt: at(14).toISOString() },
        approvalId,
      ),
    );

    const [move] = await movesOf(booking.id);
    expect(move).toMatchObject({
      idempotencyKey: approvalId,
      newStartsAt: at(14),
      proposedBy: andrei,
      status: 'proposed',
    });
    const [entry] = await prisma.activityLog.findMany({
      where: { at: { gte: since }, field: 'move', subjectId: booking.id },
    });
    expect(entry).toMatchObject({
      actorId: andrei,
      assistantGrantId: actor.assistantGrantId,
      requestId: 'api-request-1',
    });
  });

  it('refuses with the check that now fails and writes nothing', async () => {
    const { andrei, booking } = await booked({ moveCount: 2 });
    const actor = await viaAssistant(andrei);

    await expect(
      prisma.$transaction((tx) =>
        moves.ask(
          tx,
          actor,
          booking.id,
          { startsAt: at(14).toISOString() },
          randomUUID(),
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'move_limit' } });

    expect(await movesOf(booking.id)).toEqual([]);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'booking.move_proposed' },
      }),
    ).toBe(0);
  });
});
