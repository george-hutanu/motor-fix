import { metrics } from '@opentelemetry/api';

export type SendOutcome = 'sent' | 'cannot_receive' | 'limit' | 'invalid';

let sends:
  | ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']>
  | undefined;

// One count per quote request a driver sends, by outcome; a sent one also
// says how many garages it went to.
export function recordSend(outcome: SendOutcome, recipients?: number) {
  sends ??= metrics
    .getMeter('motorfix')
    .createCounter('motorfix_quote_requests_sent_total', {
      description: 'Quote requests drivers sent, by outcome and recipients',
    });
  sends.add(1, { outcome, ...(recipients !== undefined && { recipients }) });
}
