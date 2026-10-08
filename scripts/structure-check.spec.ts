import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  type Baseline,
  baselineErrors,
  componentViolations,
  scanRepo,
  submoduleViolations,
  type Violation,
} from './structure-check.ts';

const repo = join(__dirname, '..');
const SCRIPT = join(__dirname, 'structure-check.ts');
const NOTIFICATIONS = 'libs/domain/src/notifications';
const DASHBOARD = 'apps/web/src/app/dashboard';

const files = (found: Violation[]) => found.map((v) => v.file).sort();
const keysOf = (found: Violation[]) =>
  [...new Set(found.map((v) => v.detail.match(/"([^"]+)"/)?.[1]))].sort();
const at = (dir: string, names: string[]) => names.map((n) => `${dir}/${n}`);
const all = () => true;
const none = () => false;
const empty: Baseline = { components: [], submodules: [] };

describe('flat submodules', () => {
  it('reports both files of a flat group with the folder to move them to', () => {
    const found = submoduleViolations(
      at(NOTIFICATIONS, [
        'bell.controller.ts',
        'bell.service.ts',
        'notifications.module.ts',
      ]),
    );

    expect(found).toEqual([
      {
        detail: `flat submodule "bell", move it to ${NOTIFICATIONS}/bell/`,
        file: `${NOTIFICATIONS}/bell.controller.ts`,
        rule: 'submodules',
      },
      {
        detail: `flat submodule "bell", move it to ${NOTIFICATIONS}/bell/`,
        file: `${NOTIFICATIONS}/bell.service.ts`,
        rule: 'submodules',
      },
    ]);
  });

  it('allows own files, the index and a lone shared file', () => {
    expect(
      submoduleViolations(
        at(NOTIFICATIONS, [
          'index.ts',
          'notifications.module.ts',
          'notifications.service.ts',
          'notifications.testing.ts',
          'quiet-hours.ts',
          'routing.ts',
        ]),
      ),
    ).toEqual([]);
  });

  it('does not group names that only share a first word', () => {
    expect(
      submoduleViolations(
        at('libs/domain/src/auth', [
          'sign-in.service.ts',
          'sign-up.service.ts',
        ]),
      ),
    ).toEqual([]);
  });

  it('groups a stem with the stems that extend it with a dash', () => {
    const found = submoduleViolations(
      at(NOTIFICATIONS, ['push.ts', 'push-subscriptions.service.ts']),
    );

    expect(files(found)).toEqual(
      at(NOTIFICATIONS, ['push-subscriptions.service.ts', 'push.ts']),
    );
    expect(keysOf(found)).toEqual(['push']);
  });

  it('treats main entry points at a source root as own files', () => {
    expect(
      submoduleViolations(at('apps/web/src', ['main.ts', 'main.server.ts'])),
    ).toEqual([]);
  });

  it('counts a main group below the source root', () => {
    expect(
      files(
        submoduleViolations(
          at('apps/web/src/app', ['main.ts', 'main.server.ts']),
        ),
      ),
    ).toEqual(at('apps/web/src/app', ['main.server.ts', 'main.ts']));
  });

  it('leaves specs and non-TypeScript files uncounted', () => {
    expect(
      submoduleViolations(
        at(NOTIFICATIONS, [
          'bell.service.ts',
          'bell.spec.ts',
          'bell.api.integration.spec.ts',
          'bell.adversary.spec.ts',
          'bell.json',
        ]),
      ),
    ).toEqual([]);
  });

  it('counts test helpers with the submodule they serve', () => {
    expect(
      files(
        submoduleViolations(at(NOTIFICATIONS, ['push.ts', 'push.testing.ts'])),
      ),
    ).toEqual(at(NOTIFICATIONS, ['push.testing.ts', 'push.ts']));
  });

  it('checks the source root of every app and lib', () => {
    expect(
      files(
        submoduleViolations(
          at('libs/contracts/src', [
            'garage-hours.ts',
            'garage.ts',
            'index.ts',
          ]),
        ),
      ),
    ).toEqual(at('libs/contracts/src', ['garage-hours.ts', 'garage.ts']));
  });

  it.each([
    'libs/ui-cockpit/src/lib/button',
    'libs/data-access/src/lib',
    'libs/domain/src/generated',
    'apps/web-e2e/src',
    'apps/api',
    'scripts',
  ])('never reports files under %s', (dir) => {
    expect(
      submoduleViolations(at(dir, ['bell.controller.ts', 'bell.service.ts'])),
    ).toEqual([]);
  });

  it('finds the five flat groups of the notifications module today', () => {
    const listing = execFileSync('git', ['ls-files', '--', NOTIFICATIONS], {
      cwd: repo,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);

    expect(keysOf(submoduleViolations(listing))).toEqual([
      'bell',
      'brevo',
      'news',
      'preferences',
      'push',
    ]);
  });
});

describe('folder components', () => {
  const component = (meta: string) =>
    `import { Component } from '@angular/core';\n\n@Component({\n  selector: 'mf-x',\n${meta}\n})\nexport class X {}\n`;
  const good = component(
    "  templateUrl: './add-car.html',\n  styleUrl: './add-car.css',",
  );
  const reasons = (found: Violation[]) => found.map((v) => v.detail);

  it('passes a component in its own folder with its template and stylesheet', () => {
    expect(
      componentViolations(`${DASHBOARD}/add-car/add-car.ts`, good, all),
    ).toEqual([]);
  });

  it('passes a component with no stylesheet', () => {
    expect(
      componentViolations(
        `${DASHBOARD}/add-car/add-car.ts`,
        component("  templateUrl: './add-car.html',"),
        all,
      ),
    ).toEqual([]);
  });

  it('refuses an inline template', () => {
    expect(
      componentViolations(
        `${DASHBOARD}/add-car/add-car.ts`,
        component('  template: `<p>hi</p>`,'),
        all,
      ),
    ).toEqual([
      {
        detail: 'inline template or styles',
        file: `${DASHBOARD}/add-car/add-car.ts`,
        rule: 'components',
      },
    ]);
  });

  it('refuses inline styles', () => {
    expect(
      reasons(
        componentViolations(
          `${DASHBOARD}/add-car/add-car.ts`,
          component(
            "  templateUrl: './add-car.html',\n  styles: [':host { display: block }'],",
          ),
          all,
        ),
      ),
    ).toEqual(['inline template or styles']);
  });

  it('refuses a component outside a folder of its own name', () => {
    expect(
      reasons(
        componentViolations(
          `${DASHBOARD}/foo.ts`,
          component("  templateUrl: './foo.html',"),
          all,
        ),
      ),
    ).toEqual([`expected ${DASHBOARD}/foo/foo.ts`]);
  });

  it.each([
    ["  templateUrl: './card.html',", 'templateUrl must be ./add-car.html'],
    [
      "  templateUrl: './add-car.html',\n  styleUrl: '../shared.css',",
      'styleUrl must be ./add-car.css',
    ],
    [
      "  templateUrl: './add-car.html',\n  styleUrls: ['./add-car.css', './extra.css'],",
      'styleUrl must be ./add-car.css',
    ],
  ])('refuses %s', (meta, detail) => {
    const found = componentViolations(
      `${DASHBOARD}/add-car/add-car.ts`,
      component(meta),
      all,
    );

    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain(detail);
  });

  it('refuses a template or stylesheet that is not on disk', () => {
    const found = componentViolations(
      `${DASHBOARD}/add-car/add-car.ts`,
      good,
      none,
    );

    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain('./add-car.html');
  });

  it('reports a file once per reason, however many components it declares', () => {
    const twice = `${component('  template: `<p>a</p>`,')}\n${component('  template: `<p>b</p>`,')}`;

    expect(
      reasons(componentViolations(`${DASHBOARD}/foo.ts`, twice, all)),
    ).toEqual([
      'inline template or styles',
      `expected ${DASHBOARD}/foo/foo.ts`,
    ]);
  });

  it('ignores a file that declares no component', () => {
    expect(
      componentViolations(
        `${DASHBOARD}/foo.ts`,
        'export const template = `<p>hi</p>`;\n',
        all,
      ),
    ).toEqual([]);
  });

  it('ignores specs and files outside the web app', () => {
    const inline = component('  template: `<p>hi</p>`,');

    expect(
      componentViolations(`${DASHBOARD}/foo.spec.ts`, inline, all),
    ).toEqual([]);
    expect(
      componentViolations('libs/ui-cockpit/src/lib/button.ts', inline, all),
    ).toEqual([]);
  });
});

describe('the baseline', () => {
  const bell = submoduleViolations(
    at(NOTIFICATIONS, ['bell.controller.ts', 'bell.service.ts']),
  );
  const listed: Baseline = {
    components: [],
    submodules: at(NOTIFICATIONS, ['bell.controller.ts', 'bell.service.ts']),
  };

  it('lets a listed violation pass', () => {
    expect(baselineErrors(bell, listed)).toEqual([]);
  });

  it('reports a violation it does not list', () => {
    expect(baselineErrors(bell, empty)).toEqual([
      `${NOTIFICATIONS}/bell.controller.ts: flat submodule "bell", move it to ${NOTIFICATIONS}/bell/`,
      `${NOTIFICATIONS}/bell.service.ts: flat submodule "bell", move it to ${NOTIFICATIONS}/bell/`,
    ]);
  });

  it('baselines per file, so a new file joining a listed group fails', () => {
    const three = submoduleViolations(
      at(NOTIFICATIONS, [
        'bell.controller.ts',
        'bell.service.ts',
        'bell.store.ts',
      ]),
    );

    expect(baselineErrors(three, listed)).toEqual([
      `${NOTIFICATIONS}/bell.store.ts: flat submodule "bell", move it to ${NOTIFICATIONS}/bell/`,
    ]);
  });

  it('reports an entry that no longer matches a violation as stale', () => {
    expect(
      baselineErrors([], {
        components: [`${DASHBOARD}/foo.ts`],
        submodules: [],
      }),
    ).toEqual([
      `stale baseline entry: components ${DASHBOARD}/foo.ts, remove it from scripts/structure-baseline.json`,
    ]);
  });

  it('lists a file with several component reasons once', () => {
    const found = componentViolations(
      `${DASHBOARD}/foo.ts`,
      '@Component({ template: `<p>hi</p>` })\nexport class Foo {}\n',
      all,
    );

    expect(found.length).toBeGreaterThan(1);
    expect(
      baselineErrors(found, {
        components: [`${DASHBOARD}/foo.ts`],
        submodules: [],
      }),
    ).toEqual([]);
  });

  it('refuses an entry the base branch does not list', () => {
    expect(
      baselineErrors(bell, listed, {
        baseline: {
          components: [],
          submodules: [`${NOTIFICATIONS}/bell.controller.ts`],
        },
        ref: 'origin/main',
      }),
    ).toEqual([
      `baseline grew: ${NOTIFICATIONS}/bell.service.ts is not in origin/main's baseline`,
    ]);
  });

  it('skips the comparison when the base has no baseline', () => {
    expect(
      baselineErrors(bell, listed, { baseline: null, ref: 'origin/main' }),
    ).toEqual([]);
  });
});

describe('node scripts/structure-check.ts', () => {
  let dir: string;
  // A git hook exports GIT_DIR and GIT_INDEX_FILE, which would point the
  // temporary repository's git at the repository being committed.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );

  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', env });
  const commit = () => {
    git('add', '-A');
    git('commit', '-qm', 'tree');
  };
  const run = (...args: string[]) =>
    spawnSync('node', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env });
  const baseline = (value: Baseline) =>
    put('scripts/structure-baseline.json', `${JSON.stringify(value)}\n`);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'structure-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.test');
    git('config', 'user.name', 'test');
    put(`${NOTIFICATIONS}/notifications.module.ts`, 'export {};\n');
    put(
      `${DASHBOARD}/add-car/add-car.ts`,
      "@Component({ templateUrl: './add-car.html' })\nexport class AddCar {}\n",
    );
    put(`${DASHBOARD}/add-car/add-car.html`, '<p>car</p>\n');
  });

  afterEach(() => rmSync(dir, { force: true, recursive: true }));

  it('passes a clean tree with a one-line summary', () => {
    baseline(empty);
    commit();

    const res = run();

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(
      /^structure: \d+ files checked, 0 baselined, ok$/,
    );
  });

  it('fails naming a flat submodule and an inline component', () => {
    baseline(empty);
    put(`${NOTIFICATIONS}/bell.controller.ts`, 'export {};\n');
    put(`${NOTIFICATIONS}/bell.service.ts`, 'export {};\n');
    put(
      `${DASHBOARD}/inline/inline.ts`,
      '@Component({ template: `<p>hi</p>` })\nexport class Inline {}\n',
    );
    commit();

    const res = run();

    expect(res.status).toBe(1);
    expect(res.stderr).toContain(
      `${NOTIFICATIONS}/bell.controller.ts: flat submodule "bell", move it to ${NOTIFICATIONS}/bell/`,
    );
    expect(res.stderr).toContain(
      `${DASHBOARD}/inline/inline.ts: inline template or styles`,
    );
  });

  it('reads only the files git tracks', () => {
    baseline(empty);
    commit();
    put(`${NOTIFICATIONS}/bell.controller.ts`, 'export {};\n');
    put(`${NOTIFICATIONS}/bell.service.ts`, 'export {};\n');

    expect(run().status).toBe(0);
  });

  it('passes a listed violation and counts it as baselined', () => {
    put(`${NOTIFICATIONS}/bell.controller.ts`, 'export {};\n');
    put(`${NOTIFICATIONS}/bell.service.ts`, 'export {};\n');
    baseline({
      components: [],
      submodules: at(NOTIFICATIONS, ['bell.controller.ts', 'bell.service.ts']),
    });
    commit();

    const res = run();

    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/2 baselined, ok/);
  });

  it('fails on a stale entry once the file is fixed', () => {
    baseline({
      components: [],
      submodules: [`${NOTIFICATIONS}/bell.service.ts`],
    });
    commit();

    const res = run();

    expect(res.status).toBe(1);
    expect(res.stderr).toContain(
      `stale baseline entry: submodules ${NOTIFICATIONS}/bell.service.ts, remove it from scripts/structure-baseline.json`,
    );
  });

  it.each([
    ['missing', null],
    ['unparsable', '{ not json'],
  ])('fails naming the baseline when it is %s', (_, text) => {
    if (text !== null) put('scripts/structure-baseline.json', text);
    commit();

    const res = run();

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('scripts/structure-baseline.json');
  });

  it("fails when the baseline holds an entry the base ref's baseline lacks", () => {
    baseline(empty);
    commit();
    git('branch', 'base');
    put(`${NOTIFICATIONS}/bell.controller.ts`, 'export {};\n');
    put(`${NOTIFICATIONS}/bell.service.ts`, 'export {};\n');
    baseline({
      components: [],
      submodules: at(NOTIFICATIONS, ['bell.controller.ts', 'bell.service.ts']),
    });
    commit();

    const res = run('--base', 'base');

    expect(res.status).toBe(1);
    expect(res.stderr).toContain(
      `baseline grew: ${NOTIFICATIONS}/bell.controller.ts is not in base's baseline`,
    );
    expect(run().status).toBe(0);
  });

  it('skips the comparison when the base ref has no baseline', () => {
    commit();
    git('branch', 'base');
    put(`${NOTIFICATIONS}/bell.controller.ts`, 'export {};\n');
    put(`${NOTIFICATIONS}/bell.service.ts`, 'export {};\n');
    baseline({
      components: [],
      submodules: at(NOTIFICATIONS, ['bell.controller.ts', 'bell.service.ts']),
    });
    commit();

    expect(run('--base', 'base').status).toBe(0);
  });
});

describe('the repository', () => {
  it('baselines exactly the violations it holds today', () => {
    const recorded = JSON.parse(
      readFileSync(join(repo, 'scripts/structure-baseline.json'), 'utf8'),
    );
    const found = scanRepo(repo).violations;
    const listOf = (rule: Violation['rule']) => [
      ...new Set(found.filter((v) => v.rule === rule).map((v) => v.file)),
    ];

    expect(recorded.submodules).toEqual(listOf('submodules').sort());
    expect(recorded.components).toEqual(listOf('components').sort());
  });

  it('generates Angular components with a separate template and stylesheet', () => {
    const nx = JSON.parse(readFileSync(join(repo, 'nx.json'), 'utf8'));

    expect(nx.generators['@nx/angular:component']).toEqual({
      inlineStyle: false,
      inlineTemplate: false,
      style: 'css',
    });
  });
});
