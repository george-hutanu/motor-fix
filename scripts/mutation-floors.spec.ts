import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { flags, strykerOptions, summaryRows } from './mutation.ts';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

// Every project with a stryker.config.json.
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
    '%s has an integer floor from 0 to 100 and low under high',
    (_name, [dir]) => {
      const { thresholds } = JSON.parse(read(`${dir}/stryker.config.json`));

      expect(Number.isInteger(thresholds.break)).toBe(true);
      expect(thresholds.break).toBeGreaterThanOrEqual(0);
      expect(thresholds.low).toBeLessThan(thresholds.high);
    },
  );

  it.each(Object.entries(floors))(
    '%s still gets the angular ignorer from its own config',
    (name, [dir]) => {
      expect(strykerOptions(name, join(root, dir), false).ignorers).toEqual([
        'angular',
      ]);
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

  it('writes the four-column header once, on an empty summary only', () => {
    const first = summaryRows('', 'p', 100, 95, 60_000);

    expect(first).toBe(
      '| Project | Mutation score | Floor | Minutes |\n|---|---|---|---|\n| p | 100.00% | 95 | 1.0 |\n',
    );
    expect(summaryRows(first, 'q', 100, 95, 60_000)).not.toContain('Project');
  });

  it('keeps a pipe-free row for hostile project names of one cell', () => {
    expect(summaryRows('x', 'a b', 0, 0, 1).split('\n')[0]).toBe(
      '| a b | 0.00% | 0 | 0.0 |',
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

describe('mutation workflow dispatch and limit', () => {
  const workflow = read('.github/workflows/mutation.yml');

  it('sets a whole-minute limit within GitHub ceiling, on a multiple of ten', () => {
    const limit = Number(/timeout-minutes: (\S+)/.exec(workflow)?.[1]);

    expect(Number.isInteger(limit)).toBe(true);
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(360);
    expect(limit % 10).toBe(0);
  });

  it('states, next to the limit, the runs it was derived from', () => {
    const lines = workflow.split('\n');
    const at = lines.findIndex((l) => l.includes('timeout-minutes'));

    expect(lines[at - 1]).toMatch(/\d{11}/);
    expect(lines[at - 1]).toMatch(/30%/);
  });

  it('keeps the limit no lower than the longest measured full job plus 30%, capped', () => {
    const limit = Number(/timeout-minutes: (\S+)/.exec(workflow)?.[1]);
    const webJob = 143;

    expect(limit).toBeGreaterThanOrEqual(
      Math.min(360, Math.ceil((webJob * 1.3) / 10) * 10),
    );
  });
});
