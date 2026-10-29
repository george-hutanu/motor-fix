import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import type { DataPoint, Histogram } from '@opentelemetry/sdk-metrics';

import {
  countLiveRecording,
  countLiveSession,
  countViewToken,
  recordProviderCall,
} from './sessions.metrics';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const total = (name: string, labels?: Record<string, string>) =>
  counterTotal(memory.metricReader, name, labels);

// @traces 1250-FR-009
describe('the live video counters', () => {
  it.each(['started', 'refused', 'provider_failed', 'unavailable'] as const)(
    'counts a start that %s',
    async (outcome) => {
      const name = 'motorfix_live_sessions_total';
      const before = await total(name, { outcome });

      countLiveSession(outcome);

      expect(await total(name, { outcome })).toBe(before + 1);
    },
  );

  it.each(['issued', 'refused', 'ended'] as const)(
    'counts a view credential %s',
    async (outcome) => {
      const name = 'motorfix_live_view_tokens_total';
      const before = await total(name, { outcome });

      countViewToken(outcome);

      expect(await total(name, { outcome })).toBe(before + 1);
    },
  );

  it('times each provider call by provider and operation, up to five seconds', async () => {
    recordProviderCall('fake', 'create_input', 0.3);
    recordProviderCall('fake', 'close_input', 0.1);

    const { resourceMetrics } = await memory.metricReader.collect();
    const histogram = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find(
        (m) => m.descriptor.name === 'motorfix_live_provider_duration_seconds',
      );
    const points = (histogram?.dataPoints ?? []) as DataPoint<Histogram>[];
    expect(
      points
        .map((p) => p.attributes)
        .sort((a, b) =>
          String(a['operation']).localeCompare(String(b['operation'])),
        ),
    ).toEqual([
      { operation: 'close_input', provider: 'fake' },
      { operation: 'create_input', provider: 'fake' },
    ]);
    expect(points[0]?.value.buckets.boundaries).toEqual([
      0.1, 0.25, 0.5, 1, 2, 3, 5,
    ]);
  });
});

// @traces 1251-FR-009
describe('the live stop counters', () => {
  it('counts a sender stop on the live sessions series', async () => {
    const name = 'motorfix_live_sessions_total';
    const before = await total(name, { outcome: 'stopped' });

    countLiveSession('stopped');

    expect(await total(name, { outcome: 'stopped' })).toBe(before + 1);
  });

  it.each(['discarded', 'discard_failed'] as const)(
    'counts a recording %s',
    async (outcome) => {
      const name = 'motorfix_live_recordings_total';
      const before = await total(name, { outcome });

      countLiveRecording(outcome);

      expect(await total(name, { outcome })).toBe(before + 1);
    },
  );
});
