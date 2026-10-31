import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';

import { recordEditRefusal } from './repairs.metrics';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const total = (name: string, labels: Record<string, string>) =>
  counterTotal(memory.metricReader, name, labels);

// @traces 061-FR-012
describe('the repair edit refusal counter', () => {
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
