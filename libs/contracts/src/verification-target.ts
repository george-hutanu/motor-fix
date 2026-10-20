// The admins' verification queue rules, free of decorators for the web app.

import {
  DOCUMENT_KINDS,
  type DocumentKind,
} from './legal-documents/legal-documents';
import type {
  Lamp,
  VerificationCheckKind,
  VerificationCheckResult,
} from './verification-checks';

// The target shown to garages is 1 to 2 working days: a file that has
// waited longer is flagged in the admins' queue.
export const VERIFICATION_TARGET_WORKING_DAYS = 2;
export const VERIFICATION_QUEUE_PAGE = 20;
export const VERIFICATION_QUEUE_PANEL = 5;
// The most rows one read answers; the view reads more in several reads.
export const VERIFICATION_QUEUE_MAX = 200;

// The parts of a garage an admin sees changed after a request for more, in
// the order the drawer lists them.
export const VERIFICATION_CHANGE_AREAS = [
  'profile',
  'prices',
  'brands',
  'photos',
  'documents',
] as const;
export type VerificationChangeArea = (typeof VERIFICATION_CHANGE_AREAS)[number];

// The most characters a decision's note holds, counted in code points.
export const VERIFICATION_NOTE_MAX = 1000;

// The fewest characters the note of a rejection or of a request for more
// holds, counted in code points.
export const REJECTION_NOTE_MIN = 10;

// What a rejection names, and what a request for more may ask for.
export const VERIFICATION_REASON_CODES = [
  'documents',
  'rar',
  'address',
  'photos',
  'other',
] as const;
export type VerificationReasonCode = (typeof VERIFICATION_REASON_CODES)[number];

// A report decision's reason the garage is given, and the admins' own note.
export const REPORT_REASON_MAX = 200;
export const REPORT_NOTE_MAX = 1000;

// The most characters a check's detail holds.
export const CHECK_DETAIL_MAX = 200;
// The most characters a failed RAR re-check's detail holds.
export const RECHECK_DETAIL_MAX = 200;

export const RECHECK_RESULTS = ['ok', 'failed'] as const;
export type RecheckResult = (typeof RECHECK_RESULTS)[number];
export const RECHECK_FAILURES = ['expired', 'suspended', 'withdrawn'] as const;
export type RecheckFailure = (typeof RECHECK_FAILURES)[number];

// Whether the re-check recorded last is valid and not older than the stored
// day of last check, which a valid re-check moves and a new approval resets.
export function recheckedSince(
  latest: { checkedOn: string; result: RecheckResult } | null | undefined,
  lastCheckedOn: string | null,
): boolean {
  return (
    latest?.result === 'ok' &&
    !!lastCheckedOn &&
    latest.checkedOn >= lastCheckedOn
  );
}

const LAMPS: Record<VerificationCheckResult, Lamp> = {
  failed: 'red',
  not_run: 'grey',
  ok: 'green',
  warning: 'amber',
};

// A check's lamp: its result as a colour.
export const lamp = (result: VerificationCheckResult): Lamp => LAMPS[result];

// A row's one lamp: a failed check first, then the flag or a warning, then
// any check passed.
export function queueLamp(
  checks: readonly { result: VerificationCheckResult }[],
  flagged: boolean,
): Lamp {
  const has = (result: VerificationCheckResult) =>
    checks.some((check) => check.result === result);
  if (has('failed')) return 'red';
  if (flagged || has('warning')) return 'amber';
  return has('ok') ? 'green' : 'grey';
}

// Whether a price-list job falls under the ticked RAR activities: a job with
// no mapped activity (null or empty) is covered, and an empty list covers every job.
export function coversJob(
  rarActivity: string | null,
  activities: readonly string[],
): boolean {
  return (
    !rarActivity || activities.length === 0 || activities.includes(rarActivity)
  );
}

// The jobs the ticked activities leave uncovered, in their order.
export function uncoveredJobs<T extends { rarActivity: string | null }>(
  jobs: readonly T[],
  activities: readonly string[],
): T[] {
  return jobs.filter((job) => !coversJob(job.rarActivity, activities));
}

// The guide checks an approval may pass over with a note, in the drawer's
// order; rar and caen are gates and never pass over.
const GUIDE_KINDS = [
  'company',
  'activities',
  'representative',
  'address',
  'photos',
  'documents',
] as const satisfies readonly VerificationCheckKind[];

export type ApprovalGap =
  | {
      kind: (typeof GUIDE_KINDS)[number];
      result: Exclude<VerificationCheckResult, 'ok'>;
    }
  | { document: DocumentKind };

// What an approval passes over: each guide check not ok (a check the file has
// no row for counts as not run), then each legal document the file lacks.
export function approvalGaps(
  checks: readonly { kind: string; result: VerificationCheckResult }[],
  documentKinds: readonly string[],
): ApprovalGap[] {
  const result = (kind: string) =>
    checks.find((check) => check.kind === kind)?.result ?? 'not_run';
  return [
    ...GUIDE_KINDS.flatMap((kind) => {
      const found = result(kind);
      return found === 'ok' ? [] : [{ kind, result: found }];
    }),
    ...DOCUMENT_KINDS.filter((kind) => !documentKinds.includes(kind)).map(
      (document) => ({ document }),
    ),
  ];
}

const GAP_RESULTS = [
  'not_run',
  'warning',
  'failed',
] as const satisfies readonly Exclude<VerificationCheckResult, 'ok'>[];

// A list of what an approval passes over as the server sent it (the
// note_required refusal's `missing`): the list when every line is one
// approvalGaps could have made, else none.
export function approvalGapsFrom(value: unknown): ApprovalGap[] | null {
  if (!Array.isArray(value)) return null;
  const gaps: ApprovalGap[] = [];
  for (const line of value as unknown[]) {
    const gap = gapFrom(line);
    if (!gap) return null;
    gaps.push(gap);
  }
  return gaps;
}

function gapFrom(line: unknown): ApprovalGap | null {
  if (typeof line !== 'object' || line === null) return null;
  const { document, kind, result } = line as Record<string, unknown>;
  const missingDocument = DOCUMENT_KINDS.find((known) => known === document);
  if (missingDocument) return { document: missingDocument };
  const guide = GUIDE_KINDS.find((known) => known === kind);
  const notOk = GAP_RESULTS.find((known) => known === result);
  return guide && notOk ? { kind: guide, result: notOk } : null;
}
