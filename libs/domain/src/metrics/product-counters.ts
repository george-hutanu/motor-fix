import { type Counter, metrics } from '@opentelemetry/api';

// The product's key numbers, one counter each, created on first use so a
// process that never starts telemetry pays nothing. Every label comes from a
// fixed set: no identifier, address or free text ever becomes a series.

export type SearchOutcome = 'results' | 'none';
export type SignInMethod = 'password' | 'phone' | 'google' | 'apple';
export type ApprovalOutcome = 'approved' | 'rejected';
export type NotificationChannel = 'push' | 'in-app';

const counters = new Map<string, Counter>();

function counter(name: string, description: string): Counter {
  let found = counters.get(name);
  if (!found) {
    found = metrics.getMeter('motorfix').createCounter(name, { description });
    counters.set(name, found);
  }
  return found;
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
