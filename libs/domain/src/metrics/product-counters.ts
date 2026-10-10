import type { DocumentKind } from '@motor-fix/contracts';
import { type Counter, metrics } from '@opentelemetry/api';

// The product's key numbers, one counter each; a process that never starts
// telemetry counts into the API's no-op meter and pays nothing. Every label comes from a
// fixed set: no identifier, address or free text ever becomes a series.

type SearchOutcome = 'results' | 'none';
export type SignInMethod = 'password' | 'phone' | 'google' | 'apple';
type ApprovalOutcome = 'approved' | 'rejected';
export type NotificationChannel = 'push' | 'in-app';
export type JobStepAction =
  | 'added'
  | 'renamed'
  | 'reordered'
  | 'removed'
  | 'ticked'
  | 'unticked';
export type GarageReportOutcome = 'created' | 'already_reported' | 'refused';

// Looked up on every count, never cached: a counter kept from before the
// meter provider is registered would stay a no-op for the life of the
// process. The SDK hands back the same instrument for the same name.
function counter(name: string, description: string): Counter {
  return metrics.getMeter('motorfix').createCounter(name, { description });
}

export function countSearch(outcome: SearchOutcome) {
  counter('motorfix_searches_total', 'Garage searches, by outcome').add(1, {
    outcome,
  });
}

export function countSignIn(method: SignInMethod) {
  counter('motorfix_sign_ins_total', 'Sign-ins, by method').add(1, { method });
}

export function countGarageSignUp() {
  counter('motorfix_garage_sign_ups_total', 'Garage listings started').add(1);
}

export function countApproval(outcome: ApprovalOutcome) {
  counter(
    'motorfix_garage_approvals_total',
    'Garage verification decisions, by outcome',
  ).add(1, { outcome });
}

export function countQuote() {
  counter('motorfix_quotes_total', 'Quotes sent to drivers').add(1);
}

// `template` is a name from the e-mail template registry, never an address.
export function countEmail(template: string) {
  counter('motorfix_emails_sent_total', 'E-mails sent, by template').add(1, {
    template,
  });
}

export function countNotification(channel: NotificationChannel) {
  counter(
    'motorfix_notifications_sent_total',
    'Notifications delivered, by channel',
  ).add(1, { channel });
}

export function countJobStep(action: JobStepAction) {
  counter(
    'motorfix_job_steps_total',
    "Changes to a job's steps, by action",
  ).add(1, { action });
}

export function countRequestReceived(outcome: 'built' | 'muted' | 'skipped') {
  counter(
    'motorfix_request_received_total',
    'Garages a new request was announced to, by outcome',
  ).add(1, { outcome });
}

export function countDocumentUploaded(kind: DocumentKind) {
  counter(
    'motorfix_documents_uploaded_total',
    'Document pages confirmed on listing drafts, by kind',
  ).add(1, { kind });
}

export function countDeclarationSigned() {
  counter(
    'motorfix_declarations_signed_total',
    'Listing declarations signed',
  ).add(1);
}

export function countDocumentOpened(kind: DocumentKind) {
  counter(
    'motorfix_documents_opened_total',
    'Document pages opened by an admin, by kind',
  ).add(1, { kind });
}

export function countQuoteReceived(outcome: 'built' | 'muted') {
  counter(
    'motorfix_quote_received_total',
    'Sent quotes announced to their driver, by outcome',
  ).add(1, { outcome });
}

export function countGarageReport(outcome: GarageReportOutcome) {
  counter(
    'motorfix_garage_reports_total',
    'Reports of a garage by a driver, by outcome',
  ).add(1, { outcome });
}

// One per analytics choice stored, visitor or signed in.
export function countConsentRecord(
  decision: 'granted' | 'refused' | 'withdrawn',
) {
  counter(
    'motorfix_consent_records_total',
    'Analytics consent choices stored, by decision',
  ).add(1, { decision });
}
