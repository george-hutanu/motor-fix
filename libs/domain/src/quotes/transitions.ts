import type { Prisma } from '../generated/prisma/client';
import type {
  BookingCancelReason,
  BookingStatus,
  CancelledBySide,
  DeclineReason,
  QuoteRequestStatus,
  QuoteStatus,
  RecipientStatus,
  RequestClosedReason,
} from '../generated/prisma/enums';
import {
  applyTransition,
  type LockedRow,
  type Move,
  type TransitionPorts,
  type TransitionSpec,
} from '../transitions';

// The moves of each status diagram, written once; every other pair is refused.
export const REQUEST_MOVES: Record<
  QuoteRequestStatus,
  readonly QuoteRequestStatus[]
> = {
  booked: ['quoted', 'in_work', 'closed'],
  closed: [],
  done: [],
  in_work: ['done'],
  quoted: ['booked', 'closed'],
  sent: ['quoted', 'closed'],
};

export const RECIPIENT_MOVES: Record<
  RecipientStatus,
  readonly RecipientStatus[]
> = {
  closed: [],
  // Within the undo window only; the caller checks the window.
  declined: ['waiting'],
  expired: [],
  quoted: [],
  waiting: ['quoted', 'declined', 'expired', 'closed'],
};

export const QUOTE_MOVES: Record<QuoteStatus, readonly QuoteStatus[]> = {
  accepted: ['expired', 'lost'],
  declined_by_driver: [],
  expired: [],
  lost: [],
  waiting: ['accepted', 'withdrawn', 'expired', 'lost', 'declined_by_driver'],
  withdrawn: [],
};

export const BOOKING_MOVES: Record<BookingStatus, readonly BookingStatus[]> = {
  awaiting_confirmation: ['confirmed', 'lapsed', 'cancelled'],
  cancelled: [],
  completed: [],
  confirmed: ['cancelled', 'no_show', 'completed'],
  lapsed: [],
  no_show: [],
};

type Data = Record<string, unknown>;

const REQUEST: TransitionSpec<QuoteRequestStatus> = {
  entity: 'quote_request',
  moves: REQUEST_MOVES,
  table: 'quote_request',
  update: (tx, id, data) =>
    tx.quoteRequest.update({
      data: data as Prisma.QuoteRequestUncheckedUpdateInput,
      where: { id },
    }),
};

const RECIPIENT: TransitionSpec<RecipientStatus> = {
  entity: 'request_recipient',
  moves: RECIPIENT_MOVES,
  table: 'request_recipient',
  update: (tx, id, data) =>
    tx.requestRecipient.update({
      data: data as Prisma.RequestRecipientUncheckedUpdateInput,
      where: { id },
    }),
};

const QUOTE: TransitionSpec<QuoteStatus> = {
  entity: 'quote',
  moves: QUOTE_MOVES,
  table: 'quote',
  update: (tx, id, data) =>
    tx.quote.update({
      data: data as Prisma.QuoteUncheckedUpdateInput,
      where: { id },
    }),
};

const BOOKING: TransitionSpec<BookingStatus> = {
  entity: 'booking',
  moves: BOOKING_MOVES,
  table: 'booking',
  update: (tx, id, data) =>
    tx.booking.update({
      data: data as Prisma.BookingUncheckedUpdateInput,
      where: { id },
    }),
};

type Base<S extends string> = Omit<Move<S>, 'set' | 'scope'>;
type Tx = Prisma.TransactionClient;

const inGarage = (row: LockedRow) => ({ garageId: row.garage_id });

// Closing needs its reason: closed_reason is checked by the database, so a
// close without one would end as a 500.
type RequestMove =
  | (Base<Exclude<QuoteRequestStatus, 'closed'>> & {
      closedReason?: RequestClosedReason;
    })
  | (Base<'closed'> & { closedReason: RequestClosedReason });

export function moveRequest(tx: Tx, ports: TransitionPorts, move: RequestMove) {
  return applyTransition(tx, REQUEST, ports, {
    ...move,
    scope: (row) => ({ carId: row.car_id }),
    set: () =>
      move.to === 'closed'
        ? { closedAt: new Date(), closedReason: move.closedReason }
        : {},
  });
}

// An answer stamps the time; a decline also who and why, and its undo
// clears all of it.
function recipientColumns(
  to: RecipientStatus,
  by: string | null,
  declineReason?: DeclineReason,
): Data {
  const now = new Date();
  if (to === 'quoted') return { answeredAt: now };
  if (to === 'declined') {
    return { answeredAt: now, declinedAt: now, declinedBy: by, declineReason };
  }
  if (to === 'waiting') {
    return {
      answeredAt: null,
      declinedAt: null,
      declinedBy: null,
      declineReason: null,
    };
  }
  return {};
}

// A decline needs its reason: decline_reason is checked by the database, as
// closing a request is.
type RecipientMove =
  | (Base<Exclude<RecipientStatus, 'declined'>> & {
      declineReason?: DeclineReason;
    })
  | (Base<'declined'> & { declineReason: DeclineReason });

export function moveRecipient(
  tx: Tx,
  ports: TransitionPorts,
  move: RecipientMove,
) {
  return applyTransition(tx, RECIPIENT, ports, {
    ...move,
    scope: inGarage,
    set: () =>
      recipientColumns(move.to, move.actor.accountId, move.declineReason),
  });
}

const QUOTE_STAMPS: Partial<Record<QuoteStatus, string>> = {
  accepted: 'acceptedAt',
  withdrawn: 'withdrawnAt',
};

// Accepting a second quote on the same request is refused by the database
// (one accepted quote per request), as a 409 rather than a 500.
export function moveQuote(
  tx: Tx,
  ports: TransitionPorts,
  move: Base<QuoteStatus>,
) {
  const stamp = QUOTE_STAMPS[move.to];
  return applyTransition(tx, QUOTE, ports, {
    ...move,
    scope: inGarage,
    set: () => (stamp ? { [stamp]: new Date() } : {}),
  });
}

export interface Cancellation {
  side: CancelledBySide;
  reason: BookingCancelReason;
  note?: string;
  // Inside the free-cancellation cutoff.
  late?: boolean;
}

function bookingColumns(
  to: BookingStatus,
  by: string | null,
  cancellation?: Cancellation,
): Data {
  const now = new Date();
  switch (to) {
    case 'confirmed':
      return { confirmedAt: now, confirmedBy: by };
    case 'cancelled':
      return {
        cancelledAt: now,
        cancelledBy: by,
        cancelledBySide: cancellation?.side,
        cancelNote: cancellation?.note,
        cancelReason: cancellation?.reason,
        lateCancellation: cancellation?.late ?? false,
      };
    case 'no_show':
      return { noShowAt: now, noShowRecordedBy: by };
    case 'completed':
      return { completedAt: now };
    default:
      return {};
  }
}

// A cancellation needs its reason (checked by the database, as closing a
// request is).
type BookingMove =
  | (Base<Exclude<BookingStatus, 'cancelled'>> & {
      cancellation?: Cancellation;
    })
  | (Base<'cancelled'> & { cancellation: Cancellation });

// A cancellation also files its reason, which the driver's short history
// shows next to the status.
export async function moveBooking(
  tx: Tx,
  ports: TransitionPorts,
  move: BookingMove,
) {
  const { cancellation, ...rest } = move;
  const moved = await applyTransition(tx, BOOKING, ports, {
    ...rest,
    scope: inGarage,
    set: () => bookingColumns(move.to, move.actor.accountId, cancellation),
  });
  if (move.to === 'cancelled' && cancellation) {
    await ports.audit.record(tx, {
      action: 'update',
      actorId: move.actor.accountId,
      actorRole: move.actor.role,
      field: 'cancel_reason',
      newValue: cancellation.reason,
      oldValue: null,
      subjectId: move.id,
      subjectType: 'booking',
      ...inGarage(moved.row),
    });
  }
  return moved;
}
