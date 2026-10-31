import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const SCRIPT = join(__dirname, 'structure-check.ts');
const HOOK = join(__dirname, '..', '.claude', 'hooks', 'config-protection.mjs');
const MOD = 'libs/domain/src/notifications';
const WEB = 'apps/web/src/app/dashboard';
const empty: Baseline = { components: [], submodules: [] };
const at = (dir: string, names: string[]) => names.map((n) => `${dir}/${n}`);
const files = (found: Violation[]) => found.map((v) => v.file).sort();
const all = () => true;
const none = () => false;
const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );

describe('flat submodules, hostile listings', () => {
  it('returns nothing for an empty listing', () => {
    expect(submoduleViolations([])).toEqual([]);
  });

  it('does not group a single non-own file', () => {
    expect(submoduleViolations(at(MOD, ['bell.controller.ts']))).toEqual([]);
  });

  it('does not group sign-in with sign-up', () => {
    expect(
      submoduleViolations(
        at(MOD, ['sign-in.service.ts', 'sign-up.service.ts']),
      ),
    ).toEqual([]);
  });

  it('groups brevo.ts with brevo-webhook.controller.ts', () => {
    expect(
      files(
        submoduleViolations(
          at(MOD, ['brevo.ts', 'brevo-webhook.controller.ts']),
        ),
      ),
    ).toEqual(at(MOD, ['brevo-webhook.controller.ts', 'brevo.ts']));
  });

  it('does not group a stem that only shares a letter prefix', () => {
    expect(
      submoduleViolations(at(MOD, ['push.ts', 'pushover.service.ts'])),
    ).toEqual([]);
  });

  it('does not count specs toward a group', () => {
    expect(
      submoduleViolations(
        at(MOD, [
          'bell.service.ts',
          'bell.service.spec.ts',
          'bell.integration.spec.ts',
          'bell.adversary.spec.ts',
        ]),
      ),
    ).toEqual([]);
  });

  it('counts a testing helper toward its group', () => {
    expect(
      files(
        submoduleViolations(at(MOD, ['brevo.ts', 'brevo-mock.testing.ts'])),
      ),
    ).toEqual(at(MOD, ['brevo-mock.testing.ts', 'brevo.ts']));
  });

  it('ignores html, css and json files', () => {
    expect(
      submoduleViolations(at(MOD, ['bell.html', 'bell.css', 'bell.json'])),
    ).toEqual([]);
  });

  it('treats index.ts as an own file', () => {
    expect(
      submoduleViolations(at(MOD, ['index.ts', 'index.service.ts'])),
    ).toEqual([]);
  });

  it('treats main entry points at a src root as own files', () => {
    expect(
      submoduleViolations([
        'apps/web/src/main.ts',
        'apps/web/src/main.server.ts',
      ]),
    ).toEqual([]);
  });

  it('does not treat main files below the src root as entry points', () => {
    expect(
      files(
        submoduleViolations([
          'apps/web/src/app/main.ts',
          'apps/web/src/app/main-view.ts',
        ]),
      ),
    ).toEqual(['apps/web/src/app/main-view.ts', 'apps/web/src/app/main.ts']);
  });

  it.each([
    'libs/ui-cockpit/src/lib/button',
    'libs/data-access/src/lib/api',
    'libs/domain/src/generated/client',
    'apps/web-e2e/src/sign-in',
  ])('never reports files under the excluded path of %s', (stem) => {
    expect(submoduleViolations([`${stem}.ts`, `${stem}-two.ts`])).toEqual([]);
  });

  it('still checks a sibling of an excluded tree', () => {
    expect(
      files(
        submoduleViolations(
          at('libs/domain/src', ['plant.ts', 'plant-data.ts']),
        ),
      ),
    ).toEqual(at('libs/domain/src', ['plant-data.ts', 'plant.ts']));
  });

  it('checks libs other than domain', () => {
    expect(
      files(
        submoduleViolations(
          at('libs/contracts/src', ['garage.ts', 'garage-b.ts']),
        ),
      ),
    ).toEqual(at('libs/contracts/src', ['garage-b.ts', 'garage.ts']));
  });

  it('keeps modules apart', () => {
    expect(
      submoduleViolations([
        'libs/domain/src/a/bell.ts',
        'libs/domain/src/b/bell.service.ts',
      ]),
    ).toEqual([]);
  });

  it('handles ten thousand distinct files in a module', () => {
    const many = Array.from({ length: 10000 }, (_, i) => `${MOD}/f${i}.ts`);
    expect(submoduleViolations(many)).toEqual([]);
  });

  it('handles non-ascii file names', () => {
    expect(
      files(submoduleViolations(at(MOD, ['șoferi.ts', 'șoferi-lista.ts']))),
    ).toEqual(at(MOD, ['șoferi-lista.ts', 'șoferi.ts']));
  });

  it('gives the same set when the listing is reversed', () => {
    const input = at(MOD, ['bell.a.ts', 'bell.b.ts', 'news.ts', 'news-x.ts']);
    expect(files(submoduleViolations([...input].reverse()))).toEqual(
      files(submoduleViolations(input)),
    );
  });
});

describe('folder components, hostile text', () => {
  const ok = (name: string, extra = '') =>
    `@Component({ selector: 'x', templateUrl: './${name}.html'${extra} })\nexport class X {}\n`;

  it('passes a component in its own folder', () => {
    expect(componentViolations(`${WEB}/foo/foo.ts`, ok('foo'), all)).toEqual(
      [],
    );
  });

  it('ignores a file without a component decorator', () => {
    expect(
      componentViolations(`${WEB}/foo.ts`, 'export const a = 1;\n', none),
    ).toEqual([]);
  });

  it('ignores specs', () => {
    expect(
      componentViolations(
        `${WEB}/foo.spec.ts`,
        "@Component({ template: '<p></p>' })\nclass T {}\n",
        none,
      ),
    ).toEqual([]);
  });

  it.each([
    "template: '<p></p>'",
    'template: `<p></p>`',
    'template: "<p></p>"',
  ])('flags the inline template %s', (body) => {
    const found = componentViolations(
      `${WEB}/foo/foo.ts`,
      `@Component({ ${body} })\nexport class X {}\n`,
      all,
    );
    expect(found).toHaveLength(1);
    expect(found[0].detail).toBe('inline template or styles');
  });

  it('flags inline styles', () => {
    const found = componentViolations(
      `${WEB}/foo/foo.ts`,
      ok('foo', ", styles: ['p { color: red }']"),
      all,
    );
    expect(found).toHaveLength(1);
    expect(found[0].detail).toBe('inline template or styles');
  });

  it('flags a styleUrls array that names a wrong file', () => {
    const found = componentViolations(
      `${WEB}/foo/foo.ts`,
      ok('foo', ", styleUrls: ['./foo.css', './other.css']"),
      all,
    );
    expect(found).toHaveLength(1);
    expect(found[0].detail).toBe('styleUrl must be ./foo.css');
  });

  it('passes a styleUrls array holding only the own stylesheet', () => {
    expect(
      componentViolations(
        `${WEB}/foo/foo.ts`,
        ok('foo', ", styleUrls: ['./foo.css']"),
        all,
      ),
    ).toEqual([]);
  });

  it('flags a styleUrl that points to another folder', () => {
    const found = componentViolations(
      `${WEB}/foo/foo.ts`,
      ok('foo', ", styleUrl: '../shared.css'"),
      all,
    );
    expect(found).toHaveLength(1);
    expect(found[0].detail).toBe('styleUrl must be ./foo.css');
  });

  it('flags a template path outside the own folder', () => {
    const found = componentViolations(
      `${WEB}/foo/foo.ts`,
      "@Component({ templateUrl: '../foo.html' })\nexport class X {}\n",
      all,
    );
    expect(found).toHaveLength(1);
    expect(found[0].detail).toBe('templateUrl must be ./foo.html');
  });

  it('flags a component whose template file is missing on disk', () => {
    expect(
      componentViolations(`${WEB}/foo/foo.ts`, ok('foo'), none),
    ).toHaveLength(1);
  });

  it('flags a component whose stylesheet is missing on disk', () => {
    expect(
      componentViolations(
        `${WEB}/foo/foo.ts`,
        ok('foo', ", styleUrl: './foo.css'"),
        (p) => p.endsWith('foo.html'),
      ),
    ).toHaveLength(1);
  });

  it('flags a component in a folder with a different name', () => {
    const found = componentViolations(`${WEB}/bar/foo.ts`, ok('foo'), all);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain('expected');
  });

  it('flags a component sitting directly in a parent directory', () => {
    const found = componentViolations(`${WEB}/foo.ts`, ok('foo'), all);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toBe(`expected ${WEB}/foo/foo.ts`);
  });

  it('flags a component at the src root of the web app', () => {
    expect(
      componentViolations('apps/web/src/main-view.ts', ok('main-view'), all),
    ).toHaveLength(1);
  });

  it('does not check components outside apps/web', () => {
    expect(
      componentViolations(
        'libs/other/src/foo.ts',
        "@Component({ template: '<p></p>' })\nexport class X {}\n",
        none,
      ),
    ).toEqual([]);
  });

  it('reports one violation per reason for a file with several faults', () => {
    const found = componentViolations(
      `${WEB}/foo.ts`,
      "@Component({ template: '<p></p>', styles: ['a{}'] })\nexport class X {}\n",
      none,
    );
    expect(found.map((v) => v.detail)).toEqual([
      'inline template or styles',
      `expected ${WEB}/foo/foo.ts`,
    ]);
  });

  it('copes with an empty file', () => {
    expect(componentViolations(`${WEB}/foo.ts`, '', none)).toEqual([]);
  });

  it('copes with a byte order mark before the decorator', () => {
    expect(
      componentViolations(`${WEB}/foo/foo.ts`, `﻿${ok('foo')}`, all),
    ).toEqual([]);
  });

  it('does not treat a decorator named in a comment as a component', () => {
    expect(
      componentViolations(
        `${WEB}/foo.ts`,
        '// @Component({ template: "x" }) was removed\nexport const a = 1;\n',
        none,
      ),
    ).toEqual([]);
  });

  it('does not mistake template text inside a string for an inline template', () => {
    expect(
      componentViolations(
        `${WEB}/foo/foo.ts`,
        "@Component({ templateUrl: './foo.html' })\nexport class X { label = 'template: nothing'; }\n",
        all,
      ),
    ).toEqual([]);
  });
});

describe('baseline comparison', () => {
  const v = (file: string): Violation => ({
    detail: 'flat submodule "bell", move it to x/bell/',
    file,
    rule: 'submodules',
  });

  it('passes with nothing found and an empty baseline', () => {
    expect(baselineErrors([], empty)).toEqual([]);
  });

  it('fails a violation listed under the other rule', () => {
    expect(
      baselineErrors([v('a.ts')], { components: ['a.ts'], submodules: [] }),
    ).toEqual([
      'a.ts: flat submodule "bell", move it to x/bell/',
      'stale baseline entry: components a.ts, remove it from scripts/structure-baseline.json',
    ]);
  });

  it('reports a baseline entry listed twice', () => {
    const errors = baselineErrors([v('a.ts')], {
      components: [],
      submodules: ['a.ts', 'a.ts'],
    });
    expect(errors).not.toEqual([]);
  });

  it('reports each stale entry once, in rule order', () => {
    expect(
      baselineErrors([], { components: ['b.ts'], submodules: ['a.ts'] }),
    ).toEqual([
      'stale baseline entry: submodules a.ts, remove it from scripts/structure-baseline.json',
      'stale baseline entry: components b.ts, remove it from scripts/structure-baseline.json',
    ]);
  });

  it('flags growth against an empty base baseline', () => {
    expect(
      baselineErrors(
        [v('a.ts')],
        { components: [], submodules: ['a.ts'] },
        { baseline: empty, ref: 'origin/main' },
      ),
    ).toEqual(["baseline grew: a.ts is not in origin/main's baseline"]);
  });

  it('flags growth when the entry moved from one rule to the other', () => {
    expect(
      baselineErrors(
        [
          {
            detail: 'inline template or styles',
            file: 'a.ts',
            rule: 'components',
          },
        ],
        { components: ['a.ts'], submodules: [] },
        {
          baseline: { components: [], submodules: ['a.ts'] },
          ref: 'origin/main',
        },
      ),
    ).toEqual(["baseline grew: a.ts is not in origin/main's baseline"]);
  });
});

describe('node scripts/structure-check.ts', () => {
  let dir: string;
  const env = cleanEnv();
  const put = (path: string, text: string | Buffer) => {
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
  const baseline = (value: unknown) =>
    put('scripts/structure-baseline.json', `${JSON.stringify(value)}\n`);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'structure-adv-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.test');
    git('config', 'user.name', 'test');
  });

  afterEach(() => rmSync(dir, { force: true, recursive: true }));

  it('passes an empty tree', () => {
    baseline(empty);
    commit();
    const res = run();
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(
      'structure: 0 files checked, 0 baselined, ok',
    );
  });

  it('ignores untracked violating files', () => {
    baseline(empty);
    commit();
    put(`${MOD}/bell.a.ts`, 'export {};\n');
    put(`${MOD}/bell.b.ts`, 'export {};\n');
    expect(run().status).toBe(0);
  });

  it('ignores violations under excluded trees', () => {
    baseline(empty);
    for (const root of [
      'libs/ui-cockpit/src/lib',
      'libs/data-access/src/lib',
      'libs/domain/src/generated',
      'apps/web-e2e/src',
    ]) {
      put(`${root}/a.ts`, 'export {};\n');
      put(`${root}/a-b.ts`, 'export {};\n');
    }
    put(
      'apps/web-e2e/src/inline.ts',
      "@Component({ template: 'x' })\nclass X {}\n",
    );
    commit();
    expect(run().status).toBe(0);
  });

  it('does not read a UTF-16 file', () => {
    baseline(empty);
    put(
      `${WEB}/bar/bar.ts`,
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("@Component({ template: 'x' })", 'utf16le'),
      ]),
    );
    commit();
    const res = run();
    expect(res.status).toBe(0);
  });

  it('reads a Latin-1 component file', () => {
    baseline(empty);
    put(
      `${WEB}/foo/foo.ts`,
      Buffer.from(
        "// caf\xe9\n@Component({ templateUrl: './foo.html' })\nexport class X {}\n",
        'latin1',
      ),
    );
    put(`${WEB}/foo/foo.html`, '<p></p>');
    commit();
    const res = run();
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
  });

  it('reads a binary blob named .ts', () => {
    baseline(empty);
    put(`${WEB}/blob/blob.ts`, Buffer.from([0, 1, 2, 255, 254, 0]));
    commit();
    const res = run();
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
  });

  it('handles a component file of tens of megabytes', () => {
    baseline(empty);
    put(
      `${WEB}/big/big.ts`,
      `export const x = '${'a'.repeat(40 * 1024 * 1024)}';\n`,
    );
    commit();
    const res = run();
    expect(res.status).toBe(0);
  }, 60000);

  it('does not report a violation read through a symlink that points outside the tree', () => {
    baseline(empty);
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outside, 'x.ts'), "@Component({ template: 'x' })\n");
    mkdirSync(join(dir, WEB), { recursive: true });
    execFileSync('ln', [
      '-s',
      join(outside, 'x.ts'),
      join(dir, WEB, 'link.ts'),
    ]);
    commit();
    const res = run();
    rmSync(outside, { force: true, recursive: true });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });

  it('handles a tracked symlink whose target is missing', () => {
    baseline(empty);
    mkdirSync(join(dir, WEB), { recursive: true });
    execFileSync('ln', [
      '-s',
      '/nonexistent/x.ts',
      join(dir, WEB, 'dangling.ts'),
    ]);
    commit();
    const res = run();
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });

  it('fails with a clear message when the baseline is missing', () => {
    put('README.md', 'x');
    commit();
    const res = run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('scripts/structure-baseline.json');
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['empty text', ''],
    ['lists of the wrong type', '{"submodules":"a","components":[]}'],
    ['a list holding numbers', '{"submodules":[1],"components":[]}'],
  ])('fails cleanly on a baseline that is %s', (_title, text) => {
    put('scripts/structure-baseline.json', text);
    commit();
    const res = run();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('scripts/structure-baseline.json');
    expect(res.stderr).not.toContain('TypeError');
  });

  it('fails naming a base ref that does not exist', () => {
    baseline(empty);
    commit();
    const res = run('--base', 'origin/does-not-exist');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('origin/does-not-exist');
  });

  it('fails when --base is given without a value', () => {
    baseline(empty);
    commit();
    expect(run('--base').status).not.toBe(0);
  });

  it('fails when the head baseline grew against a real base commit', () => {
    baseline(empty);
    commit();
    git('branch', 'basebranch');
    put(`${MOD}/bell.a.ts`, 'export {};\n');
    put(`${MOD}/bell.b.ts`, 'export {};\n');
    baseline({
      components: [],
      submodules: [`${MOD}/bell.a.ts`, `${MOD}/bell.b.ts`],
    });
    commit();
    const res = run('--base', 'basebranch');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(
      `baseline grew: ${MOD}/bell.a.ts is not in basebranch's baseline`,
    );
  });

  it('fails clearly when the base ref holds an unparsable baseline', () => {
    put('scripts/structure-baseline.json', 'not json');
    commit();
    git('branch', 'basebranch');
    baseline(empty);
    commit();
    const res = run('--base', 'basebranch');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('basebranch');
  });

  it('fails a baseline listing the same violation twice', () => {
    put(`${MOD}/bell.a.ts`, 'export {};\n');
    put(`${MOD}/bell.b.ts`, 'export {};\n');
    baseline({
      components: [],
      submodules: [`${MOD}/bell.a.ts`, `${MOD}/bell.a.ts`, `${MOD}/bell.b.ts`],
    });
    commit();
    expect(run().status).toBe(1);
  });
});

describe('scanRepo', () => {
  let dir: string;
  const env = cleanEnv();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'structure-scan-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
  });
  afterEach(() => rmSync(dir, { force: true, recursive: true }));

  it('returns nothing for an empty repository', () => {
    expect(scanRepo(dir)).toEqual({ checked: 0, violations: [] });
  });

  it('keeps non-ascii file names intact', () => {
    mkdirSync(join(dir, MOD), { recursive: true });
    writeFileSync(join(dir, MOD, 'șoferi.ts'), 'export {};\n');
    writeFileSync(join(dir, MOD, 'șoferi-lista.ts'), 'export {};\n');
    execFileSync('git', ['add', '-A'], { cwd: dir, env });
    expect(files(scanRepo(dir).violations)).toEqual(
      at(MOD, ['șoferi-lista.ts', 'șoferi.ts']),
    );
  });
});

describe('baseline ratchet hook', () => {
  const rel = 'scripts/structure-baseline.json';
  const judge = (current: string | null, next: string | null) => {
    const code = `import(${JSON.stringify(HOOK)}).then(m=>{const a=JSON.parse(process.argv[1]);console.log(JSON.stringify(m.verdict({rel:${JSON.stringify(rel)},current:a.c,next:a.n,profile:'standard'})??null))})`;
    return spawnSync(
      'node',
      ['-e', code, JSON.stringify({ c: current, n: next })],
      { encoding: 'utf8' },
    ).stdout.trim();
  };
  const body = (s: string[], c: string[]) =>
    JSON.stringify({ components: c, submodules: s });

  it('refuses a duplicated entry that raises the count', () => {
    expect(judge(body(['a'], []), body(['a', 'a'], []))).not.toBe('null');
  });

  it('refuses moving the whole baseline into one list with an extra entry', () => {
    expect(judge(body(['a'], ['b']), body(['a', 'b', 'c'], []))).not.toBe(
      'null',
    );
  });

  it('allows deleting the file', () => {
    expect(judge(body(['a'], []), null)).toBe('null');
  });
});
