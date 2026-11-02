import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { angularTest, WEB_NODE_SPECS } from '../vitest.shared.ts';

const root = join(import.meta.dirname, '..');
const json = (path: string) =>
  JSON.parse(readFileSync(join(root, path), 'utf8'));

const PROJECTS: [string, string, number][] = [
  ['web', 'apps/web', 79],
  ['ui-cockpit', 'libs/ui-cockpit', 66],
  ['overlays', 'libs/overlays', 76],
  ['i18n', 'libs/i18n', 85],
  ['media', 'libs/media', 85],
];

function specsUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === 'node_modules' ? [] : specsUnder(path);
    return name.endsWith('.spec.ts') ? [path] : [];
  });
}

const hookFunction = (script: string) => {
  const text = readFileSync(join(root, '.claude/hooks', script), 'utf8');
  return text.match(/^vitest_config\(\) \{[\s\S]*?^\}$/m)?.[0] ?? '';
};

const configOf = (script: string, path: string) =>
  execFileSync(
    'bash',
    ['-c', `${hookFunction(script)}\nvitest_config "$1"`, 'x', path],
    {
      encoding: 'utf8',
    },
  ).trim();

const env = { ...process.env };
afterEach(() => {
  for (const key of ['NX_TASK_TARGET_TARGET', 'MUTATION_SPECS'])
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
});

describe('the five Angular projects on the unit-test builder', () => {
  it.each(PROJECTS)(
    '%s test target runs Vitest with isolation on',
    (_n, dir) => {
      const target = json(`${dir}/project.json`).targets.test;
      expect(target.executor).toBe('@angular/build:unit-test');
      expect(target.options.runner).toBe('vitest');
      // Isolation comes from the runner config the builder reads, merged
      // over its own isolate: false default.
      process.env['NX_TASK_TARGET_TARGET'] = 'test';
      expect(
        (angularTest(dir) as { test: { isolate?: boolean } }).test.isolate,
      ).toBe(true);
      expect(target.options.runnerConfig).toBe(`${dir}/vitest.config.ts`);
    },
  );

  // @traces 1332-FR-010
  it.each(PROJECTS)('%s keeps its mutation floor', (_n, dir, floor) => {
    expect(json(`${dir}/stryker.config.json`).thresholds.break).toBe(floor);
  });

  it.each(PROJECTS)('%s test inputs name no Jest tooling', (_n, dir) => {
    const inputs = JSON.stringify(
      json(`${dir}/project.json`).targets.test.inputs ?? [],
    );
    expect(inputs).not.toMatch(/jest/);
  });

  it('web lists the same node specs in the target, the exclusion and the shared config', () => {
    const targets = json('apps/web/project.json').targets;
    expect(targets['test-node'].options.include).toEqual(WEB_NODE_SPECS);
    expect(targets.test.options.exclude).toEqual(WEB_NODE_SPECS);
  });

  it('keeps every spec under web server and the app config specs out of the jsdom run', () => {
    const src = join(root, 'apps/web/src');
    const leaked = specsUnder(src)
      .map((file) => relative(src, file))
      .filter((rel) => /^server\/|^app\/app\.config[^/]*\.spec\.ts$/.test(rel))
      .filter(
        (rel) =>
          !WEB_NODE_SPECS.some((glob) =>
            glob.endsWith('/**/*.spec.ts')
              ? rel.startsWith(glob.slice(0, -'**/*.spec.ts'.length))
              : glob === rel,
          ),
      );
    expect(leaked).toEqual([]);
  });
});

describe('the specs of the five projects', () => {
  const specs = () =>
    PROJECTS.flatMap(([, dir]) => specsUnder(join(root, dir, 'src')));

  // @traces 1332-FR-002
  it('skip and leave to do no spec', () => {
    const skipped = specs().filter((file) =>
      /\b(?:it|test|describe)\.(?:skip|todo)\(|\bx(?:it|describe)\(/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(skipped.map((file) => relative(root, file))).toEqual([]);
  });

  // @traces 1332-FR-003
  it("call none of Jest's API", () => {
    const onJest = specs().filter((file) =>
      /\bjest\.[a-zA-Z]+\(/.test(readFileSync(file, 'utf8')),
    );
    expect(onJest.map((file) => relative(root, file))).toEqual([]);
  });
});

describe('the four libraries', () => {
  // @traces 1332-FR-007
  it.each(PROJECTS.filter(([name]) => name !== 'web'))(
    '%s builds its specs from its own test-build target, not a production build',
    (name, dir) => {
      const targets = json(`${dir}/project.json`).targets;
      expect(targets.test.options.buildTarget).toBe(
        `${name}:test-build:development`,
      );
      expect(targets['test-build'].executor).toBe('@angular/build:application');
      expect(Object.keys(targets['test-build'].configurations)).toEqual([
        'development',
      ]);
    },
  );
});

describe('angularTest', () => {
  it('hands the builder only the test options, cleared mocks and isolation included', () => {
    process.env['NX_TASK_TARGET_TARGET'] = 'test';
    expect(angularTest('apps/web')).toEqual({
      test: {
        clearMocks: true,
        environment: 'jsdom',
        globals: true,
        isolate: true,
      },
    });
  });

  it('keeps the node environment for test-node', () => {
    process.env['NX_TASK_TARGET_TARGET'] = 'test-node';
    expect(angularTest('apps/web', 'node')).toEqual({
      test: {
        clearMocks: true,
        environment: 'node',
        globals: true,
        isolate: true,
      },
    });
  });

  it('refuses a malformed shard list instead of running every spec', () => {
    delete process.env['NX_TASK_TARGET_TARGET'];
    process.env['MUTATION_SPECS'] = '{not json';
    expect(() => angularTest('libs/media')).toThrow();
  });

  it('applies a shard include and exclude over the project default', () => {
    delete process.env['NX_TASK_TARGET_TARGET'];
    process.env['MUTATION_SPECS'] = JSON.stringify({
      exclude: ['**/libs/media/src/a/**/*.spec.ts'],
      include: ['**/libs/media/src/**/*.spec.ts'],
    });
    const test = (
      angularTest('libs/media') as { test: Record<string, unknown> }
    ).test;
    expect(test['include']).toEqual(['**/libs/media/src/**/*.spec.ts']);
    expect(test['exclude']).toEqual([
      '**/node_modules/**',
      '**/libs/media/src/a/**/*.spec.ts',
    ]);
  });

  it('treats an empty MUTATION_SPECS as unset', () => {
    delete process.env['NX_TASK_TARGET_TARGET'];
    process.env['MUTATION_SPECS'] = '';
    const test = (angularTest('libs/i18n') as { test: Record<string, unknown> })
      .test;
    expect(test['include']).toEqual(['libs/i18n/src/**/*.spec.ts']);
  });

  it('keeps clearMocks, isolation and globals in the Stryker configuration too', () => {
    delete process.env['NX_TASK_TARGET_TARGET'];
    delete process.env['MUTATION_SPECS'];
    const test = (
      angularTest('apps/web', 'node', { only: ['server/**/*.spec.ts'] }) as {
        test: Record<string, unknown>;
      }
    ).test;
    expect(test).toMatchObject({
      clearMocks: true,
      environment: 'node',
      globals: true,
      isolate: true,
    });
    expect(test['include']).toEqual(['apps/web/src/server/**/*.spec.ts']);
  });
});

describe('the hooks pick a runner by project root', () => {
  const NODE = 'apps/web/vitest-node.config.ts';
  it.each([
    ['apps/web/src/server/edge.spec.ts', NODE],
    ['apps/web/src/server/deep/er/x.spec.ts', NODE],
    ['apps/web/src/app/app.config.spec.ts', NODE],
    ['apps/web/src/app/app.config.server.adversary.spec.ts', NODE],
    ['apps/web/src/app/home/home.spec.ts', 'apps/web/vitest.config.ts'],
    ['apps/web/src/serverless/x.spec.ts', 'apps/web/vitest.config.ts'],
    ['libs/media/src/a.spec.ts', 'libs/media/vitest.config.ts'],
    ['libs/ui-cockpit/src/a/b.spec.ts', 'libs/ui-cockpit/vitest.config.ts'],
    ['libs/overlays/src/a.spec.ts', 'libs/overlays/vitest.config.ts'],
    ['libs/i18n/src/a.spec.ts', 'libs/i18n/vitest.config.ts'],
    ['apps/web-e2e/src/a.spec.ts', ''],
    ['libs/i18n-extra/src/a.spec.ts', ''],
    ['libs/media2/src/a.spec.ts', ''],
    ['libs/domain/src/a.spec.ts', ''],
  ])('maps %s the same in both gates', (path, config) => {
    expect(configOf('post-edit-check.sh', path)).toBe(config);
    expect(configOf('stop-test-gate.sh', path)).toBe(config);
  });

  it('names a Vitest config file that exists for every path it maps', () => {
    for (const config of [
      NODE,
      ...PROJECTS.map(([, dir]) => `${dir}/vitest.config.ts`),
    ])
      expect(statSync(join(root, config)).isFile()).toBe(true);
  });
});
