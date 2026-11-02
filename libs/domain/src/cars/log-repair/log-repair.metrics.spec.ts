import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';

import { recordLogged } from './log-repair.metrics';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const name = 'motorfix_repairs_logged_total';
const total = (labels: Record<string, string>) =>
  counterTotal(memory.metricReader, name, labels);

// @traces 062-FR-011
describe('the logged repair counter', () => {
  it.each([
    ['saved', 'none'],
    ['check_needed', 'future_date'],
    ['check_needed', 'odometer_below_earlier'],
    ['check_needed', 'both'],
    ['date_before_car_year', 'none'],
    ['unknown_garage', 'none'],
  ] as const)(
    'counts a log answered %s with check %s',
    async (outcome, check) => {
      const before = await total({ check, outcome });

      recordLogged(outcome, check);

      expect(await total({ check, outcome })).toBe(before + 1);
    },
  );

  it('labels every outcome but check_needed with check none', async () => {
    const saved = await total({ check: 'none', outcome: 'saved' });

    recordLogged('saved');

    expect(await total({ check: 'none', outcome: 'saved' })).toBe(saved + 1);
  });
});
