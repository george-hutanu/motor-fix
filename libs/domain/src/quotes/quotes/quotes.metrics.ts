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
