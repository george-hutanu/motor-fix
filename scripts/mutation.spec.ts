// @traces 1159-FR-004 1159-FR-009 1159-FR-012 1159-FR-016 1159-FR-019
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearReports,
  flags,
  hasSpecs,
  mutationScore,
  reportsDir,
  scoreRecord,
  strykerOptions,
  summaryRows,
} from './mutation.ts';
import { projectFloor } from './mutation-plan.ts';

describe('flags', () => {
  it('reads the flags as typed and as Nx forwards them', () => {
    expect(
      flags(['--incremental', '--mutate', 'a.ts', '--shard', 'auth']),
    ).toEqual({ incremental: true, only: 'a.ts', shard: 'auth' });
    expect(
      flags(['--incremental=true', '--mutate=a.ts', '--shard=auth']),
    ).toEqual({ incremental: true, only: 'a.ts', shard: 'auth' });
  });

  it('defaults to a full run of the whole project', () => {
    expect(flags([])).toEqual({
      incremental: false,
      only: undefined,
      shard: undefined,
    });
    expect(flags(['--incremental=false', '--shard='])).toEqual({
      incremental: false,
      only: undefined,
      shard: undefined,
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

  // A mutated `{ alias: 'x' }` given to input() is no longer a literal
  // Angular can analyse (error 1010); Stryker's angular ignorer leaves it be.
  it("turns on Stryker's angular ignorer", () => {
    write('libs/x/stryker.config.json', floor(0));

    expect(strykerOptions('x', 'libs/x', false).ignorers).toEqual(['angular']);
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

  // Stryker reads the Jest config without normalising it, so a
  // `<rootDir>/…` environment reaches it as a module name it cannot find.
  it("resolves a project's own <rootDir> test environment file for Stryker", () => {
    write('libs/x/stryker.config.json', floor(0));
    write(
      'libs/x/jest.config.cts',
      "module.exports = {\n  testEnvironment: '<rootDir>/src/env.cjs',\n};\n",
    );

    expect(strykerOptions('x', 'libs/x', false).jest).toEqual({
      config: { testEnvironment: join(process.cwd(), 'libs/x/src/env.cjs') },
      configFile: 'libs/x/jest.config.cts',
    });
  });

  it('leaves a built-in test environment to the Jest config', () => {
    write('libs/x/stryker.config.json', floor(0));
    write('libs/x/jest.config.cts', "  testEnvironment: 'jsdom',\n");

    expect(strykerOptions('x', 'libs/x', false).jest).toEqual({
      configFile: 'libs/x/jest.config.cts',
    });
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

describe('strykerOptions for a shard', () => {
  beforeEach(() => {
    write('libs/x/stryker.config.json', floor(70));
    write(
      'libs/x/jest.config.cts',
      "module.exports = {\n  testEnvironment: '<rootDir>/src/env.cjs',\n};\n",
    );
    write(
      'scripts/mutation-shards.json',
      JSON.stringify({
        default: { measured: 'm', timeout: 60 },
        projects: {
          x: {
            measured: 'm',
            shards: { auth: { folders: ['auth'], measured: 'm', timeout: 60 } },
            timeout: 60,
          },
        },
      }),
    );
  });

  it('mutates only the shard and runs only its specs', () => {
    const options = strykerOptions('x', 'libs/x', false, undefined, 'auth');

    expect(options.mutate).toEqual([
      'libs/x/src/auth/**/*.ts',
      '!libs/x/src/**/*.spec.ts',
      '!libs/x/src/**/*.test.ts',
      '!libs/x/src/**/generated/**',
      '!libs/x/src/**/test-setup.ts',
    ]);
    expect(options.jest).toEqual({
      config: {
        testEnvironment: join(process.cwd(), 'libs/x/src/env.cjs'),
        testMatch: ['**/libs/x/src/auth/**/*.{spec,test}.ts'],
        testPathIgnorePatterns: ['/node_modules/'],
      },
      configFile: 'libs/x/jest.config.cts',
    });
  });

  it('gives rest every spec outside the named shards', () => {
    const options = strykerOptions('x', 'libs/x', false, undefined, 'rest');

    expect(options.jest).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          testMatch: ['**/libs/x/src/**/*.{spec,test}.ts'],
          testPathIgnorePatterns: ['/node_modules/', '/libs/x/src/auth/'],
        }),
      }),
    );
  });

  it('keeps reports and the incremental file per shard', () => {
    const options = strykerOptions('x', 'libs/x', true, undefined, 'auth');

    expect(options.incrementalFile).toBe(
      'reports/mutation/x/auth/incremental.json',
    );
    expect(options.htmlReporter).toEqual({
      fileName: 'reports/mutation/x/auth/index.html',
    });
    expect(options.jsonReporter).toEqual({
      fileName: 'reports/mutation/x/auth/mutation.json',
    });
    expect(options.reporters).toEqual(
      expect.arrayContaining(['html', 'json', 'clear-text']),
    );
  });

  // A shard's partial score is never held to the floor: the summary job
  // compares the combined score of all shards.
  it("turns Stryker's break off for a shard and leaves it on without one", () => {
    expect(
      strykerOptions('x', 'libs/x', false, undefined, 'auth').thresholds,
    ).toEqual({ break: null, high: 80, low: 60 });
    expect(strykerOptions('x', 'libs/x', false).thresholds).toEqual({
      break: 70,
      high: 80,
      low: 60,
    });
  });

  it('refuses a shard the project does not have, and a shard of an unsharded project', () => {
    write('libs/y/stryker.config.json', floor(0));

    expect(() =>
      strykerOptions('x', 'libs/x', false, undefined, 'nope'),
    ).toThrow('nope');
    expect(() =>
      strykerOptions('y', 'libs/y', false, undefined, 'auth'),
    ).toThrow('y');
  });
});

describe('strykerOptions shared limits', () => {
  // The initial test run of a big project (domain: 329 specs) outran
  // Stryker's 5-minute default (run 38037093986).
  it('gives every project an initial test run longer than the 5-minute default', () => {
    write('libs/x/stryker.config.json', floor(0));

    expect(
      strykerOptions('x', 'libs/x', false).dryRunTimeoutMinutes,
    ).toBeGreaterThan(5);
  });

  it('treats a missing Jest config as none and raises any other read error', () => {
    write('libs/x/stryker.config.json', floor(0));
    expect(strykerOptions('x', 'libs/x', false).jest).toEqual({
      configFile: 'libs/x/jest.config.cts',
    });

    mkdirSync(join(repo, 'libs/x/jest.config.cts'));
    expect(() => strykerOptions('x', 'libs/x', false)).toThrow('EISDIR');
  });
});

describe('reportsDir', () => {
  it('names the folder by project, and by shard when there is one', () => {
    expect(reportsDir('domain')).toBe('reports/mutation/domain');
    expect(reportsDir('domain', 'auth')).toBe('reports/mutation/domain/auth');
  });
});

describe('projectFloor', () => {
  it('reads the floor from the project stryker.config.json', () => {
    write('libs/x/stryker.config.json', floor(70));

    expect(projectFloor('libs/x')).toBe(70);
  });

  it('refuses a config with no floor and names the file', () => {
    write('libs/x/stryker.config.json', JSON.stringify({ mutate: [] }));

    expect(() => projectFloor('libs/x')).toThrow('libs/x/stryker.config.json');
  });
});

describe('clearReports', () => {
  // The cache restores the last run's reports: a job cut off before it
  // writes its own must leave no score for the summary to take as this run's.
  it('removes the last run score and reports, keeping the incremental file', () => {
    for (const name of [
      'score.json',
      'mutation.json',
      'index.html',
      'incremental.json',
    ])
      write(`reports/mutation/x/${name}`, '{}');

    clearReports('reports/mutation/x');

    expect(existsSync(join(repo, 'reports/mutation/x/score.json'))).toBe(false);
    expect(existsSync(join(repo, 'reports/mutation/x/mutation.json'))).toBe(
      false,
    );
    expect(existsSync(join(repo, 'reports/mutation/x/index.html'))).toBe(false);
    expect(existsSync(join(repo, 'reports/mutation/x/incremental.json'))).toBe(
      true,
    );
  });

  it('does nothing when there are no reports yet', () => {
    expect(() => clearReports('reports/mutation/none')).not.toThrow();
  });
});

describe('scoreRecord', () => {
  it('counts each kind of mutant with the floor, minutes and score', () => {
    expect(
      scoreRecord(
        'domain',
        'auth',
        ['Killed', 'Killed', 'Timeout', 'Survived', 'NoCoverage', 'Ignored'],
        55,
        90_000,
      ),
    ).toEqual({
      floor: 55,
      killed: 2,
      minutes: 1.5,
      noCoverage: 1,
      project: 'domain',
      score: 60,
      shard: 'auth',
      survived: 1,
      timeout: 1,
    });
  });

  it('leaves the shard empty and the score null for an unsharded run with no valid mutant', () => {
    expect(scoreRecord('media', '', [], 85, 0)).toEqual(
      expect.objectContaining({ score: null, shard: '' }),
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
    expect(summaryRows('', 'api', 87.5, 80, 185_000)).toBe(
      '| Project | Mutation score | Floor | Minutes |\n|---|---|---|---|\n| api | 87.50% | 80 | 3.1 |\n',
    );
  });

  it('adds only a row to a summary that already has the table', () => {
    const existing =
      '| Project | Mutation score | Floor | Minutes |\n|---|---|---|---|\n| api | 87.50% | 80 | 3.1 |\n';
    expect(summaryRows(existing, 'domain', 61, 55, 5_710_000)).toBe(
      '| domain | 61.00% | 55 | 95.2 |\n',
    );
  });

  it('writes n/a for an undefined score', () => {
    expect(summaryRows('x', 'mcp', null, 0, 0)).toBe(
      '| mcp | n/a | 0 | 0.0 |\n',
    );
  });
});
