import { randomUUID } from 'node:crypto';

import type { BookingStatus, JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../quotes-api.testing';

const { bearer, post, team, world } = quotesApp();
const { prisma } = world;

const MINUTE = 60_000;

let since: Date;
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  [{ since }] = await prisma.$queryRaw<
    { since: Date }[]
  >`SELECT now() AS since`;
});

const asDriver = (id: string) => bearer(id, 'driver');
const cancel = (bookingId: string, body: unknown, auth?: string) =>
  post(`/bookings/${bookingId}/cancel`, body, auth);

// Andrei's booking at Volt Auto, starting `minutes` from now, with Fixer on
// it and, when asked, its job and Garaj Nordic's quote still waiting.
async function booked(
  options: {
    minutes?: number;
    status?: BookingStatus;
    job?: JobStatus;
    otherQuote?: boolean;
  } = {},
) {
  const andrei = await world.account('Andrei Ion Marin');
  const volt = await team('Volt Auto');
  const { booking, quote, request } = await world.chain(
    andrei,
    volt.garage.id,
    { booking: options.status ?? 'confirmed' },
  );
  await prisma.booking.update({
    data: {
      mechanicId: volt.answeringMechanic.id,
      startsAt: new Date(Date.now() + (options.minutes ?? 180) * MINUTE),
    },
    where: { id: booking.id },
  });
  const job = options.job
    ? await world.job(booking.id, options.job, {
        mechanicId: volt.answeringMechanic.id,
      })
    : null;
  let other = null;
  if (options.otherQuote) {
    const nordic = await team('Garaj Nordic');
    other = await world.quote(request.id, nordic.garage.id);
  }
  return { andrei, booking, job, other, quote, request, volt };
}

const bookingRow = (id: string) =>
  prisma.booking.findUniqueOrThrow({ where: { id } });
const requestRow = (id: string) =>
  prisma.quoteRequest.findUniqueOrThrow({ where: { id } });

// @traces 1258-driver-cancel-FR-002
// @traces 1258-driver-cancel-FR-004
// @traces 1258-driver-cancel-FR-012
describe('POST /bookings/:id/cancel', () => {
  it('cancels a confirmed booking three hours ahead as the driver’s, in good time', async () => {
    const { andrei, booking, quote, request } = await booked({ minutes: 180 });

    const res = await cancel(
      booking.id,
      { note: '  Am găsit un loc mai aproape  ', reason: 'plans_changed' },
      asDriver(andrei),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      cancelledBySide: 'driver',
      cancelNote: 'Am găsit un loc mai aproape',
      cancelReason: 'plans_changed',
      id: booking.id,
      lateCancellation: false,
      status: 'cancelled',
    });
    const row = await bookingRow(booking.id);
    expect(row).toMatchObject({
      cancelledBy: andrei,
      cancelledBySide: 'driver',
      cancelNote: 'Am găsit un loc mai aproape',
      cancelReason: 'plans_changed',
      lateCancellation: false,
      status: 'cancelled',
    });
    expect(row.cancelledAt).toBeInstanceOf(Date);
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('lost');
    expect(await requestRow(request.id)).toMatchObject({
      closedReason: 'booking_cancelled',
      status: 'closed',
    });
  });

  it('records a cancel an hour and a half ahead as late, with no penalty', async () => {
    const { andrei, booking } = await booked({ minutes: 90 });

    const res = await cancel(
      booking.id,
      { reason: 'problem_solved' },
      asDriver(andrei),
    );

    expect(res.status).toBe(200);
    expect(res.body.lateCancellation).toBe(true);
    expect(res.body.cancelNote).toBeNull();
    expect((await bookingRow(booking.id)).lateCancellation).toBe(true);
  });

  it('files the moves and the reason, and writes one event naming no note', async () => {
    const { andrei, booking, request, volt } = await booked({ minutes: 90 });

    await cancel(
      booking.id,
      { note: 'Nu mai am nevoie', reason: 'other' },
      asDriver(andrei),
    );

    const filed = await prisma.activityLog.findMany({
      where: { at: { gte: since }, subjectId: booking.id },
    });
    expect(filed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: andrei,
          field: 'status',
          newValue: 'cancelled',
          oldValue: 'confirmed',
        }),
        expect.objectContaining({
          field: 'cancel_reason',
          newValue: 'other',
        }),
      ]),
    );
    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'booking.cancelled',
      subjectId: booking.id,
    });
    expect(events[0].payload).toEqual({
      bookingId: booking.id,
      garageId: volt.garage.id,
      late: true,
      reason: 'other',
      requestId: request.id,
      side: 'driver',
    });
    expect([...events[0].audience].sort()).toEqual(
      [
        `account:${andrei}`,
        `garage:${volt.garage.id}`,
        `mechanic:${volt.answeringMechanic.id}`,
      ].sort(),
    );
  });

  it('cancels the booking’s job that is still to do', async () => {
    const { andrei, booking, job } = await booked({ job: 'to_do' });

    const res = await cancel(
      booking.id,
      { reason: 'found_another_garage' },
      asDriver(andrei),
    );

    expect(res.status).toBe(200);
    expect(
      (await prisma.job.findUniqueOrThrow({ where: { id: job?.id } })).status,
    ).toBe('cancelled');
  });

  it('takes a note of 500 characters once trimmed, and an empty note as none', async () => {
    const first = await booked();
    const long = 'a'.repeat(500);

    const res = await cancel(
      first.booking.id,
      { note: `  ${long}  `, reason: 'other' },
      asDriver(first.andrei),
    );
    expect(res.status).toBe(200);
    expect(res.body.cancelNote).toBe(long);

    await world.reset();
    const second = await booked();
    const blank = await cancel(
      second.booking.id,
      { note: '   ', reason: 'other' },
      asDriver(second.andrei),
    );
    expect(blank.status).toBe(200);
    expect((await bookingRow(second.booking.id)).cancelNote).toBeNull();
  });
});

// @traces 1258-driver-cancel-FR-004
describe('POST /bookings/:id/cancel of a booking awaiting confirmation', () => {
  it('sends the request back to quoted when another quote still waits', async () => {
    const { andrei, booking, other, quote, request } = await booked({
      otherQuote: true,
      status: 'awaiting_confirmation',
    });

    const res = await cancel(
      booking.id,
      { reason: 'plans_changed' },
      asDriver(andrei),
    );

    expect(res.status).toBe(200);
    expect((await bookingRow(booking.id)).status).toBe('cancelled');
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('lost');
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: other?.id } }))
        .status,
    ).toBe('waiting');
    expect(await requestRow(request.id)).toMatchObject({
      closedReason: null,
      status: 'quoted',
    });
  });

  it('closes the request as booking_cancelled when no other quote waits', async () => {
    const { andrei, booking, request } = await booked({
      status: 'awaiting_confirmation',
    });

    expect(
      (await cancel(booking.id, { reason: 'other' }, asDriver(andrei))).status,
    ).toBe(200);

    expect(await requestRow(request.id)).toMatchObject({
      closedReason: 'booking_cancelled',
      status: 'closed',
    });
  });

  it('sends a confirmed booking’s request back to quoted too when another quote waits', async () => {
    const { andrei, booking, request } = await booked({ otherQuote: true });

    await cancel(booking.id, { reason: 'other' }, asDriver(andrei));

    expect((await requestRow(request.id)).status).toBe('quoted');
  });
});

// @traces 1258-driver-cancel-FR-002
describe('POST /bookings/:id/cancel with a bad body or caller', () => {
  it.each([
    [{ reason: 'no_mechanic_free' }, 'reason'],
    [{ reason: 'driver_account_closed' }, 'reason'],
    [{}, 'reason'],
    [{ note: 'a'.repeat(501), reason: 'other' }, 'note'],
  ])(
    'answers 400 to %j, naming the field, changing nothing',
    async (body, field) => {
      const { andrei, booking } = await booked();

      const res = await cancel(booking.id, body, asDriver(andrei));

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain(field);
      expect((await bookingRow(booking.id)).status).toBe('confirmed');
      expect(await prisma.outboxEvent.count()).toBe(0);
    },
  );

  it('answers 404 to another driver, to a missing booking and to the garage', async () => {
    const { booking, volt } = await booked();
    const vlad = await world.account('Vlad Popescu');
    const body = { reason: 'other' };

    expect((await cancel(booking.id, body, asDriver(vlad))).status).toBe(404);
    expect((await cancel(randomUUID(), body, asDriver(vlad))).status).toBe(404);
    expect(
      (await cancel(booking.id, body, bearer(volt.owner, 'garage'))).status,
    ).toBe(404);
    expect((await bookingRow(booking.id)).status).toBe('confirmed');
  });

  it('answers 401 without a session', async () => {
    const { booking } = await booked();

    const res = await cancel(booking.id, { reason: 'other' });

    expect(res.status).toBe(401);
  });
});

// @traces 1258-driver-cancel-FR-003
describe('POST /bookings/:id/cancel refused', () => {
  const unchanged = async (bookingId: string, status: BookingStatus) => {
    expect((await bookingRow(bookingId)).status).toBe(status);
    expect(await prisma.outboxEvent.count()).toBe(0);
  };

  it.each(['confirmed', 'awaiting_confirmation'] as const)(
    'answers 409 to a %s booking whose time has passed',
    async (status) => {
      const { andrei, booking, quote } = await booked({ minutes: -30, status });

      const res = await cancel(
        booking.id,
        { reason: 'other' },
        asDriver(andrei),
      );

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: status,
        to: 'cancelled',
      });
      await unchanged(booking.id, status);
      expect(
        (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
          .status,
      ).toBe('accepted');
    },
  );

  it.each(['in_work', 'paused', 'done'] as const)(
    'answers 409 when the job is %s, leaving the job as it was',
    async (jobStatus) => {
      const { andrei, booking, job } = await booked({ job: jobStatus });

      const res = await cancel(
        booking.id,
        { reason: 'other' },
        asDriver(andrei),
      );

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: 'confirmed',
      });
      await unchanged(booking.id, 'confirmed');
      expect(
        (await prisma.job.findUniqueOrThrow({ where: { id: job?.id } })).status,
      ).toBe(jobStatus);
    },
  );

  it.each(['cancelled', 'completed'] as const)(
    'answers 409 to a %s booking',
    async (status) => {
      const { andrei, booking } = await booked({ status });

      const res = await cancel(
        booking.id,
        { reason: 'other' },
        asDriver(andrei),
      );

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: status,
      });
      await unchanged(booking.id, status);
    },
  );
});
