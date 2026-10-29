// The nightly media purge: at 03:00 Bucharest time, before the other
// retention run at 04:00. An item still waiting for its upload a day after
// it was asked for has been abandoned.
export const MEDIA_RETENTION = {
  batch: 200,
  cron: '0 3 * * *',
  stuckAfterHours: 24,
  // Long enough for one item's deletes at the store and the provider.
  transactionMs: 60_000,
  tz: 'Europe/Bucharest',
} as const;

export const MEDIA_RETENTION_QUEUE = 'media-retention';
