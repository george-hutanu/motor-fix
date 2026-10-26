import { metrics } from '@opentelemetry/api';

type StartOutcome = 'started' | 'refused' | 'provider_failed' | 'unavailable';
type ViewOutcome = 'issued' | 'refused' | 'ended';
type Operation = 'create_input' | 'close_input';

// Looked up on every count: an instrument kept from before the meter provider
// is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

export function countLiveSession(outcome: StartOutcome) {
  meter()
    .createCounter('motorfix_live_sessions_total', {
      description: 'Live stream starts, by outcome',
    })
    .add(1, { outcome });
}

export function countViewToken(outcome: ViewOutcome) {
  meter()
    .createCounter('motorfix_live_view_tokens_total', {
      description: 'Live view credentials asked for, by outcome',
    })
    .add(1, { outcome });
}

export function recordProviderCall(
  provider: string,
  operation: Operation,
  seconds: number,
) {
  meter()
    .createHistogram('motorfix_live_provider_duration_seconds', {
      advice: { explicitBucketBoundaries: [0.1, 0.25, 0.5, 1, 2, 3, 5] },
      description: 'Time the live video provider took to answer',
      unit: 's',
    })
    .record(seconds, { operation, provider });
}
