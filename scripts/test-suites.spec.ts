import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(__dirname, '..');
const jestBin = require.resolve('jest/bin/jest');
const INTEGRATION = /\.integration\.spec\.ts$/;

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
      // Playwright projects run against the whole stack and have no unit or
      // integration suite to split.
      return ['node_modules', 'test-output'].includes(entry.name) ||
        entry.name.endsWith('-e2e')
        ? []
        : specFiles(path);
    return /\.spec\.ts$/.test(entry.name) ? [path] : [];
  });
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
    const needsServices = new RegExp(
      [
        String.raw`process\.env\[['"](DATABASE_URL|REDIS_URL)['"]\]`,
        String.raw`['"]seed\.ts['"]`,
      ].join('|'),
    );
    const misnamed = ['apps', 'libs', 'scripts']
      .flatMap((dir) => specFiles(join(root, dir)))
      .filter((file) => file !== __filename && !INTEGRATION.test(file))
      .filter((file) => needsServices.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));

    expect(misnamed).toEqual([]);
  });
});
