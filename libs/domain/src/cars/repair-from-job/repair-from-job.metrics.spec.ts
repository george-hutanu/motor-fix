import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';

import {
  recordEditRefusal,
  recordRepairFromJob,
} from './repair-from-job.metrics';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const total = (name: string, labels: Record<string, string>) =>
  counterTotal(memory.metricReader, name, labels);

// @traces 061-FR-012
describe('the repair-from-job counters', () => {
  it.each(['created', 'cost_updated', 'unchanged', 'job_missing'] as const)(
    'counts a run that ended %s',
    async (outcome) => {
      const name = 'motorfix_repairs_from_jobs_total';
      const before = await total(name, { outcome });

      recordRepairFromJob(outcome);

      expect(await total(name, { outcome })).toBe(before + 1);
    },
  );

  it.each(['motorfix_repair', 'not_implemented'] as const)(
    'counts an edit refused with %s, apart from the other code',
    async (code) => {
      const name = 'motorfix_repair_edit_refusals_total';
      const other =
        code === 'motorfix_repair' ? 'not_implemented' : 'motorfix_repair';
      const before = await total(name, { code });
      const otherBefore = await total(name, { code: other });

      recordEditRefusal(code);

      expect(await total(name, { code })).toBe(before + 1);
      expect(await total(name, { code: other })).toBe(otherBefore);
    },
  );
});
