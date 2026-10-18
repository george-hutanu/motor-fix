import {
  CONSENT_DECISIONS,
  DECLINE_REASON_CODES,
  DOCUMENT_KINDS,
  VERIFICATION_CHECK_KINDS,
  VERIFICATION_CHECK_RESULTS,
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

const WORKER_ONLY = [
  'motorfix_quotes_total',
  'motorfix_emails_sent_total',
  'motorfix_request_received_total',
  'motorfix_verification_result_total',
  'motorfix_quote_received_total',
  'motorfix_decline_windows_closed_total',
  'motorfix_garage_suspended_notices_total',
  'motorfix_support_emails_total',
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

// Every series the API starts: its own 86 (the decision refusals include
// note_required, reason_required and note_too_short; the rejections one per
// reason; the requests for more and the files sent again one each) and one
// per check kind and result.
const API_SERIES =
  86 + VERIFICATION_CHECK_KINDS.length * VERIFICATION_CHECK_RESULTS.length;

const named = (all: Awaited<ReturnType<typeof series>>, name: string) =>
  all.filter((one) => one.name === name);

// @traces 1345-FR-012 1345-FR-013 280-FR-023
describe("the API's product counters at start", () => {
  it('holds every series the API counts at 0, and none only the worker counts', async () => {
    initProductCounters('api');

    const all = await series();
    expect(all).toHaveLength(API_SERIES);
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
    expect(named(all, 'motorfix_verification_checks_total')).toHaveLength(
      VERIFICATION_CHECK_KINDS.length * VERIFICATION_CHECK_RESULTS.length,
    );
    // @traces 303-FR-010
    expect(
      named(all, 'motorfix_verification_decision_refusals_total').map(
        (one) => one.labels['reason'],
      ),
    ).toEqual(
      expect.arrayContaining([
        'note_required',
        'reason_required',
        'note_too_short',
      ]),
    );
    // @traces 305-FR-009
    expect(
      named(all, 'motorfix_verification_rejections_total').map(
        (one) => one.labels['reason'],
      ),
    ).toEqual(['documents', 'rar', 'address', 'photos', 'other']);
    // @traces 304-request-garage-details-FR-012
    expect(
      [
        ...named(all, 'motorfix_verification_more_requests_total'),
        ...named(all, 'motorfix_verification_resubmissions_total'),
      ].map((one) => one.labels),
    ).toEqual([{}, {}]);
    expect(named(all, 'motorfix_request_declines_total')).toHaveLength(
      4 * DECLINE_REASON_CODES.length,
    );
    expect(
      named(all, 'motorfix_support_messages_total').map(
        (one) => one.labels['outcome'],
      ),
    ).toEqual(['stored', 'refused_limit', 'trap', 'invalid']);
    // 1345-FR-012: each instance stays under 150 series.
    expect(all.length).toBeLessThan(150);
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
    expect(await series()).toHaveLength(API_SERIES);
  });
});
