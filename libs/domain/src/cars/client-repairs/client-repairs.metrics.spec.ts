import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';

import { recordCorrection } from './client-repairs.metrics';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const name = 'motorfix_repair_corrections_total';
const total = (labels: Record<string, string>) =>
  counterTotal(memory.metricReader, name, labels);

// @traces 409-FR-016
describe('the repair correction counter', () => {
  it.each(['corrected', 'unchanged', 'stale', 'not_found'] as const)(
    'counts a correction by the garage answered %s',
    async (outcome) => {
      const labels = { by: 'owner', outcome };
      const before = await total(labels);

      recordCorrection('owner', outcome);

      expect(await total(labels)).toBe(before + 1);
    },
  );

  it('keeps an admin correction apart from the garage’s', async () => {
    const owner = await total({ by: 'owner', outcome: 'corrected' });
    const admin = await total({ by: 'admin', outcome: 'corrected' });

    recordCorrection('admin', 'corrected');

    expect(await total({ by: 'admin', outcome: 'corrected' })).toBe(admin + 1);
    expect(await total({ by: 'owner', outcome: 'corrected' })).toBe(owner);
  });
});
