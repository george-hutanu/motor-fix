import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';

import { ADMIN_SCOPE } from './client-repairs';
import { recordCorrection } from './client-repairs.metrics';
import { ClientRepairsService } from './client-repairs.service';
import type { Actor } from '../../auth/policy';

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

  // @traces 1267-FR-010
  it('counts nothing for a caller refused before the correction runs', async () => {
    const driver: Actor = {
      accountId: 'account-a',
      garageId: null,
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      role: 'driver',
      roles: ['driver'],
    };
    const service = new ClientRepairsService(
      {} as never,
      {} as never,
      {} as never,
    );
    const before = await total({ by: 'owner', outcome: 'not_found' });

    await expect(
      service.correct(driver, ADMIN_SCOPE, 'repair-a', {
        version: '2026-10-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(await total({ by: 'owner', outcome: 'not_found' })).toBe(before);
  });
});
