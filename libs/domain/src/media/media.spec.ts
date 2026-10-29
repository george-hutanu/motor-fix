import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MEDIA_STATUSES, type MediaStatus } from '@motor-fix/contracts';

import { mayMove, purgeAfter } from './media.state';

const ALLOWED: ReadonlyArray<[MediaStatus, MediaStatus]> = [
  ['processing', 'visible'],
  ['processing', 'failed'],
  ['visible', 'removed'],
  ['visible', 'purged'],
  ['failed', 'purged'],
  ['removed', 'purged'],
];

// @traces 333-media-storage-FR-001
describe('a media item’s life', () => {
  it.each(ALLOWED)('moves from %s to %s', (from, to) => {
    expect(mayMove(from, to)).toBe(true);
  });

  const refused = MEDIA_STATUSES.flatMap((from) =>
    MEDIA_STATUSES.filter(
      (to) => !ALLOWED.some(([a, b]) => a === from && b === to),
    ).map((to) => [from, to] as [MediaStatus, MediaStatus]),
  );

  it.each(refused)('refuses %s to %s', (from, to) => {
    expect(mayMove(from, to)).toBe(false);
  });

  it('never leaves purged', () => {
    for (const to of MEDIA_STATUSES) expect(mayMove('purged', to)).toBe(false);
  });

  it('keeps an item the retention days after it was sent', () => {
    const sent = new Date('2026-01-31T22:30:00.000Z');
    expect(purgeAfter(sent, 90).toISOString()).toBe('2026-05-01T22:30:00.000Z');
    expect(purgeAfter(sent, 1).toISOString()).toBe('2026-02-01T22:30:00.000Z');
  });

  it('refuses a retention that is not a whole positive number of days', () => {
    const sent = new Date('2026-01-01T00:00:00.000Z');
    expect(() => purgeAfter(sent, 0)).toThrow();
    expect(() => purgeAfter(sent, 1.5)).toThrow();
  });

  it('holds a caption of at most 140 characters in the table', () => {
    const schema = readFileSync(
      join(__dirname, '../../prisma/schema/media.prisma'),
      'utf8',
    );
    expect(schema).toMatch(/caption\s+String\?\s+@db\.VarChar\(140\)/);
    expect(schema).toMatch(/@@index\(\[jobId, sentAt\]\)/);
    expect(schema).toMatch(/@@index\(\[status, purgeAfter\]\)/);
  });
});
