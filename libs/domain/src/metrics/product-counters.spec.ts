import {
  CONSENT_DECISIONS,
  DOCUMENT_KINDS,
  SYSTEM_LOG_KINDS,
} from '@motor-fix/contracts';
import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import { type Meter, metrics } from '@opentelemetry/api';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import {
  countAcceptance,
  countAccountChange,
  countAdminAccountAction,
  countApproval,
  countChannelChoice,
  countChannelFallback,
  countCompletionOpened,
  countConsentRecord,
  countConsentRefusal,
  countDeclarationSigned,
  countDocumentOpened,
  countDocumentUploaded,
  countEmail,
  countGarageReport,
  countGarageSignUp,
  countJobStep,
  countListingSubmission,
  countMoreRequest,
  countNotification,
  countQuote,
  countRejection,
  countRequestReceived,
  countResubmission,
  countSearch,
  countSignIn,
  countSortChange,
  countSupportEmail,
  countSupportMessage,
  countSystemLogEntry,
  countVerificationCheck,
  countVerificationResult,
  initProductCounters,
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

const REJECTION_REASONS = [
  'documents',
  'rar',
  'address',
  'photos',
  'other',
] as const;

const GARAGE_REPORT_OUTCOMES = [
  'created',
  'already_reported',
  'refused',
] as const;

const SORTS = ['rating', 'distance', 'price'] as const;

const FALLBACKS = [
  ['sms', 'whatsapp', 'sms_cap_reached'],
  ['sms', 'whatsapp', 'send_failed'],
  ['sms', 'email', 'phone_not_verified'],
  ['whatsapp', 'email', 'phone_not_verified'],
  ['whatsapp', 'email', 'send_failed'],
  ['push', 'email', 'no_device'],
  ['push', 'email', 'send_failed'],
  ['email', 'push', 'send_failed'],
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

// The counter names a process starts, read from its real start set: the
// meter is swapped for one that only records the names it is asked for.
function startedNames(process: 'api' | 'worker') {
  const names = new Set<string>();
  const meter = {
    createCounter: (name: string) => {
      names.add(name);
      return { add: () => undefined };
    },
  } as unknown as Meter;
  const spy = jest.spyOn(metrics, 'getMeter').mockReturnValue(meter);
  try {
    initProductCounters(process);
  } finally {
    spy.mockRestore();
  }
  return names;
}

function countChannelSeries() {
  for (const channel of ['email', 'push', 'sms', 'whatsapp'] as const)
    countChannelChoice(channel);
  for (const [from, to, reason] of FALLBACKS)
    countChannelFallback(from, to, reason);
}

// Every series an instance can add, once each.
function countEverySeries() {
  for (const outcome of ['results', 'none'] as const) countSearch(outcome);
  SORTS.forEach((sort) => {
    countSortChange(sort);
  });
  for (const method of ['password', 'phone', 'google', 'apple'] as const)
    countSignIn(method);
  countGarageSignUp();
  countListingSubmission();
  for (const outcome of ['approved', 'rejected'] as const)
    countApproval(outcome);
  REJECTION_REASONS.forEach((reason) => {
    countRejection(reason);
  });
  countMoreRequest();
  countResubmission();
  countCompletionOpened();
  countQuote();
  // Only a template with an e-mail text is ever counted as an e-mail sent.
  for (const [template, text] of Object.entries(TEMPLATES)) {
    if (text.email) countEmail(template);
  }
  for (const channel of ['push', 'in-app'] as const) countNotification(channel);
  countChannelSeries();
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
  for (const kind of SYSTEM_LOG_KINDS) {
    for (const outcome of ['written', 'grouped', 'dropped'] as const)
      countSystemLogEntry(kind, outcome);
  }
}

// @traces 003-FR-021
describe('the admin account actions counter', () => {
  it('counts one action by action and outcome, with no other label', async () => {
    const labels = { action: 'suspend', outcome: 'email_failed' };
    const before = await total('motorfix_admin_account_actions_total', labels);

    countAdminAccountAction('suspend', 'email_failed');

    expect(await total('motorfix_admin_account_actions_total', labels)).toBe(
      before + 1,
    );
    const { resourceMetrics } = await memory.metricReader.collect();
    const points = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .filter(
        (m) => m.descriptor.name === 'motorfix_admin_account_actions_total',
      )
      .flatMap((m) => m.dataPoints as DataPoint<number>[]);
    for (const point of points) {
      expect(Object.keys(point.attributes).sort()).toEqual([
        'action',
        'outcome',
      ]);
    }
  });
});

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
    // @traces 203-FR-010
    [
      () => countVerificationCheck('caen', 'warning'),
      'motorfix_verification_checks_total',
      { kind: 'caen', result: 'warning' },
    ],
    [
      () => countSearch('results'),
      'motorfix_searches_total',
      { outcome: 'results' },
    ],
    [() => countSearch('none'), 'motorfix_searches_total', { outcome: 'none' }],
    // @traces 328-FR-014
    ...SORTS.map(
      (sort) =>
        [
          () => countSortChange(sort),
          'motorfix_sort_changes_total',
          { sort },
        ] as const,
    ),
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
    // @traces 305-FR-009
    ...REJECTION_REASONS.map(
      (reason) =>
        [
          () => countRejection(reason),
          'motorfix_verification_rejections_total',
          { reason },
        ] as const,
    ),
    // @traces 304-FR-012
    [() => countMoreRequest(), 'motorfix_verification_more_requests_total', {}],
    // @traces 304-FR-012
    [
      () => countResubmission(),
      'motorfix_verification_resubmissions_total',
      {},
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
    // @traces 116-FR-020
    [() => countListingSubmission(), 'motorfix_listing_submissions_total', {}],
    // @traces 208-FR-011
    [() => countCompletionOpened(), 'motorfix_listing_completions_total', {}],
    ...CONSENT_DECISIONS.map(
      (decision) =>
        [
          () => countConsentRecord(decision),
          'motorfix_consent_records_total',
          { decision },
        ] as const,
    ),
    // @traces 1204-terms-reaccept-FR-016
    [() => countAcceptance(), 'motorfix_acceptances_total', {}],
    ...(['api', 'mcp'] as const).map(
      (surface) =>
        [
          () => countConsentRefusal(surface),
          'motorfix_consent_refusals_total',
          { surface },
        ] as const,
    ),
  ] as const)('counts one %#: %s', async (count, name, labels) => {
    const before = await total(name, labels);

    count();

    expect(await total(name, labels)).toBe(before + 1);
  });

  // @traces 056-FR-024
  // Each counter stays under 60 series and each instance under 150, far
  // inside the metrics backend's free tier: the API's are the counters it
  // starts, the worker's the ones it starts. The seven counters the
  // observability story added are checked one by one.
  it('keeps each of the seven counters under 60 series, the e-mails one per template, and the instance under 150, every label from a fixed set', async () => {
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
    // The e-mail counter carries one series per e-mail template (the registry's
    // and the sign-in code), a fixed set that grows only with a new template;
    // every other counter stays under 60.
    const emailTemplates = new Set([
      'SIGN_IN_CODE',
      ...Object.entries(TEMPLATES)
        .filter(([, text]) => text.email)
        .map(([template]) => template),
    ]);
    for (const name of SEVEN_COUNTERS) {
      const own = series.filter((s) => s.name === name);
      if (name === 'motorfix_emails_sent_total')
        expect(
          own.filter(
            (s) =>
              !emailTemplates.has(
                JSON.parse(s.text.slice(name.length)).template,
              ),
          ),
        ).toEqual([]);
      else expect(own.length).toBeLessThan(60);
    }
    for (const process of ['api', 'worker'] as const) {
      const names = startedNames(process);
      expect(names.size).toBeGreaterThan(0);
      expect(series.filter((s) => names.has(s.name)).length).toBeLessThan(150);
    }
    expect(
      series.filter((s) => s.name === 'motorfix_account_changes_total'),
    ).toHaveLength(ACCOUNT_FIELDS.length);
    expect(texts.join()).not.toMatch(/@|\d{6,}|[0-9a-f]{8}-/i);
  });
});

// @traces 142-FR-008
describe('the channel counters', () => {
  it.each(['email', 'push', 'sms', 'whatsapp'] as const)(
    'counts one choice of %s',
    async (channel) => {
      const before = await total(
        'motorfix_notification_channel_choices_total',
        {
          channel,
        },
      );

      countChannelChoice(channel);

      expect(
        await total('motorfix_notification_channel_choices_total', { channel }),
      ).toBe(before + 1);
    },
  );

  it.each(FALLBACKS)(
    'counts one fallback from %s to %s (%s)',
    async (from, to, reason) => {
      const labels = { from, reason, to };
      const before = await total(
        'motorfix_notification_channel_fallbacks_total',
        labels,
      );

      countChannelFallback(from, to, reason);

      expect(
        await total('motorfix_notification_channel_fallbacks_total', labels),
      ).toBe(before + 1);
    },
  );

  // The API's start set is at its series cap: a pick is counted from the first.
  it('starts the fallbacks in the worker, and not the choices', () => {
    expect(startedNames('api')).not.toContain(
      'motorfix_notification_channel_choices_total',
    );
    expect(startedNames('worker')).toContain(
      'motorfix_notification_channel_fallbacks_total',
    );
  });
});
