import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = join(__dirname, '..');
const jestBin = require.resolve('jest/bin/jest');
const INTEGRATION = /\.integration\.spec\.ts$/;
const NEEDS_SERVICES = new RegExp(
  [
    String.raw`process\.env\[['"](DATABASE_URL|REDIS_URL)['"]\]`,
    String.raw`['"]seed\.ts['"]`,
  ].join('|'),
);

function listTests(project: string, suite?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // What nx sets for the test target, so jest can load the .cts configs.
    TS_NODE_COMPILER_OPTIONS: JSON.stringify({
      customConditions: null,
      module: 'commonjs',
      moduleResolution: 'node10',
    }),
  };
  delete env['JEST_SUITE'];
  if (suite !== undefined) env['JEST_SUITE'] = suite;
  const run = spawnSync(process.execPath, [jestBin, '--listTests', '--json'], {
    cwd: join(root, project),
    encoding: 'utf8',
    env,
  });
  return {
    files:
      run.status === 0
        ? (JSON.parse(run.stdout) as string[]).map((f) => relative(root, f))
        : [],
    status: run.status,
    stderr: run.stderr,
  };
}

function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return ['node_modules', 'test-output'].includes(entry.name)
        ? []
        : specFiles(path);
    return /\.spec\.ts$/.test(entry.name) ? [path] : [];
  });
}

// Only a project with a Jest config splits into JEST_SUITE's unit and
// integration suites; apps/web-e2e's specs run under Playwright in the E2E job.
function runByJest(file: string): boolean {
  for (let dir = dirname(file); dir.startsWith(root); dir = dirname(dir))
    if (existsSync(join(dir, 'project.json')))
      return readdirSync(dir).some((name) => name.startsWith('jest.config.'));
  return false;
}

function misnamedIntegrationSpec(file: string, source: string): boolean {
  return (
    runByJest(file) && !INTEGRATION.test(file) && NEEDS_SERVICES.test(source)
  );
}

describe('the unit and integration suites', () => {
  for (const project of ['apps/api', 'libs/domain']) {
    describe(project, () => {
      const all = listTests(project);
      const unit = listTests(project, 'unit');
      const integration = listTests(project, 'integration');

      it('runs every spec when no suite is chosen', () => {
        expect(all.status).toBe(0);
        expect(all.files.some((f) => INTEGRATION.test(f))).toBe(true);
        expect(all.files.some((f) => !INTEGRATION.test(f))).toBe(true);
      });

      it('leaves the integration specs out of the unit suite', () => {
        expect(unit.status).toBe(0);
        expect(unit.files.length).toBeGreaterThan(0);
        expect(unit.files.filter((f) => INTEGRATION.test(f))).toEqual([]);
      });

      it('runs only the integration specs in the integration suite', () => {
        expect(integration.status).toBe(0);
        expect(integration.files.length).toBeGreaterThan(0);
        expect(integration.files.filter((f) => !INTEGRATION.test(f))).toEqual(
          [],
        );
      });

      it('splits every spec into exactly one of the two suites', () => {
        expect([...unit.files, ...integration.files].sort()).toEqual(
          [...all.files].sort(),
        );
      });
    });
  }

  it('refuses a suite it does not know', () => {
    const run = listTests('libs/contracts', 'e2e');

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('JEST_SUITE');
  });

  it('names every spec that needs PostgreSQL, Redis or the seed as an integration spec', () => {
    const misnamed = ['apps', 'libs', 'scripts']
      .flatMap((dir) => specFiles(join(root, dir)))
      .filter((file) => file !== __filename)
      .filter((file) =>
        misnamedIntegrationSpec(file, readFileSync(file, 'utf8')),
      )
      .map((file) => relative(root, file));

    expect(misnamed).toEqual([]);
  });

  it('leaves out the end-to-end specs, which Playwright runs and Jest never does', () => {
    const seeded = "spawnSync(process.execPath, [join(domain, 'seed.ts')]);";

    expect(
      misnamedIntegrationSpec(
        join(root, 'apps/api/src/seeded.spec.ts'),
        seeded,
      ),
    ).toBe(true);
    expect(
      misnamedIntegrationSpec(
        join(root, 'apps/web-e2e/src/seeded.spec.ts'),
        seeded,
      ),
    ).toBe(false);
  });
});

// @traces 1170-FR-001 1170-FR-005
// A commit and PR CI run one suite only, so a project whose specs are all in
// the other suite has none to run; that is a pass, not "No tests found".
describe('a chosen suite', () => {
  const preset = (suite: string | undefined) => {
    const saved = process.env['JEST_SUITE'];
    if (suite === undefined) delete process.env['JEST_SUITE'];
    else process.env['JEST_SUITE'] = suite;
    try {
      let config: { passWithNoTests?: boolean } = {};
      jest.isolateModules(() => {
        config = require('../jest.preset.cjs');
      });
      return config;
    } finally {
      if (saved === undefined) delete process.env['JEST_SUITE'];
      else process.env['JEST_SUITE'] = saved;
    }
  };

  it.each(['unit', 'integration'])(
    'passes %s with no tests to run',
    (suite) => {
      expect(preset(suite).passWithNoTests).toBe(true);
    },
  );

  it('keeps the whole run strict when no suite is chosen', () => {
    expect(preset(undefined).passWithNoTests).toBeUndefined();
  });
});

// A Jest worker that keeps growing across a long project's files (the web
// suite reached a 4 GB heap on CI and crashed) is replaced after a file once it
// passes its limit: every Jest project resolves one, well under that heap.
function jestProjects(): string[] {
  return ['apps', 'libs'].flatMap((area) =>
    readdirSync(join(root, area), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(area, entry.name))
      .filter((dir) =>
        readdirSync(join(root, dir)).some((name) =>
          name.startsWith('jest.config.'),
        ),
      ),
  );
}

function resolvedLimit(project: string): unknown {
  const run = spawnSync(process.execPath, [jestBin, '--showConfig'], {
    cwd: join(root, project),
    encoding: 'utf8',
    env: {
      ...process.env,
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({
        customConditions: null,
        module: 'commonjs',
        moduleResolution: 'node10',
      }),
    },
  });
  if (run.status !== 0) return run.stderr;
  return (
    JSON.parse(run.stdout) as {
      globalConfig: { workerIdleMemoryLimit?: unknown };
    }
  ).globalConfig.workerIdleMemoryLimit;
}

describe('the Jest worker memory limit', () => {
  it('finds the web app among the Jest projects', () => {
    expect(jestProjects()).toContain('apps/web');
  });

  it.each(jestProjects())(
    '%s replaces a worker before it nears the 4 GB heap the web suite crashed at',
    (project) => {
      const limit = resolvedLimit(project);
      expect(typeof limit).toBe('number');
      expect(limit as number).toBeGreaterThan(0);
      expect(limit as number).toBeLessThanOrEqual(2 * 1024 ** 3);
    },
  );
});
