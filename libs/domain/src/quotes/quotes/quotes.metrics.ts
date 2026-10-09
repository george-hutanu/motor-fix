import { metrics } from '@opentelemetry/api';

export type QuoteSendOutcome =
  | 'sent'
  | 'refused'
  | 'already_answered'
  | 'request_not_open';

const meter = () => metrics.getMeter('motorfix');

let sends: ReturnType<ReturnType<typeof meter>['createCounter']> | undefined;
let response:
  | ReturnType<ReturnType<typeof meter>['createHistogram']>
  | undefined;

// One count per quote a garage sends, by outcome; a sent one also records
// how long the request waited for it, in minutes.
export function recordQuoteSend(outcome: QuoteSendOutcome, minutes?: number) {
  sends ??= meter().createCounter('motorfix_quotes_sent_total', {
    description: 'Quotes garages sent, by outcome',
  });
  response ??= meter().createHistogram('motorfix_quote_response_minutes', {
    advice: {
      explicitBucketBoundaries: [
        5, 15, 30, 60, 180, 360, 720, 1440, 2880, 10080,
      ],
    },
    description: 'Time from a request being sent to a garage quoting it',
    unit: 'min',
  });
  sends.add(1, { outcome });
  if (minutes !== undefined) response.record(minutes);
}
