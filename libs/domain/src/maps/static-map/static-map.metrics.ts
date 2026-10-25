import { metrics } from '@opentelemetry/api';

export type RenderOutcome = 'ok' | 'invalid' | 'tiles_failed';

// Looked up on every count: an instrument kept from before the meter provider
// is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

// One count per answer by outcome, and the time of each render; a refused
// query renders nothing and has no time.
export function recordRender(outcome: RenderOutcome, seconds?: number) {
  meter()
    .createCounter('motorfix_static_map_renders_total', {
      description: 'Static map image answers, by outcome',
    })
    .add(1, { outcome });
  if (seconds === undefined) return;
  meter()
    .createHistogram('motorfix_static_map_render_duration_seconds', {
      advice: { explicitBucketBoundaries: [0.25, 0.5, 1, 2, 3, 5] },
      description:
        'Time a static map image took to render, tiles included, drawn or failed',
      unit: 's',
    })
    .record(seconds);
}
