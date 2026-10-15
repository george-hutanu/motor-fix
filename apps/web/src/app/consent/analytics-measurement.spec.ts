import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ANALYTICS_EVENTS } from './analytics-events';

const LIST = join(__dirname, '../../../../../docs/analytics-measurement.md');
const read = () => readFileSync(LIST, 'utf8');

const cells = (line: string) =>
  line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
const rowOf = (text: string, first: string) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map(cells)
    .find((row) => row[0] === first);

const UNBUILT = [
  'filter_applied',
  'garage_saved',
  'message_sent',
  'quote_accepted',
  'review_posted',
  'survey_completed',
];

// @traces 250-FR-009
describe('the launch measurement list', () => {
  it.each(Object.keys(ANALYTICS_EVENTS))(
    'lists %s with its surface and whether it is built',
    (name) => {
      const row = rowOf(read(), `\`${name}\``);
      expect(row).toBeDefined();
      const [, surface, built] = row as string[];
      expect(surface).not.toBe('');
      expect(built).toBe(UNBUILT.includes(name) ? 'not built' : 'built');
    },
  );

  it.each([
    'Garages live',
    'Requests sent',
    'Answer rate',
    'Bookings',
    '`requests_quoted`',
    '`requests_accepted`',
    '`bookings_confirmed`',
    '`jobs_done`',
    '`reviews_posted`',
  ])('defines the database count %s', (figure) => {
    const row = rowOf(read(), figure);
    expect(row).toBeDefined();
    expect((row as string[]).at(-1)?.length).toBeGreaterThan(20);
  });

  it('names the two funnels to set up in Plausible, step by step', () => {
    const text = read();
    expect(text).toContain(
      'Home → `brand_picked` → `garage_opened` → `quote_request_started` → `quote_request_sent` → `quote_accepted` → `review_posted`',
    );
    expect(text).toContain(
      '`listing_started` → `listing_step_completed` step 6 → `survey_completed` → `listing_submitted`',
    );
    expect(text).toMatch(/one goal per event/i);
  });

  it('maps every launch figure to an event, a database count or not measured at launch', () => {
    const rows = read()
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map(cells)
      .filter((row) => row.length === 5 && row[0] !== 'Feature');
    const how = rows.filter((row) => !/^-+$/.test(row[0])).map((row) => row[2]);
    expect(how.length).toBeGreaterThanOrEqual(15);
    for (const cell of how)
      expect(cell).toMatch(
        /^(`[a-z_]+`|database count|not measured at launch)/,
      );
  });

  it('keeps the comparison against direct counts after the pilot as a manual item', () => {
    expect(read()).toMatch(
      /- \[ \] After the pilot, compare the overview's figures with direct database counts/,
    );
  });
});
