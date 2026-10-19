import type { LiveCloseReason } from '@motor-fix/contracts';
import { metrics } from '@opentelemetry/api';

// Looked up on every count: a counter kept from before the meter provider is
// registered stays a no-op. No account, garage or address is ever a label.
const meter = () => metrics.getMeter('motorfix');

export type ReplayOutcome = 'none' | 'some' | 'capped';

// One count per replay a returning stream asked for, by what it found, and
// the rows it wrote.
export function countReplay(outcome: ReplayOutcome, rows: number) {
  meter()
    .createCounter('motorfix_live_replays_total', {
      description: 'Live stream replays, by what they found',
    })
    .add(1, { outcome });
  if (rows === 0) return;
  meter()
    .createCounter('motorfix_live_replayed_rows_total', {
      description: 'Notifications written by live stream replays',
    })
    .add(rows);
}

// One count per stream the server ends, by why.
export function countStreamClose(reason: LiveCloseReason) {
  meter()
    .createCounter('motorfix_live_stream_closes_total', {
      description: 'Live streams the server ended, by reason',
    })
    .add(1, { reason });
}
