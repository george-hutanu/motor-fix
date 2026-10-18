import { diag } from '@opentelemetry/api';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import { observeDataStores } from './observe';
import { startTelemetry } from '../setup/start';
import { inMemory } from '../testing/in-memory';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const GOOD =
  'jvm_memory_used_bytes{area="heap",id="a"} 5.0E7\njvm_memory_max_bytes{area="heap",id="a"} 1.0E9\n';
const INFO = 'used_memory:1\r\nmaxmemory:0\r\nconnected_clients:1\r\n';
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  jest.restoreAllMocks();
});

const base = {
  outbox: { oldestPendingSeconds: async () => 1 },
  redis: { info: async () => INFO },
};
function observe(keycloak: { metrics(): Promise<string> }) {
  stops.push(observeDataStores({ ...base, intervalMs: 20, keycloak }));
}
async function points(name: string) {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<number>[])
    .map((point) => ({ attributes: point.attributes, value: point.value }));
}
const up = async (store: string) =>
  (await points('motorfix_datastore_up')).find(
    (p) => p.attributes['store'] === store,
  )?.value;

// @traces 1178-FR-007
describe('the Keycloak reading under hostile answers', () => {
  it('publishes no heap sample, never zero, when a body has used but only -1 maxima', async () => {
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      metrics: async () =>
        'jvm_memory_used_bytes{area="heap"} 5\njvm_memory_max_bytes{area="heap"} -1.0',
    });
    await tick(10);
    expect(await up('keycloak')).toBe(0);
    expect(await points('motorfix_keycloak_heap_used_bytes')).toEqual([]);
    expect(await points('motorfix_keycloak_heap_max_bytes')).toEqual([]);
    expect(await up('redis')).toBe(1);
  });

  it('keeps no stale heap figure when the next body is bad', async () => {
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    let n = 0;
    observe({ metrics: async () => (n++ === 0 ? GOOD : '<html></html>') });
    await tick(5);
    expect(await points('motorfix_keycloak_heap_used_bytes')).toHaveLength(1);
    await tick(60);
    expect(await points('motorfix_keycloak_heap_used_bytes')).toEqual([]);
    expect(await up('keycloak')).toBe(0);
  });

  it('logs a bad body once per streak without the body', async () => {
    const error = jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({ metrics: async () => 'SECRET-BODY-TEXT' });
    await tick(100);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).not.toContain('SECRET-BODY-TEXT');
  });

  it('does not log the address when a reader fails with it in the message', async () => {
    const error = jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      metrics: async () => {
        throw new Error(
          'failed http://admin:hunter2@keycloak.internal:9000/metrics',
        );
      },
    });
    await tick(10);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).not.toContain('hunter2');
  });

  it('never has two Keycloak reads in flight at once', async () => {
    let inflight = 0;
    let peak = 0;
    observe({
      metrics: async () => {
        inflight += 1;
        peak = Math.max(peak, inflight);
        await tick(50);
        inflight -= 1;
        return GOOD;
      },
    });
    await tick(150);
    expect(peak).toBe(1);
  });
});
