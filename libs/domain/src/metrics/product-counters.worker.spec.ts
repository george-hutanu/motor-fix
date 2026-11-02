import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import { countRetention, initProductCounters } from './product-counters';
import { TEMPLATES } from '../notifications/templates/registry';
import { RETENTION_KINDS } from '../retention/retention.config';

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

const SUPPORT_EMAILS = ['support', 'acknowledgement'].flatMap((kind) =>
  ['sent', 'blocked', 'failed', 'unconfigured'].map((outcome) => [
    kind,
    outcome,
  ]),
);

const named = (all: Awaited<ReturnType<typeof series>>, name: string) =>
  all.filter((one) => one.name === name);

// @traces 1345-FR-012 1345-FR-013 280-FR-023
describe("the worker's product counters at start", () => {
  it('holds every series the worker counts at 0, and no sign-in', async () => {
    initProductCounters('worker');

    const all = await series();
    const emails = Object.entries(TEMPLATES).filter(
      ([name, text]) => text.email && !name.startsWith('REVIEW_DECIDED.'),
    );
    expect(named(all, 'motorfix_emails_sent_total')).toHaveLength(
      emails.length,
    );
    // @traces 179-FR-019
    expect(
      named(all, 'motorfix_emails_sent_total').filter((one) =>
        String(one.labels['template']).startsWith('REVIEW_DECIDED.'),
      ),
    ).toEqual([]);
    // Its own 62, one per e-mailed template, and one per support e-mail kind
    // and outcome.
    expect(all).toHaveLength(emails.length + 62 + SUPPORT_EMAILS.length);
    // @traces 067-FR-013
    expect(
      named(all, 'motorfix_garage_restored_notices_total').map(
        (one) => one.labels['outcome'],
      ),
    ).toEqual(['built', 'skipped']);
    // @traces 068-FR-016
    expect(
      named(all, 'motorfix_document_cycle_total').map(
        (one) => one.labels['step'],
      ),
    ).toEqual(['reminded_30', 'reminded_7', 'reminded_0', 'overdue']);
    // @traces 428-FR-012
    expect(
      named(all, 'motorfix_account_closed_cleanups_total').map((one) => [
        one.labels['kind'],
        one.labels['outcome'],
      ]),
    ).toEqual([
      ['request', 'closed'],
      ['request', 'skipped'],
      ['request', 'failed'],
      ['booking', 'cancelled'],
      ['booking', 'skipped'],
    ]);
    // @traces 069-FR-011
    expect(
      named(all, 'motorfix_garage_report_decided_notices_total').map(
        (one) => one.labels['outcome'],
      ),
    ).toEqual(['built', 'skipped']);
    expect(all.filter((one) => one.value !== 0)).toEqual([]);
    expect(
      named(all, 'motorfix_support_emails_total').map((one) => [
        one.labels['kind'],
        one.labels['outcome'],
      ]),
    ).toEqual(SUPPORT_EMAILS);
    expect(named(all, 'motorfix_support_messages_total')).toEqual([]);
    // Each instance stays under 150 series.
    expect(all.length).toBeLessThan(150);
    expect(named(all, 'motorfix_sign_ins_total')).toEqual([]);
    // @traces 142-FR-008
    expect(
      named(all, 'motorfix_notification_channel_fallbacks_total').map((one) => [
        one.labels['from'],
        one.labels['to'],
        one.labels['reason'],
      ]),
    ).toEqual([
      ['sms', 'whatsapp', 'sms_cap_reached'],
      ['sms', 'whatsapp', 'send_failed'],
      ['sms', 'email', 'phone_not_verified'],
      ['sms', 'email', 'send_failed'],
      ['whatsapp', 'email', 'phone_not_verified'],
      ['whatsapp', 'email', 'send_failed'],
      ['push', 'email', 'no_device'],
      ['push', 'email', 'send_failed'],
      ['email', 'push', 'send_failed'],
    ]);
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

// @traces 1156-FR-010
describe('the retention counter', () => {
  it('starts every kind at 0 and adds what a run removed or anonymised', async () => {
    initProductCounters('worker');
    const rows = async () =>
      named(await series(), 'motorfix_retention_rows_total').map((one) => [
        one.labels['kind'],
        one.value,
      ]);
    expect(await rows()).toEqual(RETENTION_KINDS.map((kind) => [kind, 0]));

    countRetention('notification', 3);
    countRetention('notification', 2);
    countRetention('audit_entry', 0);

    expect(await rows()).toEqual(
      RETENTION_KINDS.map((kind) => [kind, kind === 'notification' ? 5 : 0]),
    );
  });
});
