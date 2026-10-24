import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import { countChannelChoice, countChannelFallback } from './product-counters';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

async function series(name: string) {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) =>
      (metric.dataPoints as DataPoint<number>[]).map((point) => ({
        labels: point.attributes,
        value: point.value,
      })),
    );
}

const CHOICES = 'motorfix_notification_channel_choices_total';
const FALLBACKS = 'motorfix_notification_channel_fallbacks_total';

// @traces 142-FR-008
describe('the channel counters under hostile labels', () => {
  it('writes one series labelled only by channel for a pick', async () => {
    countChannelChoice('sms');
    const found = await series(CHOICES);
    expect(found).toEqual([{ labels: { channel: 'sms' }, value: 1 }]);
  });

  it('adds up repeated picks of one channel in one series', async () => {
    countChannelChoice('sms');
    countChannelChoice('sms');
    const sms = (await series(CHOICES)).filter(
      (s) => s.labels['channel'] === 'sms',
    );
    expect(sms).toEqual([{ labels: { channel: 'sms' }, value: 3 }]);
  });

  it('does not open a series for a channel outside the fixed set', async () => {
    countChannelChoice('+40712345678' as never);
    countChannelChoice('' as never);
    const channels = (await series(CHOICES)).map((s) => s.labels['channel']);
    expect(
      channels.every((c) =>
        ['email', 'push', 'sms', 'whatsapp'].includes(String(c)),
      ),
    ).toBe(true);
  });

  it('writes a fallback with exactly from, reason and to', async () => {
    countChannelFallback('sms', 'whatsapp', 'sms_cap_reached');
    const found = await series(FALLBACKS);
    expect(found).toContainEqual({
      labels: { from: 'sms', reason: 'sms_cap_reached', to: 'whatsapp' },
      value: 1,
    });
  });

  it('does not open a series for a reason or channel outside the fixed sets', async () => {
    countChannelFallback('sms', 'whatsapp', 'user@example.com' as never);
    countChannelFallback('driver-1f3a' as never, 'email', 'send_failed');
    const found = await series(FALLBACKS);
    const reasons = [
      'no_device',
      'phone_not_verified',
      'send_failed',
      'sms_cap_reached',
    ];
    const channels = ['email', 'push', 'sms', 'whatsapp'];
    for (const { labels } of found) {
      expect(reasons).toContain(labels['reason']);
      expect(channels).toContain(labels['from']);
      expect(channels).toContain(labels['to']);
    }
  });
});
