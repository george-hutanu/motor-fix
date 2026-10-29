import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { purgeAfter } from './media.state';

// @traces 333-FR-001
describe('a media item’s life', () => {
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
