import { MEDIA_LIMITS } from '@motor-fix/contracts';

// The media queue's settings: two tries in all, each converting for at most
// ten minutes, the lock held past that so no second worker takes the job.
export const MEDIA_PROCESSING = {
  attempts: MEDIA_LIMITS.conversionAttempts,
  backoffMs: 5_000,
  lockDurationMs: MEDIA_LIMITS.conversionTimeoutMs + 60_000,
} as const;

export const MEDIA_QUEUE = 'media';
