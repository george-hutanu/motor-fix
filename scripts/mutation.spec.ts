import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  flags,
  hasSpecs,
  mutationScore,
  strykerOptions,
  summaryRows,
} from './mutation.ts';

describe('flags', () => {
  it('reads the flags as typed and as Nx forwards them', () => {
    expect(flags(['--incremental', '--mutate', 'a.ts'])).toEqual({
      incremental: true,
      only: 'a.ts',
    });
    expect(flags(['--incremental=true', '--mutate=a.ts'])).toEqual({
      incremental: true,
      only: 'a.ts',
    });
  });

  it('defaults to a full run of the whole project', () => {
    expect(flags([])).toEqual({ incremental: false, only: undefined });
    expect(flags(['--incremental=false'])).toEqual({
      incremental: false,
      only: undefined,
    });
  });
});

let repo: string;
const cwd = process.cwd();

function write(path: string, content = '') {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), content);
}

const floor = (value: number) =>
  JSON.stringify({ thresholds: { break: value, high: 80, low: 60 } });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'mutation-'));
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(repo, { force: true, recursive: true });
});

describe('strykerOptions', () => {
  it('runs a lib with its own Jest config and lib tsconfig, mutating src without specs or generated code', () => {
    write('libs/x/stryker.config.json', floor(70));
    write('libs/x/tsconfig.lib.json', '{}');

    const options = strykerOptions('x', 'libs/x', false);

    expect(options.testRunner).toBe('jest');
    expect(options.jest).toEqual(
      expect.objectContaining({ configFile: 'libs/x/jest.config.cts' }),
    );
    expect(options.checkers).toEqual(['typescript']);
    expect(options.tsconfigFile).toBe('libs/x/tsconfig.lib.json');
    expect(options.mutate).toEqual([
      'libs/x/src/**/*.ts',
      '!libs/x/src/**/*.spec.ts',
      '!libs/x/src/**/*.test.ts',
      '!libs/x/src/**/generated/**',
      '!libs/x/src/**/test-setup.ts',
    ]);
    expect(options.ignoreStatic).toBe(true);
    expect(options.thresholds).toEqual({ break: 70, high: 80, low: 60 });
  });

  it('uses the app tsconfig when a project has no lib tsconfig', () => {
    write('apps/y/stryker.config.json', floor(0));
    write('apps/y/tsconfig.app.json', '{}');

    expect(strykerOptions('y', 'apps/y', false).tsconfigFile).toBe(
      'apps/y/tsconfig.app.json',
    );
  });

  it('keeps reports per project and turns incremental mode on only when asked', () => {
    write('libs/x/stryker.config.json', floor(0));

    const full = strykerOptions('x', 'libs/x', false);
    const incremental = strykerOptions('x', 'libs/x', true);

    expect(full.incremental).toBe(false);
    expect(incremental.incremental).toBe(true);
    expect(incremental.incrementalFile).toBe(
      'reports/mutation/x/incremental.json',
    );
    expect(incremental.htmlReporter).toEqual({
      fileName: 'reports/mutation/x/index.html',
    });
  });

  it('narrows the run to the files a caller names, over the project file', () => {
    write(
      'libs/x/stryker.config.json',
      JSON.stringify({ mutate: ['libs/x/src/*.ts'], thresholds: { break: 0 } }),
    );

    expect(
      strykerOptions('x', 'libs/x', false, 'libs/x/src/one.ts').mutate,
    ).toEqual(['libs/x/src/one.ts']);
  });

  it("lets the project's own file override a shared option", () => {
    write(
      'scripts/stryker.config.json',
      JSON.stringify({
        mutate: ['scripts/*.ts', '!scripts/*.spec.ts'],
        thresholds: { break: 10, high: 80, low: 60 },
        tsconfigFile: 'scripts/tsconfig.json',
      }),
    );

    const options = strykerOptions('scripts', 'scripts', false);

    expect(options.mutate).toEqual(['scripts/*.ts', '!scripts/*.spec.ts']);
    expect(options.tsconfigFile).toBe('scripts/tsconfig.json');
    expect(options.testRunner).toBe('jest');
  });

  it('names the file when its JSON does not parse', () => {
    write('libs/x/stryker.config.json', '{');

    expect(() => strykerOptions('x', 'libs/x', false)).toThrow(
      'libs/x/stryker.config.json',
    );
  });

  it('refuses a config with no floor and names the file', () => {
    write('libs/x/stryker.config.json', JSON.stringify({ mutate: [] }));

    expect(() => strykerOptions('x', 'libs/x', false)).toThrow(
      'libs/x/stryker.config.json',
    );
  });

  it('refuses a project with no stryker.config.json and names the file', () => {
    write('libs/x/tsconfig.lib.json', '{}');

    expect(() => strykerOptions('x', 'libs/x', false)).toThrow(
      'libs/x/stryker.config.json',
    );
  });
});

describe('hasSpecs', () => {
  it('finds a spec file anywhere under the project', () => {
    write('apps/y/src/deep/thing.spec.ts');
    expect(hasSpecs('apps/y')).toBe(true);
  });

  it('counts a .test.ts file as a test', () => {
    write('apps/y/src/thing.test.ts');
    expect(hasSpecs('apps/y')).toBe(true);
  });

  it('is false for a project with source but no tests', () => {
    write('apps/y/src/main.ts');
    expect(hasSpecs('apps/y')).toBe(false);
  });

  it('ignores specs inside node_modules', () => {
    write('apps/y/node_modules/dep/a.spec.ts');
    expect(hasSpecs('apps/y')).toBe(false);
  });
});

describe('mutationScore', () => {
  it('counts killed and timed-out mutants as detected, survivors and uncovered as not', () => {
    expect(mutationScore(['Killed', 'Timeout', 'Survived', 'NoCoverage'])).toBe(
      50,
    );
  });

  it('leaves compile errors, runtime errors and ignored mutants out', () => {
    expect(
      mutationScore(['Killed', 'CompileError', 'RuntimeError', 'Ignored']),
    ).toBe(100);
  });

  it('is undefined when no mutant counts', () => {
    expect(mutationScore(['CompileError', 'Ignored'])).toBeNull();
    expect(mutationScore([])).toBeNull();
  });
});

describe('summaryRows', () => {
  it('starts an empty summary with the table header', () => {
    expect(summaryRows('', 'api', 87.5, 80)).toBe(
      '| Project | Mutation score | Floor |\n|---|---|---|\n| api | 87.50% | 80 |\n',
    );
  });

  it('adds only a row to a summary that already has the table', () => {
    const existing =
      '| Project | Mutation score | Floor |\n|---|---|---|\n| api | 87.50% | 80 |\n';
    expect(summaryRows(existing, 'domain', 61, 55)).toBe(
      '| domain | 61.00% | 55 |\n',
    );
  });

  it('writes n/a for an undefined score', () => {
    expect(summaryRows('x', 'mcp', null, 0)).toBe('| mcp | n/a | 0 |\n');
  });
});
