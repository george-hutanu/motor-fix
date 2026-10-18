import { THROTTLES } from '../../rate-limit/rate-limit.config';

// The numbers consent records live by, its limit from the one place every
// limit is set.
export const RECORDS_PER_HOUR = THROTTLES.consents.limit;
// A browser clock ahead of the server's by more than this is refused.
export const CLOCK_AHEAD_MS = 5 * 60_000;
