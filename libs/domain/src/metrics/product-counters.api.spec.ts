import {
  CONSENT_DECISIONS,
  DECLINE_REASON_CODES,
  DOCUMENT_KINDS,
} from '@motor-fix/contracts';
import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import { countSignIn, initProductCounters } from './product-counters';

// A file of its own: the worker's series are read in another, each with a
// meter that has counted nothing before the series start.
const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const SEVEN_COUNTERS = [
  'motorfix_searches_total',
  'motorfix_sign_ins_total',
  'motorfix_garage_sign_ups_total',
  'motorfix_garage_approvals_total',
  'motorfix_quotes_total',
  'motorfix_emails_sent_total',
  'motorfix_notifications_sent_total',
];

const WORKER_ONLY = [
  'motorfix_quotes_total',
  'motorfix_emails_sent_total',
  'motorfix_request_received_total',
  'motorfix_verification_result_total',
  'motorfix_quote_received_total',
  'motorfix_decline_windows_closed_total',
];

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
describe("the API's product counters at start", () => {
  it('holds every series the API counts at 0, and none only the worker counts', async () => {
    initProductCounters('api');

    const all = await series();
    expect(all).toHaveLength(63);
    expect(all.filter((one) => one.value !== 0)).toEqual([]);
    expect(all.filter((one) => WORKER_ONLY.includes(one.name))).toEqual([]);
    expect(
      named(all, 'motorfix_notifications_sent_total').map((one) => one.labels),
    ).toEqual([{ channel: 'in-app' }]);
    expect(named(all, 'motorfix_documents_uploaded_total')).toHaveLength(
      DOCUMENT_KINDS.length,
    );
    expect(named(all, 'motorfix_consent_records_total')).toHaveLength(
      CONSENT_DECISIONS.length,
    );
    expect(named(all, 'motorfix_request_declines_total')).toHaveLength(
      4 * DECLINE_REASON_CODES.length,
    );
    expect(
      all.filter((one) => SEVEN_COUNTERS.includes(one.name)).length,
    ).toBeLessThan(50);
    expect(all.length).toBeLessThan(100);
  });

  it('holds the approvals and the documents opened at 0, though nothing reaches them on staging', async () => {
    initProductCounters('api');

    const all = await series();
    expect(
      named(all, 'motorfix_garage_approvals_total').map((one) => one.value),
    ).toEqual([0, 0]);
    expect(
      named(all, 'motorfix_documents_opened_total').map((one) => one.value),
    ).toEqual(DOCUMENT_KINDS.map(() => 0));
  });

  it('turns a 0 into 1 on the first count, adding no series', async () => {
    initProductCounters('api');

    countSignIn('google');

    expect(
      await counterTotal(memory.metricReader, 'motorfix_sign_ins_total', {
        method: 'google',
      }),
    ).toBe(1);
    expect(await series()).toHaveLength(63);
  });
});
