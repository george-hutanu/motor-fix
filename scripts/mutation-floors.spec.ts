import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { flags, summaryRows } from './mutation.ts';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

// The floors the full runs set; a floor may only rise (FR-007).
const floors: Record<string, [string, number]> = {
  api: ['apps/api', 95],
  contracts: ['libs/contracts', 95],
  domain: ['libs/domain', 0],
  i18n: ['libs/i18n', 85],
  mcp: ['apps/mcp', 95],
  media: ['libs/media', 85],
  overlays: ['libs/overlays', 76],
  scripts: ['scripts', 46],
  'ui-cockpit': ['libs/ui-cockpit', 66],
  web: ['apps/web', 79],
  worker: ['apps/worker', 0],
};

describe('every project floor', () => {
  it.each(Object.entries(floors))(
    '%s keeps an integer floor no lower than recorded, at most 100, low under high',
    (_name, [dir, recorded]) => {
      const { thresholds } = JSON.parse(read(`${dir}/stryker.config.json`));

      expect(Number.isInteger(thresholds.break)).toBe(true);
      expect(thresholds.break).toBeGreaterThanOrEqual(recorded);
      expect(thresholds.break).toBeLessThanOrEqual(100);
      expect(thresholds.low).toBeLessThan(thresholds.high);
    },
  );
});

describe('summaryRows minutes', () => {
  it('shows zero minutes for a run that took no time', () => {
    expect(summaryRows('x', 'p', 50, 40, 0)).toBe(
      '| p | 50.00% | 40 | 0.0 |\n',
    );
  });

  it('rounds minutes to one decimal and never rounds a minute away', () => {
    expect(summaryRows('x', 'p', 50, 40, 59_999)).toBe(
      '| p | 50.00% | 40 | 1.0 |\n',
    );
    expect(summaryRows('x', 'p', 50, 40, 90_000)).toContain('| 1.5 |');
  });

  it('shows the 360-minute ceiling and beyond without clipping', () => {
    expect(summaryRows('x', 'p', 1, 0, 360 * 60_000)).toContain('| 360.0 |');
    expect(summaryRows('x', 'p', 1, 0, 1_000 * 60_000)).toContain('| 1000.0 |');
  });

  it('writes n/a with the minutes for a project with nothing to score', () => {
    expect(summaryRows('x', 'p', null, 0, 120_000)).toBe(
      '| p | n/a | 0 | 2.0 |\n',
    );
  });
});

describe('flags edge cases', () => {
  it('reads an empty --mutate value as no narrowing in the options', () => {
    expect(flags(['--mutate']).only).toBe('');
    expect(flags(['--mutate=']).only).toBe('');
  });

  it('treats --incremental=false and a bare absent flag alike, and anything else as on', () => {
    expect(flags(['--incremental=false']).incremental).toBe(false);
    expect(flags(['--incremental=FALSE']).incremental).toBe(true);
    expect(flags(['--incremental=0']).incremental).toBe(true);
  });

  it('does not mistake a longer flag for incremental', () => {
    expect(flags(['--incrementalx=true']).incremental).toBe(false);
  });
});
