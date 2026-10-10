import { metrics } from '@opentelemetry/api';

export type QuoteSendOutcome =
  | 'sent'
  | 'refused'
  | 'already_answered'
  | 'request_not_open';

// Looked up on every count, never cached: an instrument kept from before the
// meter provider is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

// One count per quote a garage sends, by outcome; a sent one also records
// how long the request waited for it, in minutes.
export function recordQuoteSend(outcome: QuoteSendOutcome, minutes?: number) {
  meter()
    .createCounter('motorfix_quotes_sent_total', {
      description: 'Quotes garages sent, by outcome',
    })
    .add(1, { outcome });
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

export type RequestDeclineOutcome =
  | 'declined'
  | 'already_answered'
  | 'request_not_open'
  | 'invalid';

// One count per decline a garage tries, by outcome and reason; never who.
export function recordRequestDecline(
  outcome: RequestDeclineOutcome,
  reason: string,
) {
  meter()
    .createCounter('motorfix_request_declines_total', {
      description: 'Requests garages declined, by outcome and reason',
    })
    .add(1, { outcome, reason });
}

export type DeclineWindowOutcome =
  | 'sent'
  | 'muted'
  | 'skipped_undone'
  | 'skipped_closed'
  | 'already_told';

// One count per decline window the worker closes, by outcome, and whether
// the sweep found it rather than its own timer.
export function recordDeclineWindow(
  outcome: DeclineWindowOutcome,
  sweep: boolean,
) {
  meter()
    .createCounter('motorfix_decline_windows_closed_total', {
      description: 'Decline undo windows closed, by outcome',
    })
    .add(1, { outcome, sweep: String(sweep) });
}
