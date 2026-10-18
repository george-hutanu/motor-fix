import {
  CONSENT_DECISIONS,
  type ConsentDecision,
  DECLINE_REASON_CODES,
  DOCUMENT_KINDS,
  type DocumentKind,
  SUSPENSION_CAUSES,
  type SuspensionCause,
  type SystemLogKind,
  VERIFICATION_CHECK_KINDS,
  VERIFICATION_CHECK_RESULTS,
  VERIFICATION_REASON_CODES,
  type VerificationCheckKind,
  type VerificationCheckResult,
  type VerificationReasonCode,
} from '@motor-fix/contracts';
import { type Attributes, type Counter, metrics } from '@opentelemetry/api';

import type { Outcome } from '../admin/system-log/system-log';
import { TEMPLATES } from '../notifications/templates/registry';
import {
  DECLINE_WINDOW_OUTCOMES,
  declineWindows,
  QUOTE_ACCEPT_OUTCOMES,
  QUOTE_SEND_OUTCOMES,
  quoteAccepts,
  quotesSent,
  REQUEST_DECLINE_OUTCOMES,
  requestDeclines,
} from '../quotes/quotes/quotes.metrics';
import {
  SEARCH_CACHE_OUTCOMES,
  SEARCH_LOG_OUTCOMES,
  searchCache,
  searchLog,
} from '../search/garage-search/garage-search.metrics';

// The product's key numbers, one counter each; a process that never starts
// telemetry counts into the API's no-op meter and pays nothing. Every label comes from a
// fixed set: no identifier, address or free text ever becomes a series.

const SEARCH_OUTCOMES = ['results', 'none'] as const;
const SIGN_IN_METHODS = ['password', 'phone', 'google', 'apple'] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];
const APPROVAL_OUTCOMES = ['approved', 'rejected'] as const;
export type NotificationChannel = 'push' | 'in-app';
const STEP_ACTIONS = [
  'added',
  'renamed',
  'reordered',
  'removed',
  'ticked',
  'unticked',
] as const;
export type JobStepAction = (typeof STEP_ACTIONS)[number];
const GARAGE_REPORT_OUTCOMES = [
  'created',
  'already_reported',
  'refused',
] as const;
export type GarageReportOutcome = (typeof GARAGE_REPORT_OUTCOMES)[number];
const ACCOUNT_FIELDS = ['name', 'city', 'email', 'phone', 'password'] as const;
const REQUEST_RECEIVED_OUTCOMES = ['built', 'muted', 'skipped'] as const;
const VERIFICATION_RESULT_OUTCOMES = ['built', 'skipped'] as const;
const SUSPENDED_NOTICE_OUTCOMES = ['built', 'skipped'] as const;
const REPORT_DECISION_OUTCOMES = [
  'unfounded',
  'confirmed',
  'confirmed_already_suspended',
] as const;
export type ReportDecisionOutcome = (typeof REPORT_DECISION_OUTCOMES)[number];
const REPORT_DECIDED_NOTICE_OUTCOMES = ['built', 'skipped'] as const;
const QUOTE_RECEIVED_OUTCOMES = ['built', 'muted'] as const;

const SUPPORT_MESSAGE_OUTCOMES = [
  'stored',
  'refused_limit',
  'trap',
  'invalid',
] as const;
type SupportMessageOutcome = (typeof SUPPORT_MESSAGE_OUTCOMES)[number];
const SUPPORT_EMAIL_KINDS = ['support', 'acknowledgement'] as const;
export type SupportEmailKind = (typeof SUPPORT_EMAIL_KINDS)[number];
const SUPPORT_EMAIL_OUTCOMES = [
  'sent',
  'blocked',
  'failed',
  'unconfigured',
] as const;
type SupportEmailOutcome = (typeof SUPPORT_EMAIL_OUTCOMES)[number];

// Looked up on every count, never cached: a counter kept from before the
// meter provider is registered would stay a no-op for the life of the
// process. The SDK hands back the same instrument for the same name.
function counter(name: string, description: string): Counter {
  return metrics.getMeter('motorfix').createCounter(name, { description });
}

const searches = () =>
  counter('motorfix_searches_total', 'Garage searches, by outcome');
const signIns = () => counter('motorfix_sign_ins_total', 'Sign-ins, by method');
const garageSignUps = () =>
  counter('motorfix_garage_sign_ups_total', 'Garage listings started');
const approvals = () =>
  counter(
    'motorfix_garage_approvals_total',
    'Garage verification decisions, by outcome',
  );
const suspensions = () =>
  counter(
    'motorfix_garage_suspensions_total',
    'Garages taken off the map, by cause',
  );
const verificationChecks = () =>
  counter(
    'motorfix_verification_checks_total',
    "Checks an admin recorded on a garage's file, by kind and result",
  );
const rejections = () =>
  counter(
    'motorfix_verification_rejections_total',
    'Garage verification files rejected, by reason',
  );
const decisionRefusals = () =>
  counter(
    'motorfix_verification_decision_refusals_total',
    'Verification decisions refused, by reason',
  );
const moreRequests = () =>
  counter(
    'motorfix_verification_more_requests_total',
    'Garage verification files sent back for more details',
  );
const resubmissions = () =>
  counter(
    'motorfix_verification_resubmissions_total',
    'Verification files sent again after a request for more',
  );
const reportDecisions = () =>
  counter(
    'motorfix_report_decisions_total',
    "Admins' decisions on a garage's open reports, by outcome",
  );
const reportDecidedNotices = () =>
  counter(
    'motorfix_garage_report_decided_notices_total',
    'Report decisions told to their reporters, by outcome',
  );
const reopenings = () =>
  counter(
    'motorfix_verification_reopenings_total',
    'Decided verification files reopened, by actor role',
  );
const quotes = () => counter('motorfix_quotes_total', 'Quotes sent to drivers');
const supportMessages = () =>
  counter(
    'motorfix_support_messages_total',
    'Messages sent through the contact form, by outcome',
  );
const supportEmails = () =>
  counter(
    'motorfix_support_emails_total',
    "A support message's e-mails, by kind and outcome",
  );
const emails = () =>
  counter('motorfix_emails_sent_total', 'E-mails sent, by template');
const notifications = () =>
  counter(
    'motorfix_notifications_sent_total',
    'Notifications delivered, by channel',
  );
const jobSteps = () =>
  counter('motorfix_job_steps_total', "Changes to a job's steps, by action");
const requestsReceived = () =>
  counter(
    'motorfix_request_received_total',
    'Garages a new request was announced to, by outcome',
  );
const verificationResults = () =>
  counter(
    'motorfix_verification_result_total',
    'Verification decisions told to garage owners, by outcome',
  );
const suspendedNotices = () =>
  counter(
    'motorfix_garage_suspended_notices_total',
    'Garage suspensions told to garage owners, by outcome',
  );
const documentsUploaded = () =>
  counter(
    'motorfix_documents_uploaded_total',
    'Document pages confirmed on listing drafts, by kind',
  );
const declarationsSigned = () =>
  counter('motorfix_declarations_signed_total', 'Listing declarations signed');
const documentsOpened = () =>
  counter(
    'motorfix_documents_opened_total',
    'Document pages opened by an admin, by kind',
  );
const quotesReceived = () =>
  counter(
    'motorfix_quote_received_total',
    'Sent quotes announced to their driver, by outcome',
  );
const garageReports = () =>
  counter(
    'motorfix_garage_reports_total',
    'Reports of a garage by a driver, by outcome',
  );
const consentRecords = () =>
  counter(
    'motorfix_consent_records_total',
    'Analytics consent choices stored, by decision',
  );
const accountChanges = () =>
  counter(
    'motorfix_account_changes_total',
    "Changes to an account's own details, by field",
  );

export function countSearch(outcome: (typeof SEARCH_OUTCOMES)[number]) {
  searches().add(1, { outcome });
}

export function countSignIn(method: SignInMethod) {
  signIns().add(1, { method });
}

export function countGarageSignUp() {
  garageSignUps().add(1);
}

export function countApproval(outcome: (typeof APPROVAL_OUTCOMES)[number]) {
  approvals().add(1, { outcome });
}

export function countGarageSuspension(cause: SuspensionCause) {
  suspensions().add(1, { cause });
}

export function countVerificationCheck(
  kind: VerificationCheckKind,
  result: VerificationCheckResult,
) {
  verificationChecks().add(1, { kind, result });
}

const DECISION_REFUSAL_REASONS = [
  'already_decided',
  'rar_check_required',
  'caen_check_required',
  'note_required',
  'reason_required',
  'note_too_short',
  'no_open_report',
] as const;
type DecisionRefusalReason = (typeof DECISION_REFUSAL_REASONS)[number];

export function countDecisionRefusal(reason: DecisionRefusalReason) {
  decisionRefusals().add(1, { reason });
}

export function countRejection(reason: VerificationReasonCode) {
  rejections().add(1, { reason });
}

export function countMoreRequest() {
  moreRequests().add(1);
}

export function countResubmission() {
  resubmissions().add(1);
}

export function countReportDecision(outcome: ReportDecisionOutcome) {
  reportDecisions().add(1, { outcome });
}

// A report decision told to its reporters, or one with nobody to tell.
export function countReportDecidedNotice(
  outcome: (typeof REPORT_DECIDED_NOTICE_OUTCOMES)[number],
) {
  reportDecidedNotices().add(1, { outcome });
}

const REOPENING_ROLES = ['admin', 'system'] as const;

export function countReopening(role: (typeof REOPENING_ROLES)[number]) {
  reopenings().add(1, { role });
}

export function countQuote() {
  quotes().add(1);
}

// `template` is a name from the e-mail template registry, never an address.
export function countEmail(template: string) {
  emails().add(1, { template });
}

export function countNotification(channel: NotificationChannel) {
  notifications().add(1, { channel });
}

export function countJobStep(action: JobStepAction) {
  jobSteps().add(1, { action });
}

export function countRequestReceived(
  outcome: (typeof REQUEST_RECEIVED_OUTCOMES)[number],
) {
  requestsReceived().add(1, { outcome });
}

// A verification decision told to the garage's owners, or one with nobody
// or nothing to tell.
export function countVerificationResult(
  outcome: (typeof VERIFICATION_RESULT_OUTCOMES)[number],
) {
  verificationResults().add(1, { outcome });
}

// A suspension told to the garage's owners, or one with nobody or nothing
// to tell.
export function countGarageSuspendedNotice(
  outcome: (typeof SUSPENDED_NOTICE_OUTCOMES)[number],
) {
  suspendedNotices().add(1, { outcome });
}

export function countDocumentUploaded(kind: DocumentKind) {
  documentsUploaded().add(1, { kind });
}

export function countDeclarationSigned() {
  declarationsSigned().add(1);
}

export function countDocumentOpened(kind: DocumentKind) {
  documentsOpened().add(1, { kind });
}

export function countQuoteReceived(
  outcome: (typeof QUOTE_RECEIVED_OUTCOMES)[number],
) {
  quotesReceived().add(1, { outcome });
}

export function countGarageReport(outcome: GarageReportOutcome) {
  garageReports().add(1, { outcome });
}

// One per analytics choice stored, visitor or signed in.
export function countConsentRecord(decision: ConsentDecision) {
  consentRecords().add(1, { decision });
}

// One saved change of the account's own details, by field.
export function countAccountChange(field: (typeof ACCOUNT_FIELDS)[number]) {
  accountChanges().add(1, { field });
}

const each = <K extends string>(key: K, values: readonly string[]) =>
  values.map((value) => ({ [key]: value }) as Record<K, string>);

const across = (left: readonly Attributes[], right: readonly Attributes[]) =>
  left.flatMap((one) => right.map((other) => ({ ...one, ...other })));

// A series is first written by its first count, so a dashboard reads
// "No data" until then and a rate over it has nothing to start from. Each
// process starts the series it counts, and only those: a series the other
// process alone writes would sit at 0 here for ever.
const STARTS: Record<
  'api' | 'worker',
  readonly [() => Counter, readonly Attributes[]][]
> = {
  api: [
    [searches, each('outcome', SEARCH_OUTCOMES)],
    [signIns, each('method', SIGN_IN_METHODS)],
    [garageSignUps, [{}]],
    [approvals, each('outcome', APPROVAL_OUTCOMES)],
    [suspensions, each('cause', SUSPENSION_CAUSES)],
    [
      verificationChecks,
      across(
        each('kind', VERIFICATION_CHECK_KINDS),
        each('result', VERIFICATION_CHECK_RESULTS),
      ),
    ],
    [rejections, each('reason', VERIFICATION_REASON_CODES)],
    [decisionRefusals, each('reason', DECISION_REFUSAL_REASONS)],
    [reopenings, each('role', REOPENING_ROLES)],
    [moreRequests, [{}]],
    [resubmissions, [{}]],
    [reportDecisions, each('outcome', REPORT_DECISION_OUTCOMES)],
    [notifications, [{ channel: 'in-app' }]],
    [jobSteps, each('action', STEP_ACTIONS)],
    [documentsUploaded, each('kind', DOCUMENT_KINDS)],
    [declarationsSigned, [{}]],
    [documentsOpened, each('kind', DOCUMENT_KINDS)],
    [garageReports, each('outcome', GARAGE_REPORT_OUTCOMES)],
    [consentRecords, each('decision', CONSENT_DECISIONS)],
    [accountChanges, each('field', ACCOUNT_FIELDS)],
    [quotesSent, each('outcome', QUOTE_SEND_OUTCOMES)],
    [
      requestDeclines,
      across(
        each('outcome', REQUEST_DECLINE_OUTCOMES),
        each('reason', DECLINE_REASON_CODES),
      ),
    ],
    [quoteAccepts, each('outcome', QUOTE_ACCEPT_OUTCOMES)],
    [searchCache, each('outcome', SEARCH_CACHE_OUTCOMES)],
    [searchLog, each('outcome', SEARCH_LOG_OUTCOMES)],
    [supportMessages, each('outcome', SUPPORT_MESSAGE_OUTCOMES)],
  ],
  worker: [
    [
      emails,
      each(
        'template',
        Object.keys(TEMPLATES).filter((name) => TEMPLATES[name]?.email),
      ),
    ],
    [notifications, [{ channel: 'push' }, { channel: 'in-app' }]],
    [quotes, [{}]],
    [requestsReceived, each('outcome', REQUEST_RECEIVED_OUTCOMES)],
    [verificationResults, each('outcome', VERIFICATION_RESULT_OUTCOMES)],
    [suspendedNotices, each('outcome', SUSPENDED_NOTICE_OUTCOMES)],
    [reportDecidedNotices, each('outcome', REPORT_DECIDED_NOTICE_OUTCOMES)],
    [quotesReceived, each('outcome', QUOTE_RECEIVED_OUTCOMES)],
    [
      declineWindows,
      across(
        each('outcome', DECLINE_WINDOW_OUTCOMES),
        each('sweep', ['true', 'false']),
      ),
    ],
    [
      supportEmails,
      across(
        each('kind', SUPPORT_EMAIL_KINDS),
        each('outcome', SUPPORT_EMAIL_OUTCOMES),
      ),
    ],
  ],
};

// Right after the meter provider is registered; a no-op while telemetry is off.
export function initProductCounters(process: 'api' | 'worker') {
  for (const [series, labels] of STARTS[process]) {
    const started = series();
    for (const one of labels) started.add(0, one);
  }
}

// A maintenance refusal is counted by motorfix_maintenance_refusals_total.
export function countSupportMessage(outcome: SupportMessageOutcome) {
  supportMessages().add(1, { outcome });
}

export function countSupportEmail(
  kind: SupportEmailKind,
  outcome: SupportEmailOutcome,
) {
  supportEmails().add(1, { kind, outcome });
}

// Every write to the system status log, by kind and what became of it.
export function countSystemLogEntry(kind: SystemLogKind, outcome: Outcome) {
  counter(
    'motorfix_system_log_entries_total',
    'System status log writes, by kind and outcome',
  ).add(1, { kind, outcome });
}
