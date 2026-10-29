import { MEDIA_LIMITS } from '@motor-fix/contracts';

// The media queue's settings: two tries in all, each converting for at most
// ten minutes in all (one deadline shared by every ffprobe and ffmpeg run of
// the try), the lock held a minute past that so no second worker takes the
// job while the try reads and writes its files.
export const MEDIA_PROCESSING = {
  attempts: MEDIA_LIMITS.conversionAttempts,
  backoffMs: 5_000,
  lockDurationMs: MEDIA_LIMITS.conversionTimeoutMs + 60_000,
} as const;

export const MEDIA_QUEUE = 'media';
