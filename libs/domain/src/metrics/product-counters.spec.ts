import { CONSENT_DECISIONS, DOCUMENT_KINDS } from '@motor-fix/contracts';
import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import {
  countAccountChange,
  countApproval,
  countConsentRecord,
  countDeclarationSigned,
  countDocumentOpened,
  countDocumentUploaded,
  countEmail,
  countGarageReport,
  countGarageSignUp,
  countJobStep,
  countNotification,
  countQuote,
  countRequestReceived,
  countSearch,
  countSignIn,
  countSupportEmail,
  countSupportMessage,
  countSystemLogEntry,
  countVerificationResult,
} from './product-counters';
import { KINDS } from '../admin/system-log/entry';
import { TEMPLATES } from '../notifications/templates/registry';

const STEP_ACTIONS = [
  'added',
  'renamed',
  'reordered',
  'removed',
  'ticked',
  'unticked',
] as const;

const SUPPORT_MESSAGE_OUTCOMES = [
  'stored',
  'refused_limit',
  'trap',
  'invalid',
] as const;
const SUPPORT_EMAILS = (['support', 'acknowledgement'] as const).flatMap(
  (kind) =>
    (['sent', 'blocked', 'failed', 'unconfigured'] as const).map(
      (outcome) => [kind, outcome] as const,
    ),
);

const GARAGE_REPORT_OUTCOMES = [
  'created',
  'already_reported',
  'refused',
] as const;

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const total = (name: string, labels?: Record<string, string>) =>
  counterTotal(memory.metricReader, name, labels);

// @traces 879-FR-009 879-FR-010 879-FR-011
// @traces 424-FR-017
// @traces 312-FR-016
const ACCOUNT_FIELDS = ['name', 'city', 'email', 'phone', 'password'] as const;

const SEVEN_COUNTERS = [
  'motorfix_searches_total',
  'motorfix_sign_ins_total',
  'motorfix_garage_sign_ups_total',
  'motorfix_garage_approvals_total',
  'motorfix_quotes_total',
  'motorfix_emails_sent_total',
  'motorfix_notifications_sent_total',
];

// The counters only the worker records; every other one is the API's, or both's.
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

// Every series an instance can add, once each.
function countEverySeries() {
  for (const outcome of ['results', 'none'] as const) countSearch(outcome);
  for (const method of ['password', 'phone', 'google', 'apple'] as const)
    countSignIn(method);
  countGarageSignUp();
  for (const outcome of ['approved', 'rejected'] as const)
    countApproval(outcome);
  countQuote();
  // Only a template with an e-mail text is ever counted as an e-mail sent.
  for (const [template, text] of Object.entries(TEMPLATES)) {
    if (text.email) countEmail(template);
  }
  for (const channel of ['push', 'in-app'] as const) countNotification(channel);
  STEP_ACTIONS.forEach((action) => {
    countJobStep(action);
  });
  GARAGE_REPORT_OUTCOMES.forEach((outcome) => {
    countGarageReport(outcome);
  });
  DOCUMENT_KINDS.forEach((kind) => {
    countDocumentUploaded(kind);
    countDocumentOpened(kind);
  });
  countDeclarationSigned();
  CONSENT_DECISIONS.forEach((decision) => {
    countConsentRecord(decision);
  });
  ACCOUNT_FIELDS.forEach((field) => {
    countAccountChange(field);
  });
  (['built', 'skipped'] as const).forEach((outcome) => {
    countVerificationResult(outcome);
  });
  SUPPORT_MESSAGE_OUTCOMES.forEach((outcome) => {
    countSupportMessage(outcome);
  });
  SUPPORT_EMAILS.forEach(([kind, outcome]) => {
    countSupportEmail(kind, outcome);
  });
  for (const kind of KINDS) {
    for (const outcome of ['written', 'grouped', 'dropped'] as const)
      countSystemLogEntry(kind, outcome);
  }
}

// @traces 297-FR-014
describe('the system log counter', () => {
  it('counts one entry by kind and outcome', async () => {
    const before = await total('motorfix_system_log_entries_total', {
      kind: 'deploy',
      outcome: 'grouped',
    });
    countSystemLogEntry('deploy', 'grouped');
    expect(
      await total('motorfix_system_log_entries_total', {
        kind: 'deploy',
        outcome: 'grouped',
      }),
    ).toBe(before + 1);
  });
});

// @traces 206-FR-016
// @traces 244-FR-016 244-FR-018
// @traces 251-FR-018
// @traces 139-FR-019
// @traces 209-FR-014
// @traces 280-FR-021
describe('the product counters', () => {
  it.each([
    [
      () => countSearch('results'),
      'motorfix_searches_total',
      { outcome: 'results' },
    ],
    [() => countSearch('none'), 'motorfix_searches_total', { outcome: 'none' }],
    [
      () => countSignIn('password'),
      'motorfix_sign_ins_total',
      { method: 'password' },
    ],
    [
      () => countSignIn('phone'),
      'motorfix_sign_ins_total',
      { method: 'phone' },
    ],
    [
      () => countSignIn('google'),
      'motorfix_sign_ins_total',
      { method: 'google' },
    ],
    [
      () => countSignIn('apple'),
      'motorfix_sign_ins_total',
      { method: 'apple' },
    ],
    [() => countGarageSignUp(), 'motorfix_garage_sign_ups_total', {}],
    [
      () => countApproval('approved'),
      'motorfix_garage_approvals_total',
      { outcome: 'approved' },
    ],
    [
      () => countApproval('rejected'),
      'motorfix_garage_approvals_total',
      { outcome: 'rejected' },
    ],
    [() => countQuote(), 'motorfix_quotes_total', {}],
    [
      () => countEmail('SIGN_IN_CODE'),
      'motorfix_emails_sent_total',
      { template: 'SIGN_IN_CODE' },
    ],
    [
      () => countNotification('push'),
      'motorfix_notifications_sent_total',
      { channel: 'push' },
    ],
    [
      () => countNotification('in-app'),
      'motorfix_notifications_sent_total',
      { channel: 'in-app' },
    ],
    ...(
      [
        'added',
        'renamed',
        'reordered',
        'removed',
        'ticked',
        'unticked',
      ] as const
    ).map(
      (action) =>
        [
          () => countJobStep(action),
          'motorfix_job_steps_total',
          { action },
        ] as const,
    ),
    ...ACCOUNT_FIELDS.map(
      (field) =>
        [
          () => countAccountChange(field),
          'motorfix_account_changes_total',
          { field },
        ] as const,
    ),
    ...(['built', 'muted', 'skipped'] as const).map(
      (outcome) =>
        [
          () => countRequestReceived(outcome),
          'motorfix_request_received_total',
          { outcome },
        ] as const,
    ),
    ...(['built', 'skipped'] as const).map(
      (outcome) =>
        [
          () => countVerificationResult(outcome),
          'motorfix_verification_result_total',
          { outcome },
        ] as const,
    ),
    ...SUPPORT_MESSAGE_OUTCOMES.map(
      (outcome) =>
        [
          () => countSupportMessage(outcome),
          'motorfix_support_messages_total',
          { outcome },
        ] as const,
    ),
    ...SUPPORT_EMAILS.map(
      ([kind, outcome]) =>
        [
          () => countSupportEmail(kind, outcome),
          'motorfix_support_emails_total',
          { kind, outcome },
        ] as const,
    ),
    ...GARAGE_REPORT_OUTCOMES.map(
      (outcome) =>
        [
          () => countGarageReport(outcome),
          'motorfix_garage_reports_total',
          { outcome },
        ] as const,
    ),
    ...DOCUMENT_KINDS.flatMap((kind) => [
      [
        () => countDocumentUploaded(kind),
        'motorfix_documents_uploaded_total',
        { kind },
      ] as const,
      [
        () => countDocumentOpened(kind),
        'motorfix_documents_opened_total',
        { kind },
      ] as const,
    ]),
    [() => countDeclarationSigned(), 'motorfix_declarations_signed_total', {}],
    ...CONSENT_DECISIONS.map(
      (decision) =>
        [
          () => countConsentRecord(decision),
          'motorfix_consent_records_total',
          { decision },
        ] as const,
    ),
  ] as const)('counts one %#: %s', async (count, name, labels) => {
    const before = await total(name, labels);

    count();

    expect(await total(name, labels)).toBe(before + 1);
  });

  // The cap of 50 covers the seven counters the observability story added;
  // every later counter keeps its own fixed set, and each instance stays under
  // 100 series, far inside the metrics backend's free tier. The API is the
  // larger one: every series here but the worker's own; the worker's are
  // counted exactly in product-counters.worker.spec.ts.
  it('keeps the seven counters under 50 series and the instance under 100, every label from a fixed set', async () => {
    countEverySeries();

    const { resourceMetrics } = await memory.metricReader.collect();
    const series = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name.startsWith('motorfix_'))
      .flatMap((metric) =>
        (metric.dataPoints as DataPoint<number>[]).map((point) => ({
          name: metric.descriptor.name,
          text: `${metric.descriptor.name}${JSON.stringify(point.attributes)}`,
        })),
      );
    const texts = series.map((s) => s.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(
      series.filter((s) => SEVEN_COUNTERS.includes(s.name)).length,
    ).toBeLessThan(50);
    expect(
      series.filter((s) => !WORKER_ONLY.includes(s.name)).length,
    ).toBeLessThan(100);
    expect(
      series.filter((s) => s.name === 'motorfix_account_changes_total'),
    ).toHaveLength(ACCOUNT_FIELDS.length);
    expect(texts.join()).not.toMatch(/@|\d{6,}|[0-9a-f]{8}-/i);
  });
});
