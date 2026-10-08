import { HttpException } from '@nestjs/common';

import { databaseUrl, quotesWorld } from './quotes.testing';
import {
  BOOKING_MOVES,
  moveBooking,
  moveQuote,
  moveRecipient,
  moveRequest,
  QUOTE_MOVES,
  RECIPIENT_MOVES,
  REQUEST_MOVES,
} from './transitions';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { type EventPort, outbox } from '../events/event.port';
import {
  BookingStatus,
  QuoteRequestStatus,
  QuoteStatus,
  RecipientStatus,
} from '../generated/prisma/enums';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const ports = { audit: new AuditService(), events: outbox };

let driver: string;
let owner: string;
let garageId: string;

beforeAll(async () => {
  await world.reset();
  driver = await world.account('Andrei Marin', ['driver']);
  owner = await world.account('Ion Popescu', ['garage']);
  garageId = (await world.garage('Atelier Dinamo')).id;
  await prisma.garageMember.create({
    data: { accountId: owner, garageId, role: 'owner' },
  });
});

const byDriver = () => ({ accountId: driver, role: 'driver' as const });
const byGarage = () => ({ accountId: owner, role: 'garage' as const });

const trail = async (subjectId: string) => ({
  audit: await prisma.activityLog.findMany({ where: { subjectId } }),
  events: await prisma.outboxEvent.findMany({ where: { subjectId } }),
});

async function refusal(attempt: Promise<unknown>) {
  const error = await attempt.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  return {
    body: (error as HttpException).getResponse(),
    status: (error as HttpException).getStatus(),
  };
}

const count = (table: Record<string, readonly string[]>) =>
  Object.values(table).flat().length;

// @traces 220-FR-008
// @traces 220-FR-017
describe('the transition tables', () => {
  it('hold exactly the moves of the state diagrams', () => {
    expect(count(REQUEST_MOVES)).toBe(8);
    expect(count(RECIPIENT_MOVES)).toBe(5);
    expect(count(QUOTE_MOVES)).toBe(7);
    expect(count(BOOKING_MOVES)).toBe(6);
    expect(REQUEST_MOVES).toEqual({
      booked: ['quoted', 'in_work', 'closed'],
      closed: [],
      done: [],
      in_work: ['done'],
      quoted: ['booked', 'closed'],
      sent: ['quoted', 'closed'],
    });
    expect(RECIPIENT_MOVES).toEqual({
      closed: [],
      declined: ['waiting'],
      expired: [],
      quoted: [],
      waiting: ['quoted', 'declined', 'expired', 'closed'],
    });
    expect(QUOTE_MOVES).toEqual({
      accepted: ['expired', 'lost'],
      declined_by_driver: [],
      expired: [],
      lost: [],
      waiting: [
        'accepted',
        'withdrawn',
        'expired',
        'lost',
        'declined_by_driver',
      ],
      withdrawn: [],
    });
    expect(BOOKING_MOVES).toEqual({
      awaiting_confirmation: ['confirmed', 'lapsed', 'cancelled'],
      cancelled: [],
      completed: [],
      confirmed: ['cancelled', 'no_show', 'completed'],
      lapsed: [],
      no_show: [],
    });
  });
});

interface Machine<S extends string> {
  entity: string;
  statuses: readonly S[];
  table: Record<S, readonly S[]>;
  // A row in `from`, and the audit fields its status entry carries.
  rowIn(from: S): Promise<{ id: string; scope: Record<string, unknown> }>;
  move(id: string, to: S): Promise<unknown>;
  read(id: string): Promise<{ status: string }>;
  // The columns each target status sets with it; read once the accounts
  // exist.
  stamps: () => Partial<Record<S, Record<string, unknown>>>;
}

// Every pair of statuses: the table's moves go through with their time
// columns and one audit entry and event; any other pair is refused and
// leaves no trace.
function judges<S extends string>(m: Machine<S>) {
  const pairs = m.statuses.flatMap((from) =>
    m.statuses.map((to) => [from, to] as const),
  );
  const moves = pairs.filter(([from, to]) => m.table[from].includes(to));
  const refused = pairs.filter(([from, to]) => !m.table[from].includes(to));

  it.each(moves)('moves from %s to %s', async (from, to) => {
    const { id, scope } = await m.rowIn(from);

    await m.move(id, to);

    expect(await m.read(id)).toMatchObject({
      status: to,
      ...m.stamps()[to],
    });
    const { audit, events } = await trail(id);
    expect(audit.filter((entry) => entry.field === 'status')).toEqual([
      expect.objectContaining({
        action: 'update',
        newValue: to,
        oldValue: from,
        subjectType: m.entity,
        ...scope,
      }),
    ]);
    expect(events).toHaveLength(1);
  });

  it.each(refused)('refuses a move from %s to %s', async (from, to) => {
    const { id } = await m.rowIn(from);

    expect(await refusal(m.move(id, to))).toEqual({
      body: expect.objectContaining({
        code: 'invalid_transition',
        currentStatus: from,
        entity: m.entity,
        to,
      }),
      status: 409,
    });
    expect((await m.read(id)).status).toBe(from);
    expect(await trail(id)).toEqual({ audit: [], events: [] });
  });
}

const anyDate = expect.any(Date);

// @traces 220-FR-008
// @traces 220-FR-011
describe('moveRequest', () => {
  judges<QuoteRequestStatus>({
    entity: 'quote_request',
    move: (id, to) =>
      prisma.$transaction((tx) =>
        moveRequest(tx, ports, {
          actor: byDriver(),
          closedReason: 'cancelled',
          event: {
            audience: {
              driverAccountId: driver,
              garageIds: [garageId],
              type: 'request',
            },
            kind: 'request.cancelled',
          },
          id,
          to,
        }),
      ),
    read: (id) => prisma.quoteRequest.findUniqueOrThrow({ where: { id } }),
    async rowIn(from) {
      const row = await world.request(driver, { status: from });
      return {
        id: row.id,
        scope: { actorId: driver, actorRole: 'driver', carId: row.carId },
      };
    },
    stamps: () => ({
      closed: { closedAt: anyDate, closedReason: 'cancelled' },
    }),
    statuses: Object.values(QuoteRequestStatus),
    table: REQUEST_MOVES,
  });

  it('sends the event to the driver and every garage asked', async () => {
    const row = await world.request(driver);

    await prisma.$transaction((tx) =>
      moveRequest(tx, ports, {
        actor: byDriver(),
        event: {
          audience: {
            driverAccountId: driver,
            garageIds: [garageId],
            type: 'request',
          },
          kind: 'request.cancelled',
        },
        id: row.id,
        to: 'quoted',
      }),
    );

    expect((await trail(row.id)).events).toEqual([
      expect.objectContaining({
        audience: [`account:${driver}`, `garage:${garageId}`],
        kind: 'request.cancelled',
      }),
    ]);
  });

  it('answers 404 for a request that does not exist', async () => {
    const { status } = await refusal(
      prisma.$transaction((tx) =>
        moveRequest(tx, ports, {
          actor: byDriver(),
          event: {
            audience: {
              driverAccountId: driver,
              garageIds: [],
              type: 'request',
            },
            kind: 'request.cancelled',
          },
          id: '00000000-0000-4000-8000-000000000000',
          to: 'quoted',
        }),
      ),
    );

    expect(status).toBe(404);
  });
});

// @traces 220-FR-004
// @traces 220-FR-008
describe('moveRecipient', () => {
  judges<RecipientStatus>({
    entity: 'request_recipient',
    move: (id, to) =>
      prisma.$transaction((tx) =>
        moveRecipient(tx, ports, {
          actor: byGarage(),
          declineReason: 'need_to_see_car',
          event: {
            audience: { driverAccountId: driver, garageId, type: 'quote' },
            kind: 'request.declined',
          },
          id,
          to,
        }),
      ),
    read: (id) => prisma.requestRecipient.findUniqueOrThrow({ where: { id } }),
    async rowIn(from) {
      const request = await world.request(driver);
      const row = await world.recipient(request.id, garageId, from, owner);
      return { id: row.id, scope: { actorRole: 'owner', garageId } };
    },
    stamps: () => ({
      declined: {
        answeredAt: anyDate,
        declinedAt: anyDate,
        declinedBy: owner,
        declineReason: 'need_to_see_car',
      },
      quoted: { answeredAt: anyDate },
      waiting: {
        answeredAt: null,
        declinedAt: null,
        declinedBy: null,
        declineReason: null,
      },
    }),
    statuses: Object.values(RecipientStatus),
    table: RECIPIENT_MOVES,
  });
});

// @traces 220-FR-005
// @traces 220-FR-008
describe('moveQuote', () => {
  judges<QuoteStatus>({
    entity: 'quote',
    move: (id, to) =>
      prisma.$transaction((tx) =>
        moveQuote(tx, ports, {
          actor: byDriver(),
          event: {
            audience: { driverAccountId: driver, garageId, type: 'quote' },
            kind: 'quote.accepted',
          },
          id,
          to,
        }),
      ),
    read: (id) => prisma.quote.findUniqueOrThrow({ where: { id } }),
    async rowIn(from) {
      const request = await world.request(driver, { status: 'quoted' });
      const row = await world.quote(request.id, garageId, from);
      return { id: row.id, scope: { actorRole: 'driver', garageId } };
    },
    stamps: () => ({
      accepted: { acceptedAt: anyDate },
      withdrawn: { withdrawnAt: anyDate },
    }),
    statuses: Object.values(QuoteStatus),
    table: QUOTE_MOVES,
  });

  it('lets the system withdraw a waiting quote when the garage is suspended', async () => {
    const request = await world.request(driver, { status: 'quoted' });
    const row = await world.quote(request.id, garageId);

    await prisma.$transaction((tx) =>
      moveQuote(tx, ports, {
        actor: { accountId: null, role: 'system' },
        event: {
          audience: { driverAccountId: driver, garageId, type: 'quote' },
          kind: 'quote.closed',
        },
        id: row.id,
        to: 'withdrawn',
      }),
    );

    expect((await trail(row.id)).audit).toEqual([
      expect.objectContaining({ actorId: null, actorRole: 'system' }),
    ]);
  });
});

// @traces 220-FR-006
// @traces 220-FR-008
describe('moveBooking', () => {
  judges<BookingStatus>({
    entity: 'booking',
    move: (id, to) =>
      prisma.$transaction((tx) =>
        moveBooking(tx, ports, {
          actor: byGarage(),
          cancellation: { reason: 'parts_not_available', side: 'garage' },
          event: {
            audience: {
              driverAccountId: driver,
              garageId,
              mechanicId: null,
              type: 'booking',
            },
            kind: 'booking.confirmed',
          },
          id,
          to,
        }),
      ),
    read: (id) => prisma.booking.findUniqueOrThrow({ where: { id } }),
    async rowIn(from) {
      const { booking } = await world.chain(driver, garageId, {
        booking: from,
      });
      return { id: booking.id, scope: { actorRole: 'owner', garageId } };
    },
    stamps: () => ({
      cancelled: {
        cancelledAt: anyDate,
        cancelledBy: owner,
        cancelledBySide: 'garage',
        cancelReason: 'parts_not_available',
      },
      completed: { completedAt: anyDate },
      confirmed: { confirmedAt: anyDate, confirmedBy: owner },
      no_show: { noShowAt: anyDate, noShowRecordedBy: owner },
    }),
    statuses: Object.values(BookingStatus),
    table: BOOKING_MOVES,
  });

  it('records a cancellation reason as a key change for the driver’s history', async () => {
    const { booking } = await world.chain(driver, garageId);

    await prisma.$transaction((tx) =>
      moveBooking(tx, ports, {
        actor: byDriver(),
        cancellation: {
          note: 'Am plecat din oraș',
          reason: 'plans_changed',
          side: 'driver',
        },
        event: {
          audience: {
            driverAccountId: driver,
            garageId,
            mechanicId: null,
            type: 'booking',
          },
          kind: 'booking.cancelled',
        },
        id: booking.id,
        to: 'cancelled',
      }),
    );

    expect(
      await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }),
    ).toMatchObject({
      cancelledBySide: 'driver',
      cancelNote: 'Am plecat din oraș',
    });
    expect((await trail(booking.id)).audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'cancel_reason',
          isKeyChange: true,
          newValue: 'plans_changed',
        }),
      ]),
    );
  });
});

describe('a move that needs its reason', () => {
  it('will not compile a close without its reason or a cancellation without one', () => {
    const event = {
      audience: { driverAccountId: driver, garageIds: [], type: 'request' },
      kind: 'request.cancelled',
    } as const;
    const cancelled = {
      audience: {
        driverAccountId: driver,
        garageId,
        mechanicId: null,
        type: 'booking',
      },
      kind: 'booking.cancelled',
    } as const;
    const unsent = (tx: Parameters<typeof moveRequest>[0]) => [
      // @ts-expect-error a request closes only with its reason (closed_reason)
      moveRequest(tx, ports, {
        actor: byDriver(),
        event,
        id: '',
        to: 'closed',
      }),
      // @ts-expect-error a booking is cancelled only with its cancellation
      moveBooking(tx, ports, {
        actor: byGarage(),
        event: cancelled,
        id: '',
        to: 'cancelled',
      }),
    ];

    expect(unsent).toBeInstanceOf(Function);
  });
});

// @traces 220-FR-011
describe('a move and its trace', () => {
  const event = () => ({
    audience: {
      driverAccountId: driver,
      garageIds: [garageId],
      type: 'request' as const,
    },
    kind: 'request.cancelled' as const,
  });

  it('leaves the status, the audit entry and the event out when the caller rolls back', async () => {
    const row = await world.request(driver);

    await expect(
      prisma.$transaction(async (tx) => {
        await moveRequest(tx, ports, {
          actor: byDriver(),
          event: event(),
          id: row.id,
          to: 'quoted',
        });
        throw new Error('the next write failed');
      }),
    ).rejects.toThrow('the next write failed');

    expect(
      (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe('sent');
    expect(await trail(row.id)).toEqual({ audit: [], events: [] });
  });

  it('fails the move when its event cannot be written', async () => {
    const row = await world.request(driver);
    const broken: EventPort = {
      record: async () => {
        throw new Error('outbox unavailable');
      },
    };

    await expect(
      prisma.$transaction((tx) =>
        moveRequest(
          tx,
          { ...ports, events: broken },
          {
            actor: byDriver(),
            event: event(),
            id: row.id,
            to: 'quoted',
          },
        ),
      ),
    ).rejects.toThrow('outbox unavailable');

    expect(
      (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe('sent');
    expect(await trail(row.id)).toEqual({ audit: [], events: [] });
  });

  it('judges the second of two concurrent moves against the first one’s result', async () => {
    const row = await world.request(driver);
    const close = () =>
      prisma.$transaction((tx) =>
        moveRequest(tx, ports, {
          actor: byDriver(),
          closedReason: 'cancelled',
          event: event(),
          id: row.id,
          to: 'closed',
        }),
      );

    const results = await Promise.allSettled([close(), close()]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const lost = results.find((r) => r.status === 'rejected');
    expect(
      ((lost as PromiseRejectedResult).reason as HttpException).getResponse(),
    ).toMatchObject({ currentStatus: 'closed', entity: 'quote_request' });
    expect((await trail(row.id)).audit).toHaveLength(1);
  });
});
