const DAY_MS = 24 * 60 * 60 * 1000;

// Fixed when the item is sent: a later change of the retention applies to
// new items only.
export function purgeAfter(sentAt: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`retention must be a whole number of days, got ${days}`);
  }
  return new Date(sentAt.getTime() + days * DAY_MS);
}
