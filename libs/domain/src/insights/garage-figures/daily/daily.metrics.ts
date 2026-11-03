import { metrics } from '@opentelemetry/api';

// One count per daily read answered without its free starts. Looked up on
// every count: a counter kept from before the meter provider is registered
// stays a no-op.
export function recordTodayFiguresFallback() {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_today_figures_fallbacks_total', {
      description: 'Daily figures answered without the free starts',
    })
    .add(1);
}
