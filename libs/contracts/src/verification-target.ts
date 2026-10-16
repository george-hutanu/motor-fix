// The admins' verification queue rules, free of decorators for the web app.

import type { Lamp, VerificationCheckResult } from './verification-checks';

// The target shown to garages is 1 to 2 working days: a file that has
// waited longer is flagged in the admins' queue.
export const VERIFICATION_TARGET_WORKING_DAYS = 2;
export const VERIFICATION_QUEUE_PAGE = 20;
export const VERIFICATION_QUEUE_PANEL = 5;
// The most rows one read answers: the view shows no more than this.
export const VERIFICATION_QUEUE_MAX = 200;

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
