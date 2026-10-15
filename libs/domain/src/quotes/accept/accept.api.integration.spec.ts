import { randomUUID } from 'node:crypto';

import { AcceptController } from './accept.controller';
import { AcceptService } from './accept.service';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { outbox } from '../../events/event.port';
import type { QuoteStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../quotes-api.testing';
import { BOOKING_CONFIRM_LAPSE_HOURS } from '../quotes-config';

const { bearer, post, team, world } = quotesApp();
const { prisma } = world;

const HOUR = 3_600_000;

// The outbox hangs off none of the rows the world empties, and the log is
// append-only: each case reads both from its own start.
let since: Date;
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  [{ since }] = await prisma.$queryRaw<
    { since: Date }[]
  >`SELECT now() AS since`;
});

// The entries an accept files; the world's own set-up files others.
const moves = () => ({
  at: { gte: since },
  subjectType: { in: ['quote', 'quote_request', 'booking'] },
});
const logged = () => prisma.activityLog.count({ where: moves() });

// Andrei's request, quoted by Atelier Dinamo and by Service Militari.
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

// Every row the accept could touch, as it stands.
async function snapshot(requestId: string) {
  return {
    bookings: await prisma.booking.count({ where: { requestId } }),
    events: await prisma.outboxEvent.count(),
    logged: await logged(),
    quotes: (
      await prisma.quote.findMany({
        orderBy: { id: 'asc' },
        select: { acceptedAt: true, id: true, status: true },
        where: { requestId },
      })
    ).map((q) => ({ ...q, acceptedAt: q.acceptedAt?.toISOString() ?? null })),
    request: (
      await prisma.quoteRequest.findUniqueOrThrow({ where: { id: requestId } })
    ).status,
  };
}

const driverActor = (accountId: string, over: Partial<Actor> = {}): Actor => ({
  accountId,
  garageId: null,
  language: 'ro',
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'driver',
  roles: ['driver'],
  ...over,
});

// @traces 222-FR-001
// @traces 222-FR-002
// @traces 222-FR-012
describe('POST /quotes/:id/accept', () => {
  it('creates the booking awaiting confirmation and moves the quote and the request, the other quote left waiting', async () => {
    const { andrei, dinamo, other, quote, request } = await quoted();

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(201);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { quoteId: quote.id },
    });
    expect(booking).toMatchObject({
      driverId: andrei,
      durationMinutes: quote.durationMinutes,
      garageId: dinamo.garage.id,
      historyShared: false,
      requestId: request.id,
      startsAt: quote.slot,
      status: 'awaiting_confirmation',
    });
    expect(res.body).toEqual({
      cancelledAt: null,
      cancelledBySide: null,
      cancelReason: null,
      completedAt: null,
      confirmBy: booking.confirmBy.toISOString(),
      confirmedAt: null,
      createdAt: booking.createdAt.toISOString(),
      durationMinutes: quote.durationMinutes,
      garage: {
        id: dinamo.garage.id,
        name: dinamo.garage.name,
        slug: dinamo.garage.slug,
      },
      id: booking.id,
      noShowAt: null,
      quoteId: quote.id,
      startsAt: quote.slot.toISOString(),
      status: 'awaiting_confirmation',
    });
    const moved = await prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
    });
    expect(moved.status).toBe('accepted');
    expect(moved.acceptedAt).not.toBeNull();
    expect(moved.fromBani).toBe(quote.fromBani);
    expect(moved.toBani).toBe(quote.toBani);
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: other.id } }))
        .status,
    ).toBe('waiting');
    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('booked');
  });

  it('gives the garage a day to confirm when the slot is further off', async () => {
    const { andrei, quote } = await quoted();

    await accept(quote.id, asDriver(andrei));

    const [booking, accepted] = await Promise.all([
      prisma.booking.findUniqueOrThrow({ where: { quoteId: quote.id } }),
      prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }),
    ]);
    expect(booking.confirmBy.getTime()).toBe(
      (accepted.acceptedAt as Date).getTime() +
        BOOKING_CONFIRM_LAPSE_HOURS * HOUR,
    );
  });

  it('gives the garage until the slot when the slot is nearer than a day', async () => {
    const { andrei, quote } = await quoted();
    const slot = new Date(Date.now() + 2 * HOUR);
    await prisma.quote.update({ data: { slot }, where: { id: quote.id } });

    await accept(quote.id, asDriver(andrei));

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { quoteId: quote.id },
    });
    expect(booking.confirmBy).toEqual(slot);
    expect(booking.startsAt).toEqual(slot);
  });

  it.each([
    ['shared', { historyShared: true }, true],
    ['not shared', { historyShared: false }, false],
    ['left out', {}, false],
  ])('files the history choice when it is %s', async (_, body, shared) => {
    const { andrei, quote } = await quoted();

    const res = await accept(quote.id, asDriver(andrei), randomUUID(), body);

    expect(res.status).toBe(201);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { quoteId: quote.id },
    });
    expect(booking.historyShared).toBe(shared);
  });

  it('lets a driver whose e-mail is unconfirmed accept', async () => {
    const { andrei, quote } = await quoted();
    await prisma.account.update({
      data: {
        email: `andrei-${randomUUID()}@example.ro`,
        emailVerifiedAt: null,
      },
      where: { id: andrei },
    });

    expect((await accept(quote.id, asDriver(andrei))).status).toBe(201);
  });

  it('files the moves and the booking’s entries, and writes the one event both sides hear', async () => {
    const { andrei, dinamo, quote, request } = await quoted();

    const res = await accept(quote.id, asDriver(andrei), randomUUID(), {
      historyShared: true,
    });

    const bookingId = res.body.id;
    const entries = await prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: moves(),
    });
    const by = { actorId: andrei, actorRole: 'driver', viaAssistant: false };
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...by,
          action: 'update',
          field: 'status',
          garageId: dinamo.garage.id,
          newValue: 'accepted',
          oldValue: 'waiting',
          subjectId: quote.id,
          subjectType: 'quote',
        }),
        expect.objectContaining({
          ...by,
          action: 'update',
          field: 'status',
          newValue: 'booked',
          oldValue: 'quoted',
          subjectId: request.id,
          subjectType: 'quote_request',
        }),
        expect.objectContaining({
          ...by,
          action: 'create',
          field: 'stage',
          garageId: dinamo.garage.id,
          newValue: 'awaiting_confirmation',
          oldValue: null,
          subjectId: bookingId,
          subjectType: 'booking',
        }),
        expect.objectContaining({
          ...by,
          action: 'update',
          field: 'history_shared',
          garageId: dinamo.garage.id,
          newValue: true,
          oldValue: null,
          subjectId: bookingId,
          subjectType: 'booking',
        }),
      ]),
    );
    expect(entries).toHaveLength(4);
    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'quote.accepted',
      payload: {
        bookingId,
        from: 'waiting',
        historyShared: true,
        quoteId: quote.id,
        requestId: request.id,
        to: 'accepted',
      },
      subjectId: quote.id,
    });
    expect([...events[0].audience].sort()).toEqual(
      [`account:${andrei}`, `garage:${dinamo.garage.id}`].sort(),
    );
  });

  it('marks the entries as the assistant’s when a grant accepted the quote', async () => {
    const { andrei, quote } = await quoted();
    const service = new AcceptService(prisma, new AuditService(), outbox);
    const grant = randomUUID();

    const { booking } = await service.accept(
      driverActor(andrei, { assistantGrantId: grant, via: 'assistant' }),
      quote.id,
      randomUUID(),
      {},
    );

    const entries = await prisma.activityLog.findMany({ where: moves() });
    expect(entries).toHaveLength(4);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        assistantGrantId: grant,
        viaAssistant: true,
      });
    }
    expect(entries.map((e) => e.subjectId)).toContain(booking.id);
  });
});

// @traces 222-FR-003
describe('accepting again with the same key', () => {
  it('answers the first booking as it reads now, with 200, writing nothing', async () => {
    const { andrei, quote, request } = await quoted();
    const key = randomUUID();
    const first = await accept(quote.id, asDriver(andrei), key);
    await prisma.booking.update({
      data: { confirmedAt: new Date(), status: 'confirmed' },
      where: { id: first.body.id },
    });
    const before = await snapshot(request.id);

    const again = await accept(quote.id, asDriver(andrei), key, {
      historyShared: true,
    });

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      id: first.body.id,
      status: 'confirmed',
    });
    expect(again.body.confirmedAt).not.toBeNull();
    expect(await snapshot(request.id)).toEqual(before);
  });

  it('answers the first booking whatever quote id the repeat names', async () => {
    const { andrei, other, quote, request } = await quoted();
    const key = randomUUID();
    const first = await accept(quote.id, asDriver(andrei), key);
    const before = await snapshot(request.id);

    const again = await accept(other.id, asDriver(andrei), key);

    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await snapshot(request.id)).toEqual(before);
  });

  it('ends a same-key race with one booking and one replay', async () => {
    const { andrei, quote } = await quoted();
    const key = randomUUID();

    const answers = await Promise.all([
      accept(quote.id, asDriver(andrei), key),
      accept(quote.id, asDriver(andrei), key),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 201]);
    expect(answers[0].body.id).toBe(answers[1].body.id);
    expect(await prisma.booking.count({ where: { quoteId: quote.id } })).toBe(
      1,
    );
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('ends a same-key race across two requests with one booking and one replay', async () => {
    const { andrei, dinamo, quote } = await quoted();
    const second = await world.request(andrei, { status: 'quoted' });
    const other = await world.quote(second.id, dinamo.garage.id);
    const key = randomUUID();

    const answers = await Promise.all([
      accept(quote.id, asDriver(andrei), key),
      accept(other.id, asDriver(andrei), key),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 201]);
    expect(answers[0].body.id).toBe(answers[1].body.id);
    expect(await prisma.booking.count({ where: { driverId: andrei } })).toBe(1);
  });

  it('keeps the key of a refused call free', async () => {
    const { andrei, quote } = await quoted();
    const key = randomUUID();
    await prisma.quote.update({
      data: { expiresAt: new Date(Date.now() - HOUR) },
      where: { id: quote.id },
    });
    expect((await accept(quote.id, asDriver(andrei), key)).status).toBe(409);
    await prisma.quote.update({
      data: { expiresAt: new Date(Date.now() + 24 * HOUR) },
      where: { id: quote.id },
    });

    expect((await accept(quote.id, asDriver(andrei), key)).status).toBe(201);
  });

  it('refuses a different key on a quote already accepted', async () => {
    const { andrei, quote } = await quoted();
    await accept(quote.id, asDriver(andrei));

    const again = await accept(quote.id, asDriver(andrei));

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'accepted',
      entity: 'quote',
      to: 'accepted',
    });
    expect(await prisma.booking.count({ where: { quoteId: quote.id } })).toBe(
      1,
    );
  });
});

// @traces 222-FR-001
describe('who may accept, and what the call must carry', () => {
  it('answers 404 to another driver, writing nothing', async () => {
    const { quote, request } = await quoted();
    const before = await snapshot(request.id);
    const ioana = await world.account('Ioana Pop');

    const res = await accept(quote.id, asDriver(ioana));

    expect(res.status).toBe(404);
    expect(await snapshot(request.id)).toEqual(before);
  });

  it('answers 404 to the garage that sent the quote, writing nothing', async () => {
    const { dinamo, quote, request } = await quoted();
    const before = await snapshot(request.id);

    const res = await accept(quote.id, bearer(dinamo.owner, 'garage'));

    expect(res.status).toBe(404);
    expect(await snapshot(request.id)).toEqual(before);
  });

  it('answers 404 for a quote that does not exist', async () => {
    const { andrei } = await quoted();

    expect((await accept(randomUUID(), asDriver(andrei))).status).toBe(404);
  });

  it('asks a visitor to sign in, writing nothing', async () => {
    const { quote, request } = await quoted();
    const before = await snapshot(request.id);

    const res = await accept(quote.id, undefined);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
    expect(await snapshot(request.id)).toEqual(before);
  });

  it.each([
    ['a string', 'yes'],
    ['a number', 1],
  ])('refuses historyShared as %s, naming it', async (_, historyShared) => {
    const { andrei, quote, request } = await quoted();
    const before = await snapshot(request.id);

    const res = await accept(quote.id, asDriver(andrei), randomUUID(), {
      historyShared,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('historyShared');
    expect(await snapshot(request.id)).toEqual(before);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['201 characters long', 'k'.repeat(201)],
  ])('refuses an Idempotency-Key that is %s, naming it', async (_, key) => {
    const { andrei, quote, request } = await quoted();
    const before = await snapshot(request.id);

    const res = await post(
      `/quotes/${quote.id}/accept`,
      {},
      asDriver(andrei),
      key,
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'required', field: 'idempotency-key' }],
    });
    expect(await snapshot(request.id)).toEqual(before);
  });

  it('refuses an id that is not a uuid', async () => {
    const { andrei } = await quoted();

    expect((await accept('not-a-uuid', asDriver(andrei))).status).toBe(400);
  });
});

// @traces 222-FR-015
describe('the accept in the API document', () => {
  it('declares the operation with its body, key and answers', async () => {
    const metadata = Reflect.getMetadata(
      'swagger/apiResponse',
      AcceptController.prototype.accept,
    ) as Record<string, unknown>;

    expect(Object.keys(metadata).sort()).toEqual(
      ['200', '201', '400', '401', '404', '409'].sort(),
    );
  });
});

// @traces 222-FR-004
// @traces 222-SC-005
describe('an accept that cannot happen', () => {
  it.each([
    'expired',
    'withdrawn',
    'lost',
    'declined_by_driver',
  ] as QuoteStatus[])(
    'refuses a quote that is %s, changing nothing',
    async (status) => {
      const { andrei, quote, request } = await quoted();
      await prisma.quote.update({
        data: {
          status,
          ...(status === 'withdrawn' && { withdrawnAt: new Date() }),
        },
        where: { id: quote.id },
      });
      const before = await snapshot(request.id);

      const res = await accept(quote.id, asDriver(andrei));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: status,
        entity: 'quote',
        to: 'accepted',
      });
      expect(await snapshot(request.id)).toEqual(before);
    },
  );

  it('refuses a waiting quote past its validity as expired, leaving the row to the sweep', async () => {
    const { andrei, quote, request } = await quoted();
    await prisma.quote.update({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { id: quote.id },
    });
    const before = await snapshot(request.id);

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'expired',
      entity: 'quote',
      to: 'accepted',
    });
    expect(await snapshot(request.id)).toEqual(before);
  });

  it('refuses a suspended garage’s quote as withdrawn, leaving the row as it is', async () => {
    const { andrei, dinamo, quote, request } = await quoted();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: dinamo.garage.id },
    });
    const before = await snapshot(request.id);

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'withdrawn',
      entity: 'quote',
      to: 'accepted',
    });
    expect(await snapshot(request.id)).toEqual(before);
  });

  it.each(['sent', 'closed'] as const)(
    'refuses when the request is %s, changing nothing',
    async (status) => {
      const { andrei, quote, request } = await quoted();
      await prisma.quoteRequest.update({
        data: {
          status,
          ...(status === 'closed' && {
            closedAt: new Date(),
            closedReason: 'cancelled',
          }),
        },
        where: { id: request.id },
      });
      const before = await snapshot(request.id);

      const res = await accept(quote.id, asDriver(andrei));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: status,
        entity: 'quote_request',
        to: 'booked',
      });
      expect(await snapshot(request.id)).toEqual(before);
    },
  );

  it.each(['awaiting_confirmation', 'confirmed'] as const)(
    'names the booking waiting when another quote of the request holds one %s',
    async (status) => {
      const { andrei, other, quote, request } = await quoted();
      await accept(other.id, asDriver(andrei));
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { quoteId: other.id },
      });
      if (status === 'confirmed') {
        await prisma.booking.update({
          data: { confirmedAt: new Date(), status },
          where: { id: booking.id },
        });
      }
      await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
      const before = await snapshot(request.id);

      const res = await accept(quote.id, asDriver(andrei));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'booking_pending',
        message: 'Ai deja o programare în așteptare',
      });
      expect(await snapshot(request.id)).toEqual(before);
    },
  );

  it('names the slot passed when the proposed time is not after now', async () => {
    const { andrei, quote, request } = await quoted();
    await prisma.quote.update({
      data: { slot: new Date(Date.now() - 60_000) },
      where: { id: quote.id },
    });
    const before = await snapshot(request.id);

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'slot_passed',
      message: 'Ora propusă a trecut',
    });
    expect(await snapshot(request.id)).toEqual(before);
  });

  it('judges the quote’s own state before a booking, and the booking before the request', async () => {
    const { andrei, other, quote, request } = await quoted();
    await accept(other.id, asDriver(andrei));
    await prisma.quote.update({
      data: { status: 'lost' },
      where: { id: quote.id },
    });

    const lost = await accept(quote.id, asDriver(andrei));
    expect(lost.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'lost',
    });

    await prisma.quote.update({
      data: { status: 'waiting' },
      where: { id: quote.id },
    });
    const pending = await accept(quote.id, asDriver(andrei));
    expect(pending.body).toMatchObject({ code: 'booking_pending' });
    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('booked');
  });

  it('judges the validity before the slot, and the slot before the garage', async () => {
    const { andrei, dinamo, quote } = await quoted();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: dinamo.garage.id },
    });
    await prisma.quote.update({
      data: { slot: new Date(Date.now() - 60_000) },
      where: { id: quote.id },
    });
    expect((await accept(quote.id, asDriver(andrei))).body).toMatchObject({
      code: 'slot_passed',
    });

    await prisma.quote.update({
      data: { expiresAt: new Date(Date.now() - 60_000) },
      where: { id: quote.id },
    });
    expect((await accept(quote.id, asDriver(andrei))).body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'expired',
    });
  });
});

// @traces 222-FR-004
// @traces 222-SC-002
describe('two acceptances at once', () => {
  it('ends two quotes of one request with exactly one booking, the loser 409', async () => {
    for (let run = 0; run < 5; run++) {
      await world.reset();
      const { andrei, other, quote, request } = await quoted();

      const answers = await Promise.all([
        accept(quote.id, asDriver(andrei)),
        accept(other.id, asDriver(andrei)),
      ]);

      expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
      const loser = answers.find((a) => a.status === 409);
      expect(loser?.body).toMatchObject({ code: 'booking_pending' });
      expect(
        await prisma.booking.count({ where: { requestId: request.id } }),
      ).toBe(1);
      expect(
        await prisma.quote.count({
          where: { requestId: request.id, status: 'accepted' },
        }),
      ).toBe(1);
    }
  });

  it('ends the same quote accepted twice with different keys with one booking, the loser 409', async () => {
    for (let run = 0; run < 5; run++) {
      await world.reset();
      const { andrei, quote } = await quoted();

      const answers = await Promise.all([
        accept(quote.id, asDriver(andrei)),
        accept(quote.id, asDriver(andrei)),
      ]);

      expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
      const loser = answers.find((a) => a.status === 409);
      expect(loser?.body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: 'accepted',
      });
      expect(await prisma.booking.count({ where: { quoteId: quote.id } })).toBe(
        1,
      );
    }
  });

  it('answers a write the database refuses as 409, never 500', async () => {
    const { andrei, quote, request } = await quoted();
    // A cancelled booking still holds the quote: only the one-booking-per-
    // quote index stands between the accept and a second one.
    await world.booking(quote.id, 'cancelled');

    const res = await accept(quote.id, asDriver(andrei));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      entity: 'booking',
      rule: 'one_booking_per_quote',
    });
    expect(
      await prisma.booking.count({ where: { requestId: request.id } }),
    ).toBe(1);
  });
});
