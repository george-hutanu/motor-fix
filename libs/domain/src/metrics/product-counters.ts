import {
  CONSENT_DECISIONS,
  type ConsentDecision,
  DECLINE_REASON_CODES,
  DOCUMENT_KINDS,
  type DocumentKind,
  type OutsideChannel,
  RECHECK_RESULTS,
  type RecheckResult,
  SEARCH_SORTS,
  type SearchSort,
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
import type { FallbackReason, SentChannel } from '../notifications/routing';
import { TEMPLATES } from '../notifications/templates/registry';
import {
  ACCOUNT_CLOSED_SERIES,
  accountClosedCleanups,
  BOOKING_CONFIRM_OUTCOMES,
  BOOKING_LAPSE_REQUESTS,
  bookingConfirms,
  bookingLapses,
  DECLINE_WINDOW_OUTCOMES,
  declineWindows,
  QUOTE_ACCEPT_OUTCOMES,
  QUOTE_DECLINE_OUTCOMES,
  QUOTE_SEND_OUTCOMES,
  quoteAccepts,
  quoteDeclines,
  quotesSent,
  REQUEST_DECLINE_OUTCOMES,
  requestDeclines,
} from '../quotes/quotes/quotes.metrics';
import {
  RETENTION_KINDS,
  type RetentionKind,
} from '../retention/retention.config';
import {
  REVIEW_POSTED_OUTCOMES,
  reviewsPosted,
} from '../reviews/reviews.metrics';
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
// Not started at 0: the API's start set is at its series cap.
export type AccountDeletionOutcome =
  | 'deleted'
  | 'forbidden'
  | 'refused_owner'
  | 'refused_in_work'
  | 'reauth_required'
  | 'mismatch'
  | 'failed';
// Not started at 0 either: the requests and the download are the API's, the
// build and the expiry the worker's.
export type DataExportOutcome =
  | 'requested'
  | 'too_soon'
  | 'already_ready'
  | 'forbidden'
  | 'ready'
  | 'failed'
  | 'expired'
  | 'downloaded';
// Not started at 0 either, for the same cap.
export type AdminAccountAction =
  | 'reset_access'
  | 'suspend'
  | 'restore'
  | 'delete_on_request';
export type AdminAccountOutcome =
  | 'done'
  | 'refused'
  | 'conflict'
  | 'email_failed'
  | 'failed';
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
const REVIEW_ANNOUNCED_OUTCOMES = ['built', 'muted', 'skipped'] as const;
const VERIFICATION_RESULT_OUTCOMES = ['built', 'skipped'] as const;
const SUSPENDED_NOTICE_OUTCOMES = ['built', 'skipped'] as const;
const RESTORED_NOTICE_OUTCOMES = ['built', 'skipped'] as const;
const REPORT_DECISION_OUTCOMES = [
  'unfounded',
  'confirmed',
  'confirmed_already_suspended',
] as const;
export type ReportDecisionOutcome = (typeof REPORT_DECISION_OUTCOMES)[number];
const REPORT_DECIDED_NOTICE_OUTCOMES = ['built', 'skipped'] as const;
const QUOTE_RECEIVED_OUTCOMES = ['built', 'muted'] as const;

// The yearly documents: what the compliance step did, and the owner's and
// the admin's moves.
const DOCUMENT_CYCLE_STEPS = [
  'reminded_30',
  'reminded_7',
  'reminded_0',
  'overdue',
  'uploaded',
  'accepted',
  'refused',
] as const;
// The steps the worker's compliance step counts.
const WORKER_DOCUMENT_CYCLE_STEPS = DOCUMENT_CYCLE_STEPS.slice(0, 4);
// The steps the API's upload and review routes count.
const API_DOCUMENT_CYCLE_STEPS = DOCUMENT_CYCLE_STEPS.slice(4);

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
const retentionRows = () =>
  counter(
    'motorfix_retention_rows_total',
    'Rows the nightly retention job removed or anonymised, by kind',
  );
const sortChanges = () =>
  counter('motorfix_sort_changes_total', 'Sort changes on Results, by sort');
const signIns = () => counter('motorfix_sign_ins_total', 'Sign-ins, by method');
const garageSignUps = () =>
  counter('motorfix_garage_sign_ups_total', 'Garage listings started');
const listingSubmissions = () =>
  counter(
    'motorfix_listing_submissions_total',
    'Garage listings sent for verification',
  );
const completions = () =>
  counter(
    'motorfix_listing_completions_total',
    'Completion copies opened to answer a request for more',
  );
const accountDeletions = () =>
  counter(
    'motorfix_account_deletions_total',
    'Account deletions asked for, by outcome',
  );
const dataExports = () =>
  counter(
    'motorfix_data_exports_total',
    'Copies of their data people asked for, by outcome',
  );
const adminAccountActions = () =>
  counter(
    'motorfix_admin_account_actions_total',
    'Admin actions on one account, by action and outcome',
  );
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
// Not started at 0: a handful a month, and the API stays under 150 series.
const restores = () =>
  counter(
    'motorfix_garage_restores_total',
    'Suspended garages an admin put back on the map, by the cause lifted',
  );
const verificationChecks = () =>
  counter(
    'motorfix_verification_checks_total',
    "Checks an admin recorded on a garage's file, by kind and result",
  );
const PRESENCE_OUTCOMES = ['created', 'removed', 'store_unavailable'] as const;
type PresenceOutcome = (typeof PRESENCE_OUTCOMES)[number];
// No account or file is ever a label.
const presences = () =>
  counter(
    'motorfix_verification_presence_total',
    'Verification file presence entries created and removed, and store calls that failed, by outcome',
  );
const rechecks = () =>
  counter(
    'motorfix_rechecks_total',
    'Monthly register re-checks an admin recorded on a garage, by result',
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
const reviewsAnnounced = () =>
  counter(
    'motorfix_review_announced_total',
    'Posted reviews announced to garage owners, by outcome',
  );
const reviewRepliesAnnounced = () =>
  counter(
    'motorfix_review_reply_announced_total',
    'Garage replies announced to the review’s author, by outcome',
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
const restoredNotices = () =>
  counter(
    'motorfix_garage_restored_notices_total',
    'Garage restores told to garage owners, by outcome',
  );
const documentCycle = () =>
  counter(
    'motorfix_document_cycle_total',
    'Yearly document cycle steps: reminders, overdue, uploads, decisions',
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
const acceptances = () =>
  counter(
    'motorfix_acceptances_total',
    'Accounts that accepted the terms and privacy notice in force again',
  );
const consentRefusals = () =>
  counter(
    'motorfix_consent_refusals_total',
    'Calls refused because the account has not accepted the texts in force, by surface',
  );
// The fallbacks the send path can take: a driver's channel it could not use,
// the row it wrote instead, and why.
const FALLBACKS = [
  { from: 'sms', reason: 'sms_cap_reached', to: 'whatsapp' },
  { from: 'sms', reason: 'send_failed', to: 'whatsapp' },
  { from: 'sms', reason: 'phone_not_verified', to: 'email' },
  { from: 'sms', reason: 'send_failed', to: 'email' },
  { from: 'whatsapp', reason: 'phone_not_verified', to: 'email' },
  { from: 'whatsapp', reason: 'send_failed', to: 'email' },
  { from: 'push', reason: 'no_device', to: 'email' },
  { from: 'push', reason: 'send_failed', to: 'email' },
  { from: 'email', reason: 'send_failed', to: 'push' },
] as const;
// A label outside these sets would open a series of its own.
const CHOICE_CHANNELS: readonly OutsideChannel[] = [
  'email',
  'push',
  'sms',
  'whatsapp',
];
// Not started at 0: the API's start set is at its series cap.
const channelChoices = () =>
  counter(
    'motorfix_notification_channel_choices_total',
    "Drivers' channel picks for a notification type, by channel",
  );
const channelFallbacks = () =>
  counter(
    'motorfix_notification_channel_fallbacks_total',
    'Messages sent on another channel than the chosen one, by pair and reason',
  );
const accountChanges = () =>
  counter(
    'motorfix_account_changes_total',
    "Changes to an account's own details, by field",
  );

export function countSearch(outcome: (typeof SEARCH_OUTCOMES)[number]) {
  searches().add(1, { outcome });
}

export function countSortChange(sort: SearchSort) {
  sortChanges().add(1, { sort });
}

export function countSignIn(method: SignInMethod) {
  signIns().add(1, { method });
}

export function countGarageSignUp() {
  garageSignUps().add(1);
}

export function countListingSubmission() {
  listingSubmissions().add(1);
}

export function countCompletionOpened() {
  completions().add(1);
}

export function countAccountDeletion(outcome: AccountDeletionOutcome) {
  accountDeletions().add(1, { outcome });
}

export function countDataExport(outcome: DataExportOutcome, by = 1) {
  dataExports().add(by, { outcome });
}

export function countAdminAccountAction(
  action: AdminAccountAction,
  outcome: AdminAccountOutcome,
) {
  adminAccountActions().add(1, { action, outcome });
}

export function countApproval(outcome: (typeof APPROVAL_OUTCOMES)[number]) {
  approvals().add(1, { outcome });
}

export function countGarageSuspension(cause: SuspensionCause) {
  suspensions().add(1, { cause });
}

export function countGarageRestore(cause: SuspensionCause) {
  restores().add(1, { cause });
}

export function countVerificationCheck(
  kind: VerificationCheckKind,
  result: VerificationCheckResult,
) {
  verificationChecks().add(1, { kind, result });
}

export function countPresence(outcome: PresenceOutcome) {
  presences().add(1, { outcome });
}

export function countRecheck(result: RecheckResult) {
  rechecks().add(1, { result });
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

// A posted review told to the garage's owners, one they all muted, or one
// with nobody to tell.
export function countReviewAnnounced(
  outcome: (typeof REVIEW_ANNOUNCED_OUTCOMES)[number],
) {
  reviewsAnnounced().add(1, { outcome });
}

// A garage's reply told to the review's author, one they muted, or one
// with nobody to tell.
export function countReviewReplyAnnounced(
  outcome: (typeof REVIEW_ANNOUNCED_OUTCOMES)[number],
) {
  reviewRepliesAnnounced().add(1, { outcome });
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

// A restore told to the garage's owners, or one with nobody to tell.
export function countGarageRestoredNotice(
  outcome: (typeof RESTORED_NOTICE_OUTCOMES)[number],
) {
  restoredNotices().add(1, { outcome });
}

export function countDocumentUploaded(kind: DocumentKind) {
  documentsUploaded().add(1, { kind });
}

export function countDocumentCycle(
  step: (typeof DOCUMENT_CYCLE_STEPS)[number],
) {
  documentCycle().add(1, { step });
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

export function countAcceptance() {
  acceptances().add(1);
}

export function countConsentRefusal(surface: 'api' | 'mcp') {
  consentRefusals().add(1, { surface });
}

// One saved change of the account's own details, by field.
export function countAccountChange(field: (typeof ACCOUNT_FIELDS)[number]) {
  accountChanges().add(1, { field });
}

// One driver pick of a new channel for one type.
export function countChannelChoice(channel: OutsideChannel) {
  if (!CHOICE_CHANNELS.includes(channel)) return;
  channelChoices().add(1, { channel });
}

// One message written on `to` because `from` could not be used.
export function countChannelFallback(
  from: SentChannel,
  to: SentChannel,
  reason: FallbackReason,
) {
  const known = FALLBACKS.some(
    (f) => f.from === from && f.reason === reason && f.to === to,
  );
  if (!known) return;
  channelFallbacks().add(1, { from, reason, to });
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
    [sortChanges, each('sort', SEARCH_SORTS)],
    [signIns, each('method', SIGN_IN_METHODS)],
    [garageSignUps, [{}]],
    [listingSubmissions, [{}]],
    [completions, [{}]],
    [approvals, each('outcome', APPROVAL_OUTCOMES)],
    [suspensions, each('cause', SUSPENSION_CAUSES)],
    [
      verificationChecks,
      across(
        each('kind', VERIFICATION_CHECK_KINDS),
        each('result', VERIFICATION_CHECK_RESULTS),
      ),
    ],
    [rechecks, each('result', RECHECK_RESULTS)],
    // Only the failure starts at zero for its alert: the 150-series budget
    // has no room for the other two, which appear with the first presence.
    [presences, [{ outcome: 'store_unavailable' }]],
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
    [quoteDeclines, each('outcome', QUOTE_DECLINE_OUTCOMES)],
    // A lost race (slot_taken) is rare: it starts on its first count, for
    // the 150-series budget, as each outcome and reason pair does.
    [
      bookingConfirms,
      each(
        'outcome',
        BOOKING_CONFIRM_OUTCOMES.filter((one) => one !== 'slot_taken'),
      ),
    ],
    [reviewsPosted, each('outcome', REVIEW_POSTED_OUTCOMES)],
    [searchCache, each('outcome', SEARCH_CACHE_OUTCOMES)],
    [searchLog, each('outcome', SEARCH_LOG_OUTCOMES)],
    [supportMessages, each('outcome', SUPPORT_MESSAGE_OUTCOMES)],
    [documentCycle, each('step', API_DOCUMENT_CYCLE_STEPS)],
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
    [reviewsAnnounced, each('outcome', REVIEW_ANNOUNCED_OUTCOMES)],
    [reviewRepliesAnnounced, each('outcome', REVIEW_ANNOUNCED_OUTCOMES)],
    [verificationResults, each('outcome', VERIFICATION_RESULT_OUTCOMES)],
    [suspendedNotices, each('outcome', SUSPENDED_NOTICE_OUTCOMES)],
    [restoredNotices, each('outcome', RESTORED_NOTICE_OUTCOMES)],
    [reportDecidedNotices, each('outcome', REPORT_DECIDED_NOTICE_OUTCOMES)],
    [quotesReceived, each('outcome', QUOTE_RECEIVED_OUTCOMES)],
    [
      declineWindows,
      across(
        each('outcome', DECLINE_WINDOW_OUTCOMES),
        each('sweep', ['true', 'false']),
      ),
    ],
    [accountClosedCleanups, ACCOUNT_CLOSED_SERIES],
    [
      bookingLapses,
      across(
        each('request', BOOKING_LAPSE_REQUESTS),
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
    [documentCycle, each('step', WORKER_DOCUMENT_CYCLE_STEPS)],
    [retentionRows, each('kind', RETENTION_KINDS)],
    [channelFallbacks, FALLBACKS],
  ],
};

// Right after the meter provider is registered; a no-op while telemetry is off.
export function initProductCounters(process: 'api' | 'worker') {
  for (const [series, labels] of STARTS[process]) {
    const started = series();
    for (const one of labels) started.add(0, one);
  }
}

export function countRetention(kind: RetentionKind, rows: number) {
  retentionRows().add(rows, { kind });
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
