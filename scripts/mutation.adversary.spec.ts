import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
} from './mutation.ts';
import { mutationProjects } from './mutation-plan.ts';

const realRepo = join(__dirname, '..');
const mutationScript = join(__dirname, 'mutation.ts');

let dir: string;

// strykerOptions reads project paths from the working directory, which is
// the scripts project when Nx runs this file.
const cwd = process.cwd();
beforeAll(() => process.chdir(realRepo));
afterAll(() => process.chdir(cwd));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mutation-run-adv-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const projects = mutationProjects(realRepo);
const configOf = (root: string) =>
  JSON.parse(readFileSync(join(realRepo, root, 'stryker.config.json'), 'utf8'));

describe('every project in the repository', () => {
  it.each(projects.map((p) => [p.name, p.root]))(
    'gives %s an initial test run limit above five minutes',
    (name, root) => {
      expect(
        (
          strykerOptions(name as string, root as string, false) as {
            dryRunTimeoutMinutes: number;
          }
        ).dryRunTimeoutMinutes,
      ).toBeGreaterThan(5);
    },
  );

  it('runs the scripts project in place and leaves its floor in the config', () => {
    const options = strykerOptions('scripts', 'scripts', false) as Record<
      string,
      unknown
    >;

    expect(options['inPlace']).toBe(true);
    expect((options['thresholds'] as { break: number }).break).toBe(
      configOf('scripts').thresholds.break,
    );
  });

  it('keeps stryker working files out of git for the in-place project', () => {
    const ignored = execFileSync(
      'git',
      [
        'check-ignore',
        'reports/mutation/scripts/incremental.json',
        '.stryker-tmp/x',
      ],
      {
        cwd: realRepo,
        encoding: 'utf8',
      },
    );

    expect(ignored.trim().split('\n')).toEqual([
      'reports/mutation/scripts/incremental.json',
      '.stryker-tmp/x',
    ]);
  });
});

describe('strykerOptions for a shard', () => {
  it('switches the break off for a shard and keeps it for the whole project', () => {
    const shard = strykerOptions(
      'domain',
      'libs/domain',
      false,
      undefined,
      'rest',
    ) as Record<string, any>;
    const whole = strykerOptions('api', 'apps/api', false) as Record<
      string,
      any
    >;

    expect(shard['thresholds'].break).toBeNull();
    expect(shard['thresholds'].high).toBe(
      configOf('libs/domain').thresholds.high,
    );
    expect(whole['thresholds'].break).toBe(
      configOf('apps/api').thresholds.break,
    );
  });

  it('keeps each shard report apart from the others and from the project report', () => {
    const a = strykerOptions(
      'domain',
      'libs/domain',
      true,
      undefined,
      'auth-core',
    ) as Record<string, any>;
    const b = strykerOptions(
      'domain',
      'libs/domain',
      true,
      undefined,
      'rest',
    ) as Record<string, any>;

    expect(a['incrementalFile']).toBe(
      'reports/mutation/domain/auth-core/incremental.json',
    );
    expect(b['incrementalFile']).not.toBe(a['incrementalFile']);
    expect(a['htmlReporter'].fileName).toBe(
      'reports/mutation/domain/auth-core/index.html',
    );
    expect(a['jsonReporter'].fileName).toBe(
      'reports/mutation/domain/auth-core/mutation.json',
    );
  });

  it('allows a shard with no specs to run and counts its mutants uncovered', () => {
    const shard = strykerOptions(
      'domain',
      'libs/domain',
      false,
      undefined,
      'rest',
    ) as Record<string, any>;

    expect(shard['allowEmpty']).toBe(true);
    expect(shard['jest'].config.passWithNoTests).toBe(true);
  });

  it('refuses a shard the project does not have', () => {
    expect(() =>
      strykerOptions('domain', 'libs/domain', false, undefined, 'nope'),
    ).toThrow(/nope/);
  });

  it('refuses a shard of a project the shard file does not split', () => {
    expect(() =>
      strykerOptions('api', 'apps/api', false, undefined, 'rest'),
    ).toThrow(/api/);
  });

  it('narrows to one file when --mutate is given with a shard', () => {
    const options = strykerOptions(
      'domain',
      'libs/domain',
      false,
      'libs/domain/src/index.ts',
      'rest',
    ) as Record<string, any>;

    expect(options['mutate']).toEqual(['libs/domain/src/index.ts']);
  });

  it('does not mutate any spec in any shard', () => {
    const shard = strykerOptions(
      'web',
      'apps/web',
      false,
      undefined,
      'public-steps',
    ) as Record<string, any>;

    expect(shard['mutate']).toEqual(
      expect.arrayContaining([
        '!apps/web/src/**/*.spec.ts',
        '!apps/web/src/**/generated/**',
      ]),
    );
  });
});

describe('flags', () => {
  it.each([
    [['--shard'], undefined],
    [['--shard', ''], undefined],
    [['--shard='], undefined],
    [['--shard=rest'], 'rest'],
    [['--shard', 'a-b'], 'a-b'],
    [['--incremental', '--shard', 'x'], 'x'],
  ])('reads the shard from %p', (args, expected) => {
    expect(flags(args).shard).toBe(expected);
  });
});

describe('clearReports', () => {
  it('removes a stale score and reports and keeps the incremental cache', () => {
    const reports = join(dir, 'r');
    mkdirSync(reports, { recursive: true });
    for (const name of [
      'score.json',
      'mutation.json',
      'index.html',
      'incremental.json',
    ])
      writeFileSync(join(reports, name), '{}');

    clearReports(reports);

    expect(readdirSync(reports)).toEqual(['incremental.json']);
  });

  it('does nothing for a directory that does not exist', () => {
    clearReports(join(dir, 'never'));

    expect(existsSync(join(dir, 'never'))).toBe(false);
  });
});

describe('hasSpecs', () => {
  it('is false for an empty directory and for specs only under node_modules', () => {
    mkdirSync(join(dir, 'src/node_modules/pkg'), { recursive: true });
    writeFileSync(join(dir, 'src/node_modules/pkg/a.spec.ts'), '');
    writeFileSync(join(dir, 'src/a.ts'), '');

    expect(hasSpecs(dir)).toBe(false);
  });

  it('is true for a .test.ts file nested deep', () => {
    mkdirSync(join(dir, 'src/a/b/c'), { recursive: true });
    writeFileSync(join(dir, 'src/a/b/c/x.test.ts'), '');

    expect(hasSpecs(dir)).toBe(true);
  });

  it('is false when the only spec is behind a symlink to another tree', () => {
    const other = mkdtempSync(join(tmpdir(), 'mutation-run-other-'));
    try {
      writeFileSync(join(other, 'x.spec.ts'), '');
      mkdirSync(join(dir, 'src'), { recursive: true });
      symlinkSync(other, join(dir, 'src', 'link'));

      expect(hasSpecs(dir)).toBe(false);
    } finally {
      rmSync(other, { force: true, recursive: true });
    }
  });
});

describe('mutationScore and scoreRecord', () => {
  it('is null for no valid mutant and ignores ignored, error and compile-error statuses', () => {
    expect(mutationScore([])).toBeNull();
    expect(
      mutationScore(['Ignored', 'CompileError', 'RuntimeError']),
    ).toBeNull();
  });

  it('counts timeouts as detected and no-coverage as undetected', () => {
    expect(mutationScore(['Timeout', 'NoCoverage'])).toBe(50);
  });

  it('records the counts a summary needs, and one decimal of minutes', () => {
    expect(
      scoreRecord(
        'p',
        's',
        ['Killed', 'Survived', 'Timeout', 'NoCoverage', 'Ignored'],
        70,
        90_000,
      ),
    ).toEqual({
      floor: 70,
      killed: 1,
      minutes: 1.5,
      noCoverage: 1,
      project: 'p',
      score: 50,
      shard: 's',
      survived: 1,
      timeout: 1,
    });
  });

  it('keeps reports under reports/mutation/<project>[/<shard>]', () => {
    expect(reportsDir('p')).toBe('reports/mutation/p');
    expect(reportsDir('p', 's')).toBe('reports/mutation/p/s');
  });
});

describe('the command', () => {
  const run = (args: string[]) =>
    spawnSync('node', [mutationScript, ...args], {
      cwd: dir,
      encoding: 'utf8',
    });

  it('prints the project and shard first, writes a skipped record for a project with no specs and no stale score', () => {
    mkdirSync(join(dir, 'libs/x/src'), { recursive: true });
    writeFileSync(join(dir, 'libs/x/src/a.ts'), '');
    mkdirSync(join(dir, 'reports/mutation/x/rest'), { recursive: true });
    writeFileSync(
      join(dir, 'reports/mutation/x/rest/score.json'),
      JSON.stringify({ killed: 99, project: 'x', shard: 'rest' }),
    );

    const result = run(['x', 'libs/x', '--shard=rest']);

    expect(result.status).toBe(0);
    expect(result.stdout.split('\n')[0]).toBe('mutation: x rest');
    expect(
      JSON.parse(
        readFileSync(join(dir, 'reports/mutation/x/rest/score.json'), 'utf8'),
      ),
    ).toEqual({
      project: 'x',
      shard: 'rest',
      skipped: true,
    });
  });

  it('prints the bare project name first for an unsharded run', () => {
    mkdirSync(join(dir, 'libs/x/src'), { recursive: true });

    const result = run(['x', 'libs/x']);

    expect(result.stdout.split('\n')[0]).toBe('mutation: x');
    expect(
      JSON.parse(
        readFileSync(join(dir, 'reports/mutation/x/score.json'), 'utf8'),
      ).shard,
    ).toBe('');
  });

  it('fails with usage when the project or root is missing', () => {
    const result = run(['x']);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/usage/);
  });

  it('fails naming the problem when the project root does not exist', () => {
    const result = run(['x', 'libs/missing']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/libs\/missing/);
  });
});
