import type { DeclineReasonCode } from '@motor-fix/contracts';
import { metrics } from '@opentelemetry/api';

export const QUOTE_SEND_OUTCOMES = [
  'sent',
  'refused',
  'already_answered',
  'request_not_open',
] as const;
type QuoteSendOutcome = (typeof QUOTE_SEND_OUTCOMES)[number];

// Looked up on every count, never cached: an instrument kept from before the
// meter provider is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

export const quotesSent = () =>
  meter().createCounter('motorfix_quotes_sent_total', {
    description: 'Quotes garages sent, by outcome',
  });

// One count per quote a garage sends, by outcome; a sent one also records
// how long the request waited for it, in minutes.
export function recordQuoteSend(outcome: QuoteSendOutcome, minutes?: number) {
  quotesSent().add(1, { outcome });
  if (minutes === undefined) return;
  meter()
    .createHistogram('motorfix_quote_response_minutes', {
      advice: {
        explicitBucketBoundaries: [
          5, 15, 30, 60, 180, 360, 720, 1440, 2880, 10080,
        ],
      },
      description: 'Time from a request being sent to a garage quoting it',
      unit: 'min',
    })
    .record(minutes);
}

export const REQUEST_DECLINE_OUTCOMES = [
  'declined',
  'already_answered',
  'request_not_open',
  'invalid',
] as const;
type RequestDeclineOutcome = (typeof REQUEST_DECLINE_OUTCOMES)[number];

export const requestDeclines = () =>
  meter().createCounter('motorfix_request_declines_total', {
    description: 'Requests garages declined, by outcome and reason',
  });

// One count per decline a garage tries, by outcome and reason; never who.
export function recordRequestDecline(
  outcome: RequestDeclineOutcome,
  reason: DeclineReasonCode,
) {
  requestDeclines().add(1, { outcome, reason });
}

export const DECLINE_WINDOW_OUTCOMES = [
  'sent',
  'muted',
  'skipped_undone',
  'skipped_closed',
  'already_told',
] as const;
export type DeclineWindowOutcome = (typeof DECLINE_WINDOW_OUTCOMES)[number];

export const declineWindows = () =>
  meter().createCounter('motorfix_decline_windows_closed_total', {
    description: 'Decline undo windows closed, by outcome',
  });

// One count per decline window the worker closes, by outcome, and whether
// the sweep found it rather than its own timer.
export function recordDeclineWindow(
  outcome: DeclineWindowOutcome,
  sweep: boolean,
) {
  declineWindows().add(1, { outcome, sweep: String(sweep) });
}

export const QUOTE_ACCEPT_OUTCOMES = [
  'accepted',
  'replayed',
  'booking_pending',
  'slot_passed',
  'invalid_transition',
  'refused',
] as const;
export type QuoteAcceptOutcome = (typeof QUOTE_ACCEPT_OUTCOMES)[number];

export const quoteAccepts = () =>
  meter().createCounter('motorfix_quote_accepts_total', {
    description: 'Quotes drivers accepted, by outcome',
  });

// One count per acceptance a driver tries, by outcome; never who or which.
export function recordQuoteAccept(outcome: QuoteAcceptOutcome) {
  quoteAccepts().add(1, { outcome });
}

export const QUOTE_DECLINE_OUTCOMES = [
  'declined',
  'invalid_transition',
  'refused',
] as const;
export type QuoteDeclineOutcome = (typeof QUOTE_DECLINE_OUTCOMES)[number];

export const quoteDeclines = () =>
  meter().createCounter('motorfix_quote_declines_total', {
    description: 'Quotes drivers declined, by outcome',
  });

// One count per decline a driver tries, by outcome; never who or which.
export function recordQuoteDecline(outcome: QuoteDeclineOutcome) {
  quoteDeclines().add(1, { outcome });
}

export const BOOKING_CONFIRM_OUTCOMES = [
  'confirmed',
  'mechanic_busy',
  'lift_busy',
  'outside_hours',
  'mechanic_unavailable',
  'invalid_transition',
  'slot_taken',
  'refused',
] as const;
export type BookingConfirmOutcome = (typeof BOOKING_CONFIRM_OUTCOMES)[number];

export const bookingConfirms = () =>
  meter().createCounter('motorfix_booking_confirms_total', {
    description: 'Bookings garages tried to confirm, by outcome',
  });

// One count per confirmation a garage tries, by outcome and, for a refusal
// that names its cause, by its reason; never who or which.
export function recordBookingConfirm(
  outcome: BookingConfirmOutcome,
  reason?: string,
) {
  bookingConfirms().add(1, reason ? { outcome, reason } : { outcome });
}

// Whether the request went back to `quoted` or closed with no quote left.
export const BOOKING_LAPSE_REQUESTS = ['quoted', 'closed'] as const;
export type BookingLapseRequest = (typeof BOOKING_LAPSE_REQUESTS)[number];

export const bookingLapses = () =>
  meter().createCounter('motorfix_booking_lapses_total', {
    description:
      'Bookings that lapsed unconfirmed, by where the request went and whether the sweep ran them',
  });

// One count per lapse, by its request's next state and whether the sweep ran
// it, a lost timer's sign; never which booking.
export function recordBookingLapse(
  request: BookingLapseRequest,
  sweep: boolean,
) {
  bookingLapses().add(1, { request, sweep: String(sweep) });
}

// What a request's or a quote's timer did: a reminder sent or muted, a
// garage's wait expired, a request closed, a quote expired or held by a
// booking awaiting confirmation.
const REQUEST_TIMER_STEPS = [
  'reminder_sent',
  'reminder_muted',
  'recipient_expired',
  'request_closed',
  'quote_expired',
  'quote_held',
] as const;
export type RequestTimerStep = (typeof REQUEST_TIMER_STEPS)[number];

const requestTimers = () =>
  meter().createCounter('motorfix_request_timers_total', {
    description:
      'What the request and quote timers did, by step and whether the sweep ran them',
  });

// One count per step, by whether the sweep ran it, a lost timer's sign;
// never which request, garage or quote.
export function recordRequestTimer(step: RequestTimerStep, sweep: boolean) {
  requestTimers().add(1, { step, sweep: String(sweep) });
}

// Each request or booking a closed account's clean-up found open, by what
// happened to it; never whose.
export const ACCOUNT_CLOSED_SERIES = [
  { kind: 'request', outcome: 'closed' },
  { kind: 'request', outcome: 'skipped' },
  { kind: 'request', outcome: 'failed' },
  { kind: 'booking', outcome: 'cancelled' },
  { kind: 'booking', outcome: 'skipped' },
] as const;
type AccountClosedSeries = (typeof ACCOUNT_CLOSED_SERIES)[number];

export const accountClosedCleanups = () =>
  meter().createCounter('motorfix_account_closed_cleanups_total', {
    description:
      'Requests and bookings a deleted or suspended account left open, by what the clean-up did',
  });

export function recordAccountClosedCleanup<
  K extends AccountClosedSeries['kind'],
>(kind: K, outcome: Extract<AccountClosedSeries, { kind: K }>['outcome']) {
  accountClosedCleanups().add(1, { kind, outcome });
}

// Each cancel a driver tries, by what was cancelled, whether it went through
// and whether it came late; never who or which.
type CancellationKind = 'request' | 'booking';
type CancellationOutcome = 'cancelled' | 'refused';

const cancellations = () =>
  meter().createCounter('motorfix_cancellations_total', {
    description:
      'Requests and bookings drivers tried to cancel, by kind, outcome and lateness',
  });

export function recordCancellation(
  kind: CancellationKind,
  outcome: CancellationOutcome,
  late: boolean,
) {
  cancellations().add(1, { kind, late: String(late), outcome });
}
