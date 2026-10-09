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
