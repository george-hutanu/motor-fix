import { metrics } from '@opentelemetry/api';

type StartOutcome =
  | 'started'
  | 'refused'
  | 'provider_failed'
  | 'unavailable'
  | 'stopped';
type RecordingOutcome = 'discarded' | 'discard_failed';
type CloseOutcome = 'closed' | 'close_failed';
type ViewOutcome = 'issued' | 'refused' | 'ended' | 'unavailable';
type Operation =
  | 'create_input'
  | 'close_input'
  | 'delete_recording'
  | 'input_status';

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

export function countLiveRecording(outcome: RecordingOutcome) {
  meter()
    .createCounter('motorfix_live_recordings_total', {
      description:
        'Live recording deletes at the provider, the API at the stop and the worker after it, by outcome',
    })
    .add(1, { outcome });
}

export function countLiveInputClose(outcome: CloseOutcome) {
  meter()
    .createCounter('motorfix_live_input_closes_total', {
      description: 'Live input closes at the provider after a stop, by outcome',
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

export function countLiveIdleStop() {
  meter()
    .createCounter('motorfix_live_idle_stops_total', {
      description: 'Live sessions stopped after ten minutes with no publisher',
    })
    .add(1);
}

export function recordIdleCheck(seconds: number) {
  meter()
    .createHistogram('motorfix_live_idle_check_seconds', {
      advice: { explicitBucketBoundaries: [0.1, 0.5, 1, 5, 15, 30, 60] },
      description: 'Time one idle check of every live session took',
      unit: 's',
    })
    .record(seconds);
}
