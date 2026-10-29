import type { MediaKind } from '@motor-fix/contracts';
import { metrics } from '@opentelemetry/api';

type ItemOutcome = 'visible' | 'failed' | 'refused';

// Looked up on every count: an instrument kept from before the meter provider
// is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

export function countMediaItem(kind: MediaKind, outcome: ItemOutcome) {
  meter()
    .createCounter('motorfix_media_items_total', {
      description: 'Job photos, clips and recordings, by how they ended',
    })
    .add(1, { kind, outcome });
}

export function countMediaPurged(kind: MediaKind, count = 1) {
  meter()
    .createCounter('motorfix_media_purged_total', {
      description: 'Job media deleted by the nightly purge',
    })
    .add(count, { kind });
}

export function countRetentionStepFailure(step: string) {
  meter()
    .createCounter('motorfix_media_retention_step_failures_total', {
      description: 'Nightly media retention steps that threw',
    })
    .add(1, { step });
}

export function recordConversion(kind: MediaKind, seconds: number) {
  meter()
    .createHistogram('motorfix_media_conversion_seconds', {
      advice: { explicitBucketBoundaries: [1, 2, 5, 10, 20, 30, 60, 120, 300] },
      description: 'Time a job photo or clip took to convert',
      unit: 's',
    })
    .record(seconds, { kind });
}
