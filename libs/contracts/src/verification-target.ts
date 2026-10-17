// The admins' verification queue rules, free of decorators for the web app.

import type { Lamp, VerificationCheckResult } from './verification-checks';

// The target shown to garages is 1 to 2 working days: a file that has
// waited longer is flagged in the admins' queue.
export const VERIFICATION_TARGET_WORKING_DAYS = 2;
export const VERIFICATION_QUEUE_PAGE = 20;
export const VERIFICATION_QUEUE_PANEL = 5;
// The most rows one read answers; the view reads more in several reads.
export const VERIFICATION_QUEUE_MAX = 200;

// The most characters a check's detail holds.
export const CHECK_DETAIL_MAX = 200;

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
