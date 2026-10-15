import { randomUUID } from 'node:crypto';

import { quotesApp } from '../quotes-api.testing';
import { BOOKING_CONFIRM_LAPSE_HOURS } from '../quotes-config';

const { bearer, post, send, team, world } = quotesApp();
const { prisma } = world;

const HOUR = 3_600_000;

async function quoted() {
  const andrei = await world.account('Andrei Ion Marin');
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const request = await world.request(andrei, { status: 'quoted' });
  const quote = await world.quote(request.id, dinamo.garage.id);
  const other = await world.quote(request.id, militari.garage.id);
  return { andrei, dinamo, militari, other, quote, request };
}

const asDriver = (id: string) => bearer(id, 'driver');
const accept = (
  quoteId: string,
  auth: string | undefined,
  key: string | undefined = randomUUID(),
  body: unknown = {},
) => post(`/quotes/${quoteId}/accept`, body, auth, key);
const bookings = () => prisma.booking.count();

// @traces 222-FR-001
describe('POST /quotes/:id/accept with a bad id, key or body', () => {
  it('answers 400 validation_failed for an id that is not a uuid, writing nothing', async () => {
    const { andrei } = await quoted();

    const res = await accept('not-a-uuid', asDriver(andrei));

    expect(res.status).toBe(400);
    expect(await bookings()).toBe(0);
  });

  it('answers 400 naming the key when the header is missing', async () => {
    const { andrei, quote } = await quoted();

    const res = await post(
      `/quotes/${quote.id}/accept`,
      {},
      asDriver(andrei),
      undefined,
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(await bookings()).toBe(0);
  });

  it('answers 400 for an empty key', async () => {
    const { andrei, quote } = await quoted();

    const res = await accept(quote.id, asDriver(andrei), '');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(await bookings()).toBe(0);
  });

  it('takes a key of exactly 200 characters and refuses 201', async () => {
    const { andrei, quote } = await quoted();

    const long = await accept(quote.id, asDriver(andrei), 'k'.repeat(201));
    expect(long.status).toBe(400);
    expect(long.body.code).toBe('validation_failed');
    expect(await bookings()).toBe(0);

    const edge = await accept(quote.id, asDriver(andrei), 'k'.repeat(200));
    expect(edge.status).toBe(201);
    expect(await bookings()).toBe(1);
  });

  it.each([
    [{ historyShared: 'yes' }],
    [{ historyShared: 1 }],
    [{ historyShared: null }],
    [{ extra: true }],
    [{ bookingId: randomUUID(), historyShared: true }],
  ])(
    'answers 400 validation_failed for the body %j, writing nothing',
    async (body) => {
      const { andrei, quote } = await quoted();

      const res = await accept(quote.id, asDriver(andrei), undefined, body);

      expect(res.status).toBe(400);
      expect(await bookings()).toBe(0);
      expect(
        (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
          .status,
      ).toBe('waiting');
    },
  );

  it('refuses a JSON array as the body, writing nothing', async () => {
    const { andrei, quote } = await quoted();

    const res = await accept(quote.id, asDriver(andrei), undefined, [true]);

    expect(res.status).toBe(400);
    expect(await bookings()).toBe(0);
  });

  it('refuses a body that is not JSON with a client error, writing nothing', async () => {
    const { andrei, quote } = await quoted();

    const res = await send(
      'post',
      `/quotes/${quote.id}/accept`,
      asDriver(andrei),
      undefined,
      { 'Content-Type': 'text/plain', 'Idempotency-Key': randomUUID() },
    ).send('historyShared=true');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await bookings()).toBe(0);
  });

  it('keeps the key free after a refusal for a bad body', async () => {
    const { andrei, quote } = await quoted();
    const key = randomUUID();

    const bad = await accept(quote.id, asDriver(andrei), key, {
      historyShared: 'x',
    });
    const good = await accept(quote.id, asDriver(andrei), key);

    expect(bad.status).toBe(400);
    expect(good.status).toBe(201);
  });
});

// @traces 222-FR-001
describe('POST /quotes/:id/accept for the wrong caller', () => {
  it('answers 401 sign_in_required to a visitor, writing nothing', async () => {
    const { quote } = await quoted();

    const res = await accept(quote.id, undefined);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
    expect(await bookings()).toBe(0);
  });

  it('answers 401 to a forged bearer', async () => {
    const { quote } = await quoted();

    const res = await accept(quote.id, 'Bearer not.a.token');

    expect(res.status).toBe(401);
    expect(await bookings()).toBe(0);
  });

  it('answers a not-found problem for an unknown quote id', async () => {
    const { andrei } = await quoted();

    const res = await accept(randomUUID(), asDriver(andrei));

    expect(res.status).toBe(404);
    expect(await bookings()).toBe(0);
  });

  it('answers 404 to another driver and leaves the quote waiting', async () => {
    const { quote } = await quoted();
    const stranger = await world.account('Mihai Stranger');

    const res = await accept(quote.id, asDriver(stranger));

    expect(res.status).toBe(404);
    expect(await bookings()).toBe(0);
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('waiting');
  });

  it('refuses the quoting garage owner, mechanic and receptionist, writing nothing', async () => {
    const { dinamo, quote } = await quoted();
    const callers: [string, 'garage' | 'mechanic' | 'receptionist'][] = [
      [dinamo.owner, 'garage'],
      [dinamo.answering, 'mechanic'],
      [dinamo.receptionist, 'receptionist'],
    ];

    for (const [id, role] of callers) {
      const res = await accept(quote.id, bearer(id, role));
      expect([403, 404]).toContain(res.status);
    }
    expect(await bookings()).toBe(0);
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('waiting');
  });
});

// @traces 222-FR-003
describe('POST /quotes/:id/accept replay and keys', () => {
  it('answers 200 with the same booking on a replay, whatever the body', async () => {
    const { andrei, quote } = await quoted();
    const key = randomUUID();

    const first = await accept(quote.id, asDriver(andrei), key);
    const again = await accept(quote.id, asDriver(andrei), key, {
      historyShared: true,
    });

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await bookings()).toBe(1);
    expect((await prisma.booking.findFirstOrThrow()).historyShared).toBe(false);
  });

  it('answers the first booking when the same key comes with the other quote of the request', async () => {
    const { andrei, other, quote } = await quoted();
    const key = randomUUID();

    const first = await accept(quote.id, asDriver(andrei), key);
    const again = await accept(other.id, asDriver(andrei), key);

    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await bookings()).toBe(1);
  });

  it('refuses a different key on the same accepted quote as accepted, naming the quote', async () => {
    const { andrei, quote } = await quoted();
    await accept(quote.id, asDriver(andrei));

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_transition');
    expect(res.body.currentStatus).toBe('accepted');
    expect(await bookings()).toBe(1);
  });

  it('answers booking_pending for the second quote of a booked request', async () => {
    const { andrei, other, quote } = await quoted();
    await accept(quote.id, asDriver(andrei));

    const res = await accept(other.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('booking_pending');
    expect(await bookings()).toBe(1);
  });

  it('lets two drivers use the same key text for their own quotes', async () => {
    const one = await quoted();
    const two = await quoted();
    const key = randomUUID();

    const a = await accept(one.quote.id, asDriver(one.andrei), key);
    const b = await accept(two.quote.id, asDriver(two.andrei), key);

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).not.toBe(b.body.id);
    expect(await bookings()).toBe(2);
  });

  it('does not answer another driver the replay of a key it did not use', async () => {
    const one = await quoted();
    const two = await quoted();
    const key = randomUUID();
    await accept(one.quote.id, asDriver(one.andrei), key);

    const res = await accept(one.quote.id, asDriver(two.andrei), key);

    expect(res.status).toBe(404);
    expect(await bookings()).toBe(1);
  });

  it('writes one booking and one answer pair for the same key sent twelve times at once', async () => {
    const { andrei, quote } = await quoted();
    const key = randomUUID();

    const all = await Promise.all(
      Array.from({ length: 12 }, () => accept(quote.id, asDriver(andrei), key)),
    );

    expect(all.map((r) => r.status).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    expect(new Set(all.map((r) => r.body.id)).size).toBe(1);
    expect(await bookings()).toBe(1);
  });
});

// @traces 222-FR-004
describe('POST /quotes/:id/accept concurrent races', () => {
  it('ends with exactly one booking when both quotes of a request are accepted at once', async () => {
    const { andrei, other, quote, request } = await quoted();

    const all = await Promise.all([
      accept(quote.id, asDriver(andrei)),
      accept(other.id, asDriver(andrei)),
    ]);

    expect(all.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await bookings()).toBe(1);
    expect(
      await prisma.quote.count({
        where: { requestId: request.id, status: 'accepted' },
      }),
    ).toBe(1);
    const loser = all.find((r) => r.status === 409);
    expect(loser?.body.code).toMatch(/booking_pending|invalid_transition/);
  });

  it('ends with exactly one booking when the same quote is accepted under many keys at once', async () => {
    const { andrei, quote } = await quoted();

    const all = await Promise.all(
      Array.from({ length: 8 }, () => accept(quote.id, asDriver(andrei))),
    );

    expect(all.filter((r) => r.status === 201)).toHaveLength(1);
    expect(all.filter((r) => r.status === 409)).toHaveLength(7);
    expect(all.some((r) => r.status >= 500)).toBe(false);
    expect(await bookings()).toBe(1);
  });
});

// @traces 222-FR-002
describe('POST /quotes/:id/accept confirm_by and history', () => {
  it('sets confirmBy to the lapse after the accept when the slot is far off', async () => {
    const { andrei, quote } = await quoted();
    const before = Date.now();

    const res = await accept(quote.id, asDriver(andrei));

    const confirmBy = new Date(res.body.confirmBy).getTime();
    expect(confirmBy).toBeGreaterThanOrEqual(
      before + BOOKING_CONFIRM_LAPSE_HOURS * HOUR - 1000,
    );
    expect(confirmBy).toBeLessThanOrEqual(
      Date.now() + BOOKING_CONFIRM_LAPSE_HOURS * HOUR + 1000,
    );
  });

  it('caps confirmBy at the slot start when the slot is within the lapse', async () => {
    const { andrei, quote } = await quoted();
    const slot = new Date(Date.now() + 3 * HOUR);
    await prisma.quote.update({ data: { slot }, where: { id: quote.id } });

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(201);
    expect(res.body.confirmBy).toBe(slot.toISOString());
    expect(res.body.startsAt).toBe(slot.toISOString());
  });

  it('keeps confirmBy at the slot start when the slot is exactly the lapse away', async () => {
    const { andrei, quote } = await quoted();
    const slot = new Date(
      Date.now() + BOOKING_CONFIRM_LAPSE_HOURS * HOUR + 60_000,
    );
    await prisma.quote.update({ data: { slot }, where: { id: quote.id } });

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(201);
    expect(new Date(res.body.confirmBy).getTime()).toBeLessThanOrEqual(
      slot.getTime(),
    );
  });

  it('stores historyShared true as given', async () => {
    const { andrei, quote } = await quoted();

    const res = await accept(quote.id, asDriver(andrei), undefined, {
      historyShared: true,
    });

    expect(res.status).toBe(201);
    expect((await prisma.booking.findFirstOrThrow()).historyShared).toBe(true);
  });

  it('writes exactly one quote.accepted outbox event per accept', async () => {
    const { andrei, quote } = await quoted();
    await prisma.$executeRawUnsafe('TRUNCATE outbox_event');

    await accept(quote.id, asDriver(andrei));
    await accept(quote.id, asDriver(andrei), undefined);

    const events = await prisma.outboxEvent.findMany();
    expect(events.filter((e) => e.kind === 'quote.accepted')).toHaveLength(1);
  });
});

// @traces 222-FR-004
describe('POST /quotes/:id/accept refusals leave every row unchanged', () => {
  it('refuses a slot that has just passed with slot_passed', async () => {
    const { andrei, quote } = await quoted();
    await prisma.quote.update({
      data: { slot: new Date(Date.now() - 1000) },
      where: { id: quote.id },
    });

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('slot_passed');
    expect(await bookings()).toBe(0);
  });

  it('keeps the key free after slot_passed', async () => {
    const { andrei, quote } = await quoted();
    const key = randomUUID();
    await prisma.quote.update({
      data: { slot: new Date(Date.now() - 1000) },
      where: { id: quote.id },
    });
    await accept(quote.id, asDriver(andrei), key);
    await prisma.quote.update({
      data: { slot: new Date(Date.now() + 48 * HOUR) },
      where: { id: quote.id },
    });

    const res = await accept(quote.id, asDriver(andrei), key);

    expect(res.status).toBe(201);
  });

  it('refuses a waiting quote past its expiry as expired, leaving it waiting', async () => {
    const { andrei, quote } = await quoted();
    await prisma.quote.update({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { id: quote.id },
    });

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_transition');
    expect(res.body.currentStatus).toBe('expired');
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('waiting');
    expect(await bookings()).toBe(0);
  });

  it('refuses a suspended garage as withdrawn, leaving the quote waiting', async () => {
    const { andrei, dinamo, quote } = await quoted();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: dinamo.garage.id },
    });

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_transition');
    expect(res.body.currentStatus).toBe('withdrawn');
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('waiting');
    expect(await bookings()).toBe(0);
  });

  it.each(['expired', 'withdrawn', 'lost', 'declined_by_driver'] as const)(
    'refuses a quote already %s naming that state',
    async (status) => {
      const { andrei, request } = await quoted();
      const garage = await world.garage('Garaj Extra');
      const gone = await world.quote(request.id, garage.id, status);

      const res = await accept(gone.id, asDriver(andrei));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('invalid_transition');
      expect(res.body.currentStatus).toBe(status);
      expect(await bookings()).toBe(0);
    },
  );

  it('refuses a quote of a request that is not quoted, naming the request', async () => {
    const { andrei, quote, request } = await quoted();
    await prisma.quoteRequest.update({
      data: { status: 'sent' },
      where: { id: request.id },
    });

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_transition');
    expect(res.body.currentStatus).toBe('sent');
    expect(await bookings()).toBe(0);
  });

  it('writes no outbox event or booking for any refusal', async () => {
    const { andrei, quote } = await quoted();
    await prisma.quote.update({
      data: { slot: new Date(Date.now() - HOUR) },
      where: { id: quote.id },
    });
    await prisma.$executeRawUnsafe('TRUNCATE outbox_event');

    await accept(quote.id, asDriver(andrei));

    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(await bookings()).toBe(0);
  });
});
