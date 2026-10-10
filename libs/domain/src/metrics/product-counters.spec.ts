import { DOCUMENT_KINDS } from '@motor-fix/contracts';
import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import {
  countApproval,
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
} from './product-counters';
import { TEMPLATES } from '../notifications/templates/registry';

const STEP_ACTIONS = [
  'added',
  'renamed',
  'reordered',
  'removed',
  'ticked',
  'unticked',
] as const;

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
// @traces 206-FR-016
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
    ...(['built', 'muted', 'skipped'] as const).map(
      (outcome) =>
        [
          () => countRequestReceived(outcome),
          'motorfix_request_received_total',
          { outcome },
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
  ] as const)('counts one %#: %s', async (count, name, labels) => {
    const before = await total(name, labels);

    count();

    expect(await total(name, labels)).toBe(before + 1);
  });

  it('keeps every series an instance can add under 50 besides one per template, with labels from fixed sets only', async () => {
    for (const outcome of ['results', 'none'] as const) countSearch(outcome);
    for (const method of ['password', 'phone', 'google', 'apple'] as const)
      countSignIn(method);
    countGarageSignUp();
    for (const outcome of ['approved', 'rejected'] as const)
      countApproval(outcome);
    countQuote();
    for (const template of Object.keys(TEMPLATES)) countEmail(template);
    for (const channel of ['push', 'in-app'] as const)
      countNotification(channel);
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

    const { resourceMetrics } = await memory.metricReader.collect();
    const series = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name.startsWith('motorfix_'))
      .flatMap((metric) =>
        (metric.dataPoints as DataPoint<number>[]).map(
          (point) =>
            `${metric.descriptor.name}${JSON.stringify(point.attributes)}`,
        ),
      );
    expect(new Set(series).size).toBe(series.length);
    // The e-mail counter carries one series per template, a fixed set that
    // grows with the catalogue; every other counter shares the 50.
    expect(series.length).toBeLessThan(50 + Object.keys(TEMPLATES).length);
    expect(series.join()).not.toMatch(/@|\d{6,}|[0-9a-f]{8}-/i);
  });
});
