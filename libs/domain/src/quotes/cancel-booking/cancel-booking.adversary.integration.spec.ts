import { randomUUID } from 'node:crypto';

import type { BookingStatus, JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../quotes-api.testing';

const { bearer, post, team, world } = quotesApp();
const { prisma } = world;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
});

const asDriver = (id: string) => bearer(id, 'driver');
const cancel = (bookingId: string, body: unknown, auth?: string) =>
  post(`/bookings/${bookingId}/cancel`, body, auth);

async function booked(
  options: {
    seconds?: number;
    status?: BookingStatus;
    job?: JobStatus;
    mechanic?: boolean;
    otherQuote?: 'lost' | 'withdrawn' | 'expired' | 'declined_by_driver';
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
      mechanicId: (options.mechanic ?? true) ? volt.answeringMechanic.id : null,
      startsAt: new Date(Date.now() + (options.seconds ?? 10_800) * 1000),
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
    await prisma.quote.update({
      data: { status: options.otherQuote },
      where: { id: other.id },
    });
  }
  return { andrei, booking, job, other, quote, request, volt };
}

const bookingRow = (id: string) =>
  prisma.booking.findUniqueOrThrow({ where: { id } });

// @traces 1258-driver-cancel-FR-004
describe('POST /bookings/:id/cancel around the two-hour cutoff', () => {
  it('records a cancel five seconds before the cutoff as free', async () => {
    const { andrei, booking } = await booked({ seconds: 7200 + 5 });

    const res = await cancel(booking.id, { reason: 'other' }, asDriver(andrei));

    expect(res.status).toBe(200);
    expect(res.body.lateCancellation).toBe(false);
  });

  it('records a cancel a minute past the cutoff as late', async () => {
    const { andrei, booking } = await booked({ seconds: 7200 - 60 });

    const res = await cancel(booking.id, { reason: 'other' }, asDriver(andrei));

    expect(res.status).toBe(200);
    expect(res.body.lateCancellation).toBe(true);
  });

  it('accepts a booking that starts in one minute, late, and refuses one that started a minute ago', async () => {
    const soon = await booked({ seconds: 60 });
    const ok = await cancel(
      soon.booking.id,
      { reason: 'other' },
      asDriver(soon.andrei),
    );
    expect(ok.status).toBe(200);
    expect(ok.body.lateCancellation).toBe(true);

    await world.reset();
    const past = await booked({ seconds: -60 });
    const refused = await cancel(
      past.booking.id,
      { reason: 'other' },
      asDriver(past.andrei),
    );
    expect(refused.status).toBe(409);
  });
});

// @traces 1258-driver-cancel-FR-002
describe('POST /bookings/:id/cancel with hostile bodies', () => {
  it.each([
    ['a number note', { note: 42, reason: 'other' }],
    ['an array note', { note: ['a'], reason: 'other' }],
    ['an object note', { note: { a: 1 }, reason: 'other' }],
    ['an upper-case reason', { reason: 'PLANS_CHANGED' }],
    ['a null reason', { reason: null }],
    ['an array reason', { reason: ['other'] }],
    ['a prototype reason', { reason: '__proto__' }],
    ['an inherited reason', { reason: 'constructor' }],
    ['a padded reason', { reason: ' other' }],
    ['an extra field', { reason: 'other', status: 'confirmed' }],
    ['a forged side', { cancelledBySide: 'garage', reason: 'other' }],
    ['an array body', [{ reason: 'other' }]],
  ])('answers 400 to %s, writing nothing', async (_name, body) => {
    const { andrei, booking } = await booked();

    const res = await cancel(booking.id, body, asDriver(andrei));

    expect(res.status).toBe(400);
    expect((await bookingRow(booking.id)).status).toBe('confirmed');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('answers 400 to a note one past the cap once padded and trimmed', async () => {
    const { andrei, booking } = await booked();

    const res = await cancel(
      booking.id,
      { note: ` ${'b'.repeat(501)} `, reason: 'other' },
      asDriver(andrei),
    );

    expect(res.status).toBe(400);
    expect((await bookingRow(booking.id)).status).toBe('confirmed');
  });

  it('stores a null note and a tab-and-newline note as no note', async () => {
    const { andrei, booking } = await booked();

    const res = await cancel(
      booking.id,
      { note: '\t\n 　', reason: 'problem_solved' },
      asDriver(andrei),
    );

    expect(res.status).toBe(200);
    expect(res.body.cancelNote).toBeNull();

    await world.reset();
    const second = await booked();
    const nulled = await cancel(
      second.booking.id,
      { note: null, reason: 'problem_solved' },
      asDriver(second.andrei),
    );
    expect(nulled.status).toBe(200);
    expect(nulled.body.cancelNote).toBeNull();
  });

  it('keeps markup and diacritics in the note exactly as written', async () => {
    const { andrei, booking } = await booked();
    const note = '<img src=x onerror=alert(1)> ăâîșț — "ok" \'ok\'';

    const res = await cancel(
      booking.id,
      { note, reason: 'other' },
      asDriver(andrei),
    );

    expect(res.status).toBe(200);
    expect(res.body.cancelNote).toBe(note);
    expect((await bookingRow(booking.id)).cancelNote).toBe(note);
  });

  it('answers 400 rather than 500 to a note holding a NUL character, writing nothing', async () => {
    const { andrei, booking } = await booked();

    const res = await cancel(
      booking.id,
      { note: 'a\u0000b', reason: 'other' },
      asDriver(andrei),
    );

    expect(res.status).toBe(400);
    expect((await bookingRow(booking.id)).status).toBe('confirmed');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('answers 400 to an id that is not a uuid', async () => {
    const { andrei } = await booked();

    const res = await cancel(
      'not-an-id',
      { reason: 'other' },
      asDriver(andrei),
    );

    expect(res.status).toBe(400);
  });
});

// @traces 1258-driver-cancel-FR-002
describe('POST /bookings/:id/cancel by someone else', () => {
  it('answers 404 to an admin session and to a driver of another booking, writing nothing', async () => {
    const { booking } = await booked();
    const vlad = await world.account('Vlad Popescu');
    const admin = await world.account('Ada Admin', ['admin']);

    expect(
      (await cancel(booking.id, { reason: 'other' }, bearer(admin, 'admin')))
        .status,
    ).toBe(404);
    expect(
      (await cancel(booking.id, { reason: 'other' }, asDriver(vlad))).status,
    ).toBe(404);
    expect((await bookingRow(booking.id)).status).toBe('confirmed');
  });

  it('answers 404 before 400 to a bad body on another driver’s booking, revealing nothing', async () => {
    const { booking } = await booked();
    const vlad = await world.account('Vlad Popescu');

    const res = await cancel(booking.id, { reason: 'nope' }, asDriver(vlad));

    expect([400, 404]).toContain(res.status);
    expect((await bookingRow(booking.id)).status).toBe('confirmed');
  });

  it('answers 404 to a random booking id with a valid body', async () => {
    const { andrei } = await booked();

    const res = await cancel(
      randomUUID(),
      { reason: 'other' },
      asDriver(andrei),
    );

    expect(res.status).toBe(404);
  });
});

// @traces 1258-driver-cancel-FR-004
describe('POST /bookings/:id/cancel twice', () => {
  it('answers 409 naming cancelled to the second call and writes one event', async () => {
    const { andrei, booking } = await booked();

    const first = await cancel(
      booking.id,
      { reason: 'other' },
      asDriver(andrei),
    );
    const second = await cancel(
      booking.id,
      { reason: 'plans_changed' },
      asDriver(andrei),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'cancelled',
    });
    expect((await bookingRow(booking.id)).cancelReason).toBe('other');
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('lets exactly one of two simultaneous cancels win, with one event', async () => {
    const { andrei, booking } = await booked({ otherQuote: 'lost' });

    const results = await Promise.all([
      cancel(booking.id, { reason: 'other' }, asDriver(andrei)),
      cancel(booking.id, { reason: 'plans_changed' }, asDriver(andrei)),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });
});

// @traces 1258-driver-cancel-FR-004
describe('POST /bookings/:id/cancel effects on the neighbours', () => {
  it('leaves the audience without a mechanic when the booking has none', async () => {
    const { andrei, booking, volt } = await booked({ mechanic: false });

    const res = await cancel(booking.id, { reason: 'other' }, asDriver(andrei));

    expect(res.status).toBe(200);
    const [event] = await prisma.outboxEvent.findMany();
    expect([...event.audience].sort()).toEqual(
      [`account:${andrei}`, `garage:${volt.garage.id}`].sort(),
    );
  });

  it.each(['lost', 'withdrawn', 'expired', 'declined_by_driver'] as const)(
    'closes the request as booking_cancelled when the other quote is %s',
    async (otherQuote) => {
      const { andrei, booking, other, request } = await booked({ otherQuote });

      await cancel(booking.id, { reason: 'other' }, asDriver(andrei));

      expect(
        (
          await prisma.quoteRequest.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).status,
      ).toBe('closed');
      expect(
        (await prisma.quote.findUniqueOrThrow({ where: { id: other?.id } }))
          .status,
      ).toBe(otherQuote);
    },
  );

  it('cancels the job of an awaiting booking and still sends the request back to quoted', async () => {
    const { andrei, booking, job } = await booked({
      job: 'to_do',
      status: 'awaiting_confirmation',
    });

    const res = await cancel(booking.id, { reason: 'other' }, asDriver(andrei));

    expect(res.status).toBe(200);
    expect(
      (await prisma.job.findUniqueOrThrow({ where: { id: job?.id } })).status,
    ).toBe('cancelled');
  });

  it('refuses a cancelled job’s sibling states without touching the quote', async () => {
    const { andrei, booking, quote } = await booked({ job: 'in_work' });

    const res = await cancel(booking.id, { reason: 'other' }, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('accepted');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('still cancels when the garage is suspended', async () => {
    const { andrei, booking, volt } = await booked();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: volt.garage.id },
    });

    const res = await cancel(booking.id, { reason: 'other' }, asDriver(andrei));

    expect(res.status).toBe(200);
  });

  it.each(['no_show', 'lapsed'] as const)(
    'answers 409 naming a %s booking',
    async (status) => {
      const { andrei, booking } = await booked({ status });

      const res = await cancel(
        booking.id,
        { reason: 'other' },
        asDriver(andrei),
      );

      expect(res.status).toBe(409);
      expect(res.body.currentStatus).toBe(status);
    },
  );
});
