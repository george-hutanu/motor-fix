import type {
  BookingStatus,
  QuoteOutcome,
  QuoteStatus,
  RequestClosedReason,
} from '@motor-fix/contracts';

export interface QuoteOutcomeInput {
  booking: { status: BookingStatus } | null;
  garage: { status: string };
  quote: { status: QuoteStatus };
  request: { closedReason: RequestClosedReason | null };
}

// What became of a garage's quote, read from the quote, its own booking, the
// request's closing reason and the garage. Computed on every read, never kept.
export function outcomeOf({
  booking,
  garage,
  quote,
  request,
}: QuoteOutcomeInput): QuoteOutcome {
  switch (quote.status) {
    case 'waiting':
      return garage.status === 'suspended' ? 'withdrawn_suspended' : 'waiting';
    case 'accepted':
      return acceptedOutcome(booking?.status);
    case 'expired':
      return booking?.status === 'lapsed' ? 'lapsed' : 'expired';
    case 'withdrawn':
      return 'withdrawn';
    case 'declined_by_driver':
      return 'declined';
    case 'lost':
      return lostOutcome(booking?.status, request.closedReason);
    default: {
      const unmapped: never = quote.status;
      throw new Error(`No outcome for quote status ${String(unmapped)}`);
    }
  }
}

// An accepted quote's booking that lapsed or was cancelled moves the quote on
// in the same write; the two branches only cover a read between the writes.
function acceptedOutcome(booking: BookingStatus | undefined): QuoteOutcome {
  switch (booking) {
    case 'confirmed':
    case 'completed':
      return 'booked';
    case 'no_show':
      return 'no_show';
    case 'lapsed':
      return 'lapsed';
    case 'cancelled':
      return 'booking_cancelled';
    default:
      return 'accepted';
  }
}

// A lost quote: the account's closing first, then its own booking cancelled,
// then the request cancelled; anything else went to another garage.
function lostOutcome(
  booking: BookingStatus | undefined,
  closedReason: RequestClosedReason | null,
): QuoteOutcome {
  if (closedReason === 'account_closed') return 'account_closed';
  if (booking === 'cancelled') return 'booking_cancelled';
  if (closedReason === 'cancelled') return 'request_cancelled';
  return 'chose_other';
}
