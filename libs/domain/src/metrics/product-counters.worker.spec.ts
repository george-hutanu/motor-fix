import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import { initProductCounters } from './product-counters';
import { TEMPLATES } from '../notifications/templates/registry';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

async function series() {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name.startsWith('motorfix_'))
    .flatMap((metric) =>
      (metric.dataPoints as DataPoint<number>[]).map((point) => ({
        labels: point.attributes,
        name: metric.descriptor.name,
        value: point.value,
      })),
    );
}

const named = (all: Awaited<ReturnType<typeof series>>, name: string) =>
  all.filter((one) => one.name === name);

// @traces 1345-FR-012 1345-FR-013
describe("the worker's product counters at start", () => {
  it('holds every series the worker counts at 0, and no sign-in', async () => {
    initProductCounters('worker');

    const all = await series();
    const emails = Object.values(TEMPLATES).filter((text) => text.email);
    expect(named(all, 'motorfix_emails_sent_total')).toHaveLength(
      emails.length,
    );
    expect(all).toHaveLength(emails.length + 22);
    expect(all.filter((one) => one.value !== 0)).toEqual([]);
    expect(named(all, 'motorfix_sign_ins_total')).toEqual([]);
  });

  it('holds the verification results and every closed decline window at 0', async () => {
    initProductCounters('worker');

    const all = await series();
    expect(
      named(all, 'motorfix_verification_result_total').map((one) => one.value),
    ).toEqual([0, 0]);
    const windows = named(all, 'motorfix_decline_windows_closed_total');
    expect(windows).toHaveLength(10);
    const sweeps = new Map<unknown, unknown[]>();
    for (const { labels } of windows) {
      sweeps.set(labels['outcome'], [
        ...(sweeps.get(labels['outcome']) ?? []),
        labels['sweep'],
      ]);
    }
    expect([...sweeps.values()].map((both) => both.sort())).toEqual(
      Array.from({ length: 5 }, () => ['false', 'true']),
    );
  });
});
