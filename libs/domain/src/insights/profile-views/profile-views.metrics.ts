import { metrics } from '@opentelemetry/api';

export type ViewOutcome =
  | 'accepted'
  | 'bot'
  | 'staff'
  | 'no_key'
  | 'lost'
  | 'throttled'
  | 'not_found';

// Looked up on every count: an instrument kept from before the meter provider
// is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

export function recordView(outcome: ViewOutcome) {
  meter()
    .createCounter('motorfix_profile_views_total', {
      description: 'Profile view beacons, by what became of them',
    })
    .add(1, { outcome });
}

export function recordRows(outcome: 'written' | 'gap', count: number) {
  if (count === 0) return;
  meter()
    .createCounter('motorfix_profile_view_rows_total', {
      description:
        'Daily profile view rows the night wrote, and days it missed',
    })
    .add(count, { outcome });
}
