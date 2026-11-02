import { metrics } from '@opentelemetry/api';

import { observeDataStores } from './observe';

// @traces 878-FR-011
describe('observeDataStores while telemetry is off', () => {
  it('reads nothing, creates no instrument and starts no timer', async () => {
    const meter = vi.spyOn(metrics, 'getMeter');
    const interval = vi.spyOn(global, 'setInterval');
    const postgres = { query: vi.fn() };
    const redis = { info: vi.fn() };
    const outbox = { oldestPendingSeconds: vi.fn() };

    const stop = observeDataStores({ outbox, postgres, redis });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(postgres.query).not.toHaveBeenCalled();
    expect(redis.info).not.toHaveBeenCalled();
    expect(outbox.oldestPendingSeconds).not.toHaveBeenCalled();
    expect(meter).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});
