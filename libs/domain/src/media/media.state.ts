import type { MediaStatus } from '@motor-fix/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

// The moves a media item may make (FR-001); every other one is refused.
const MOVES: Readonly<Record<MediaStatus, readonly MediaStatus[]>> = {
  failed: ['purged'],
  processing: ['visible', 'failed'],
  purged: [],
  removed: ['purged'],
  visible: ['removed', 'purged'],
};

export function mayMove(from: MediaStatus, to: MediaStatus): boolean {
  return MOVES[from].includes(to);
}

// The statuses the nightly purge takes an item from.
export const PURGEABLE = (Object.keys(MOVES) as MediaStatus[]).filter((from) =>
  mayMove(from, 'purged'),
);

// Fixed when the item is sent: a later change of the retention applies to
// new items only.
export function purgeAfter(sentAt: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`retention must be a whole number of days, got ${days}`);
  }
  return new Date(sentAt.getTime() + days * DAY_MS);
}
