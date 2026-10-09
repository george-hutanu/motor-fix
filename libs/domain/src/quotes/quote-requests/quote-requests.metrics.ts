import { metrics } from '@opentelemetry/api';

export type SendOutcome = 'sent' | 'cannot_receive' | 'limit' | 'invalid';

// One count per quote request a driver sends, by outcome; a sent one also
// says how many garages it went to. The counter is looked up on every count:
// one kept from before the meter provider is registered stays a no-op.
export function recordSend(outcome: SendOutcome, recipients?: number) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_quote_requests_sent_total', {
      description: 'Quote requests drivers sent, by outcome and recipients',
    })
    .add(1, { outcome, ...(recipients !== undefined && { recipients }) });
}
