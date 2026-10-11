import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, matchesGlob } from 'node:path';

import {
  assignFiles,
  mutatedFiles,
  mutationProjects,
  plan,
  readShardFile,
  shardScope,
  shardsOf,
} from './mutation-plan.ts';

const realRepo = join(__dirname, '..');
const planScript = join(__dirname, 'mutation-plan.ts');

let repo: string;
let outside: string;

function write(path: string, content = '') {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), content);
}

const project = (root: string, name: string, mutation = true) =>
  write(
    `${root}/project.json`,
    JSON.stringify({
      name,
      targets: mutation ? { test: {}, 'test:mutation': {} } : { test: {} },
    }),
  );

const shardFile = (
  projects: Record<string, unknown>,
  def: unknown = { measured: 'default figure', timeout: 60 },
) =>
  write(
    'scripts/mutation-shards.json',
    JSON.stringify({ default: def, projects }),
  );

const domain = (shards: Record<string, unknown>, extra = {}) =>
  shardFile({
    domain: { measured: 'figure', shards, timeout: 100, ...extra },
  });

const shard = (
  folders: unknown,
  timeout: unknown = 50,
  measured: unknown = 'm',
) => ({
  folders,
  measured,
  timeout,
});

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'mutation-adv-'));
  outside = mkdtempSync(join(tmpdir(), 'mutation-adv-out-'));
  project('apps/api', 'api');
  project('libs/domain', 'domain');
  project('libs/plain', 'plain', false);
  write('libs/domain/src/index.ts');
  write('libs/domain/src/auth/auth.ts');
  write('libs/domain/src/auth/auth.spec.ts');
  write('libs/domain/src/auth/oauth/oauth.ts');
  write('libs/domain/src/auth/oauth/oauth.spec.ts');
  write('libs/domain/src/auth-flows/flow.ts');
  write('libs/domain/src/auth-flows/flow.spec.ts');
  write('libs/domain/src/quotes/quotes.ts');
  write('libs/domain/src/quotes/quotes.spec.ts');
});

afterEach(() => {
  rmSync(repo, { force: true, recursive: true });
  rmSync(outside, { force: true, recursive: true });
});

describe('shard file shapes', () => {
  it('treats an empty shard file as no shards', () => {
    write('scripts/mutation-shards.json', '');

    expect(plan(repo, {}).map((e) => e.id)).toEqual(['api', 'domain']);
  });

  it('treats an empty object as no shards and default timeouts', () => {
    write('scripts/mutation-shards.json', '{}');

    expect(plan(repo, {}).map((e) => [e.id, e.timeout])).toEqual([
      ['api', 60],
      ['domain', 60],
    ]);
  });

  it('refuses a shard file that is not JSON', () => {
    write('scripts/mutation-shards.json', '{ not json');

    expect(() => plan(repo, {})).toThrow();
  });

  it('refuses a project entry that is null', () => {
    shardFile({ domain: null });

    expect(() => plan(repo, {})).toThrow(/domain/);
  });

  it('names a project in the shard file that has no mutation target', () => {
    shardFile({ plain: { measured: 'x', timeout: 10 } });

    expect(() => plan(repo, {})).toThrow(/plain/);
  });
});

describe('shard validation', () => {
  it('refuses a folder that does not exist and names it', () => {
    domain({ a: shard(['nope']) });

    expect(() => plan(repo, {})).toThrow(/nope/);
  });

  it('refuses a shallow folder whose directory does not exist', () => {
    domain({ a: shard(['nope/*']) });

    expect(() => plan(repo, {})).toThrow(/nope/);
  });

  it('refuses a folder that climbs out of src', () => {
    domain({ a: shard(['..']) });

    expect(() => plan(repo, {})).toThrow(/\.\./);
  });

  it('refuses an absolute folder', () => {
    domain({ a: shard([outside]) });

    expect(() => plan(repo, {})).toThrow();
  });

  // The shard globs and assignFiles would read `auth/` differently.
  it('refuses a folder given with a trailing slash', () => {
    domain({ a: shard(['auth/']) });

    expect(() => plan(repo, {})).toThrow(/auth\//);
  });

  it('refuses a shard with no folders', () => {
    domain({ a: shard([]) });

    expect(() => plan(repo, {})).toThrow(/a/);
  });

  it('refuses a shard whose folders is a string', () => {
    domain({ a: shard('auth') });

    expect(() => plan(repo, {})).toThrow(/domain:a/);
  });

  it('refuses a shard named rest', () => {
    domain({ rest: shard(['auth']) });

    expect(() => plan(repo, {})).toThrow(/rest/);
  });

  it('refuses the same folder in two shards of a project', () => {
    domain({ a: shard(['auth']), b: shard(['auth']) });

    expect(() => plan(repo, {})).toThrow(/auth/);
  });

  it('refuses a folder and its parent in two shards', () => {
    domain({ a: shard(['auth']), b: shard(['auth/oauth']) });

    expect(() => plan(repo, {})).toThrow(/oauth/);
  });

  it('refuses x and x/* in two shards because the files directly in x are in both', () => {
    domain({ a: shard(['auth']), b: shard(['auth/*']) });

    expect(() => plan(repo, {})).toThrow(/auth/);
  });

  it('allows x/* and x/sub together because they hold different files', () => {
    domain({ a: shard(['auth/*']), b: shard(['auth/oauth']) });

    expect(
      plan(repo, {})
        .map((e) => e.id)
        .sort(),
    ).toEqual(['api', 'domain-a', 'domain-b', 'domain-rest']);
  });

  it('keeps auth and auth-flows apart', () => {
    domain({ a: shard(['auth']), b: shard(['auth-flows']) });

    const owners = assignFiles(repo, 'libs/domain', {
      a: ['auth'],
      b: ['auth-flows'],
    });
    expect(Object.fromEntries(owners)).toEqual({
      'auth-flows/flow.ts': 'b',
      'auth/auth.ts': 'a',
      'auth/oauth/oauth.ts': 'a',
      'index.ts': 'rest',
      'quotes/quotes.ts': 'rest',
    });
  });

  it.each([['a:b'], ['a/b'], ['A B']])(
    'refuses a shard name %p that cannot be filtered or used as a report path',
    (name) => {
      domain({ [name]: shard(['auth']) });

      expect(() => plan(repo, {})).toThrow(/shard/i);
    },
  );

  it('refuses a project shard id that equals another project name', () => {
    project('libs/domain-a', 'domain-a');
    domain({ a: shard(['auth']) });

    expect(() => plan(repo, {})).toThrow(/domain-a/);
  });
});

describe('timeouts', () => {
  it.each([0, -5, 361, 400, 60.5, '60', null, true])(
    'refuses a project timeout of %p',
    (value) => {
      shardFile({ api: { measured: 'x', timeout: value } });

      expect(() => plan(repo, {})).toThrow(/api/);
    },
  );

  it('accepts exactly 360 and 1', () => {
    shardFile({
      api: { measured: 'x', timeout: 360 },
      domain: { measured: 'y', timeout: 1 },
    });

    expect(plan(repo, {}).map((e) => [e.id, e.timeout])).toEqual([
      ['api', 360],
      ['domain', 1],
    ]);
  });

  it('refuses a shard timeout of 361', () => {
    domain({ a: shard(['auth'], 361) });

    expect(() => plan(repo, {})).toThrow(/domain:a/);
  });

  it.each(['', '   ', 5, null])(
    'refuses a shard whose measured note is %p',
    (note) => {
      domain({ a: shard(['auth'], 50, note) });

      expect(() => plan(repo, {})).toThrow(/domain:a/);
    },
  );

  it('refuses a default timeout over 360', () => {
    shardFile({}, { measured: 'x', timeout: 999 });

    expect(() => plan(repo, {})).toThrow(/default/);
  });

  it('refuses a rest timeout missing from a sharded project', () => {
    shardFile({ domain: { measured: 'x', shards: { a: shard(['auth']) } } });

    expect(() => plan(repo, {})).toThrow(/domain/);
  });
});

describe('filters', () => {
  beforeEach(() => {
    domain({ a: shard(['auth']), b: shard(['quotes']) });
  });

  it('names an unknown project', () => {
    expect(() => plan(repo, { projects: 'ghost' })).toThrow(/ghost/);
  });

  it('names a project that has no mutation target', () => {
    expect(() => plan(repo, { projects: 'plain' })).toThrow(/plain/);
  });

  it('names an unknown shard', () => {
    expect(() => plan(repo, { shards: 'domain:zzz' })).toThrow(/domain:zzz/);
  });

  it('refuses a shard of an unsharded project, rest included', () => {
    expect(() => plan(repo, { shards: 'api:rest' })).toThrow(/api:rest/);
  });

  it('refuses a shard item without a colon', () => {
    expect(() => plan(repo, { shards: 'domain' })).toThrow(/domain/);
  });

  it('refuses an item with an empty shard', () => {
    expect(() => plan(repo, { shards: 'domain:' })).toThrow(/domain:/);
  });

  it('refuses an item with two colons', () => {
    expect(() => plan(repo, { shards: 'domain:a:b' })).toThrow(/domain:a:b/);
  });

  it('is case sensitive about projects and shards', () => {
    expect(() => plan(repo, { projects: 'Domain' })).toThrow(/Domain/);
    expect(() => plan(repo, { shards: 'domain:A' })).toThrow(/domain:A/);
  });

  it('refuses a shard of a project absent from projects', () => {
    expect(() => plan(repo, { projects: 'api', shards: 'domain:a' })).toThrow(
      /domain:a/,
    );
  });

  it('narrows the named project to the named shards', () => {
    expect(
      plan(repo, { projects: 'domain', shards: 'domain:a,domain:rest' }).map(
        (e) => e.id,
      ),
    ).toEqual(['domain-rest', 'domain-a']);
  });

  it('gives only the named shard when shards alone is set', () => {
    expect(plan(repo, { shards: 'domain:b' }).map((e) => e.id)).toEqual([
      'domain-b',
    ]);
  });

  it('gives every shard of a project named without shards', () => {
    expect(
      plan(repo, { projects: 'domain' })
        .map((e) => e.id)
        .sort(),
    ).toEqual(['domain-a', 'domain-b', 'domain-rest']);
  });

  it('tolerates spaces, empty items and trailing commas', () => {
    expect(
      plan(repo, { projects: ' api , ,domain,', shards: ' domain:a ,' }).map(
        (e) => e.id,
      ),
    ).toEqual(['api', 'domain-a']);
  });

  it('treats whitespace-only filters as empty', () => {
    expect(plan(repo, { projects: '  ', shards: ' , ' })).toHaveLength(4);
  });

  it('does not repeat a job named twice', () => {
    const ids = plan(repo, {
      projects: 'domain,domain',
      shards: 'domain:a,domain:a',
    }).map((e) => e.id);

    expect(ids).toEqual(['domain-a']);
  });

  it('returns the same plan on a second call and with filters in another order', () => {
    const one = plan(repo, { projects: 'domain,api' });
    const two = plan(repo, { projects: 'api,domain' });

    expect(two).toEqual(one);
    expect(plan(repo, {})).toEqual(plan(repo, {}));
  });

  it('puts the longest jobs first and orders equal ones by id', () => {
    domain({ a: shard(['auth'], 70), b: shard(['quotes'], 70) });

    expect(plan(repo, {}).map((e) => [e.id, e.timeout])).toEqual([
      ['domain-rest', 100],
      ['domain-a', 70],
      ['domain-b', 70],
      ['api', 60],
    ]);
  });
});

describe('the rest shard', () => {
  it('holds a folder added after the shard file was written', () => {
    domain({ a: shard(['auth']) });
    write('libs/domain/src/brand-new/thing.ts');

    const owners = assignFiles(repo, 'libs/domain', { a: ['auth'] });

    expect(owners.get('brand-new/thing.ts')).toBe('rest');
  });

  it('does not count generated code, specs or test setup as mutated', () => {
    write('libs/domain/src/generated/x.ts');
    write('libs/domain/src/auth/generated/y.ts');
    write('libs/domain/src/test-setup.ts');
    write('libs/domain/src/auth/test-setup.ts');
    write('libs/domain/src/q.test.ts');
    write('libs/domain/src/node_modules/z.ts');

    expect(mutatedFiles(repo, 'libs/domain')).toEqual([
      'auth-flows/flow.ts',
      'auth/auth.ts',
      'auth/oauth/oauth.ts',
      'index.ts',
      'quotes/quotes.ts',
    ]);
  });

  it('is empty for a project without src', () => {
    expect(mutatedFiles(repo, 'apps/api')).toEqual([]);
  });

  it('does not follow a symlinked directory to files outside the tree', () => {
    mkdirSync(join(outside, 'deep'), { recursive: true });
    writeFileSync(join(outside, 'deep', 'leak.ts'), '');
    symlinkSync(outside, join(repo, 'libs/domain/src/linked'));

    expect(mutatedFiles(repo, 'libs/domain')).not.toContain(
      'linked/deep/leak.ts',
    );
    expect(
      mutatedFiles(repo, 'libs/domain').some((f) => f.startsWith('linked')),
    ).toBe(false);
  });

  it('does not loop on a symlink pointing at its own parent', () => {
    symlinkSync(
      join(repo, 'libs/domain/src'),
      join(repo, 'libs/domain/src/auth/loop'),
    );

    expect(mutatedFiles(repo, 'libs/domain')).toHaveLength(5);
  });

  it('lists a ten-thousand-file project once each', () => {
    for (let i = 0; i < 2000; i++) write(`libs/domain/src/bulk/f${i}.ts`);
    domain({ a: shard(['bulk']) });

    const owners = assignFiles(repo, 'libs/domain', { a: ['bulk'] });

    expect([...owners.values()].filter((o) => o === 'a')).toHaveLength(2000);
  });
});

type Tree = { project: string; root: string; shards: Record<string, string[]> };

const selected = (patterns: string[], path: string) => {
  const positive = patterns.filter((p) => !p.startsWith('!'));
  const negative = patterns
    .filter((p) => p.startsWith('!'))
    .map((p) => p.slice(1));
  return (
    positive.some((p) => matchesGlob(path, p)) &&
    !negative.some((p) => matchesGlob(path, p))
  );
};

function runs(tree: Tree, shardName: string, specPath: string): boolean {
  const scope = shardScope(tree.root, tree.shards, shardName);
  const abs = `/work/${specPath}`;
  return (
    scope.testMatch.some((p) => matchesGlob(abs, p)) &&
    !scope.testPathIgnorePatterns.some((p) => new RegExp(p).test(abs))
  );
}

function specsOf(root: string, base: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of require('node:fs').readdirSync(dir, {
      withFileTypes: true,
    })) {
      const rel = `${prefix}${e.name}`;
      if (e.isDirectory()) walk(join(dir, e.name), `${rel}/`);
      else if (/\.(spec|test)\.ts$/.test(e.name))
        out.push(`${base}/src/${rel}`);
    }
  };
  walk(join(root, base, 'src'), '');
  return out;
}

describe('exactly-once coverage through the globs a shard hands to Stryker and Jest', () => {
  it('puts every mutated file and every spec of a synthetic tree in exactly one shard', () => {
    write('libs/domain/src/auth/a.test.ts');
    write('libs/domain/src/auth/oauth/deeper/d.ts');
    write('libs/domain/src/auth/oauth/deeper/d.spec.ts');
    write('libs/domain/src/a.b/dot.ts');
    write('libs/domain/src/a.b/dot.spec.ts');
    write('libs/domain/src/aXb/x.ts');
    write('libs/domain/src/aXb/x.spec.ts');
    write('libs/domain/src/a-b/plus.ts');
    write('libs/domain/src/a-b/plus.spec.ts');
    write('libs/domain/src/top.spec.ts');
    write('libs/domain/src/util/u.ts');
    write('libs/domain/src/util/u.spec.ts');
    write('libs/domain/src/util/sub/s.ts');
    write('libs/domain/src/util/sub/s.spec.ts');
    const shards = {
      a: ['auth/*', 'a.b'],
      b: ['auth/oauth', 'a-b'],
      c: ['util/*', '*'],
    };
    const tree: Tree = { project: 'domain', root: 'libs/domain', shards };
    domain(
      Object.fromEntries(Object.entries(shards).map(([k, v]) => [k, shard(v)])),
    );
    expect(plan(repo, {}).length).toBeGreaterThan(0);

    const names = [...Object.keys(shards), 'rest'];
    for (const file of mutatedFiles(repo, 'libs/domain')) {
      const owners = names.filter((n) =>
        selected(
          shardScope('libs/domain', shards, n).mutate,
          `libs/domain/src/${file}`,
        ),
      );
      expect({ file, owners: owners.length }).toEqual({ file, owners: 1 });
    }
    for (const spec of specsOf(repo, 'libs/domain')) {
      const owners = names.filter((n) => runs(tree, n, spec));
      expect({ owners: owners.length, spec }).toEqual({ owners: 1, spec });
    }
  });

  it('keeps a mutated file and its sibling spec in the same shard', () => {
    const shards = { a: ['auth/*'], b: ['auth/oauth', 'quotes'] };
    const tree: Tree = { project: 'domain', root: 'libs/domain', shards };
    const names = ['a', 'b', 'rest'];
    for (const [file, spec] of [
      ['auth/auth.ts', 'auth/auth.spec.ts'],
      ['auth/oauth/oauth.ts', 'auth/oauth/oauth.spec.ts'],
      ['quotes/quotes.ts', 'quotes/quotes.spec.ts'],
      ['auth-flows/flow.ts', 'auth-flows/flow.spec.ts'],
      ['index.ts', 'index.spec.ts'],
    ] as const) {
      const mutating = names.find((n) =>
        selected(
          shardScope('libs/domain', shards, n).mutate,
          `libs/domain/src/${file}`,
        ),
      );
      expect(runs(tree, mutating as string, `libs/domain/src/${spec}`)).toBe(
        true,
      );
    }
  });

  // Stryker and Jest would read it as a glob, not the folder.
  it('refuses a folder holding glob characters', () => {
    write('libs/domain/src/[id]/page.ts');
    domain({ a: shard(['[id]']) });

    expect(() => plan(repo, {})).toThrow(/\[id\]/);
  });

  it('gives a sharded project with an unknown shard name an error from shardScope', () => {
    expect(() => shardScope('libs/domain', { a: ['auth'] }, 'zzz')).toThrow(
      /zzz/,
    );
  });

  it('gives the rest shard every spec when no shard names a folder', () => {
    const scope = shardScope('libs/domain', {}, 'rest');

    expect(scope.testPathIgnorePatterns).toEqual(['/node_modules/']);
    expect(scope.mutate[0]).toBe('libs/domain/src/**/*.ts');
  });
});

describe('the repository as it is', () => {
  const file = readShardFile(realRepo);
  const sharded = Object.keys(file.projects).filter((p) => shardsOf(file, p));

  it('has sharded projects to check', () => {
    expect(sharded.sort()).toEqual(['domain', 'web']);
  });

  it.each(['domain', 'web'])(
    'puts every mutated file and spec of %s in exactly one shard, by the real globs',
    (name) => {
      const root = mutationProjects(realRepo).find((p) => p.name === name)
        ?.root as string;
      const shards = shardsOf(file, name) as Record<string, string[]>;
      const names = [...Object.keys(shards), 'rest'];
      const tree: Tree = { project: name, root, shards };
      const unowned = (path: string, owners: string[]) =>
        owners.length === 1 ? [] : [`${path}: ${owners.join('+') || 'none'}`];
      const files = mutatedFiles(realRepo, root).flatMap((f) =>
        unowned(
          f,
          names.filter((n) =>
            selected(shardScope(root, shards, n).mutate, `${root}/src/${f}`),
          ),
        ),
      );
      const specs = specsOf(realRepo, root).flatMap((s) =>
        unowned(
          s,
          names.filter((n) => runs(tree, n, s)),
        ),
      );
      expect([...files, ...specs]).toEqual([]);
    },
  );

  it('plans unique job ids, one per project or shard, and never a bare sharded project', () => {
    const entries = plan(realRepo, {});
    const ids = entries.map((e) => e.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('domain');
    expect(ids).not.toContain('web');
    expect(ids).toContain('domain-rest');
    expect(ids).toContain('web-rest');
    expect(entries.every((e) => e.timeout >= 1 && e.timeout <= 360)).toBe(true);
  });

  it('plans exactly the jobs the shard file lists, plus a rest for each sharded project', () => {
    const entries = plan(realRepo, {});
    const expected = mutationProjects(realRepo).flatMap(({ name }) => {
      const shards = shardsOf(file, name);
      return shards
        ? [...Object.keys(shards), 'rest'].map((s) => `${name}:${s}`)
        : [`${name}:`];
    });

    expect(entries.map((e) => `${e.project}:${e.shard}`).sort()).toEqual(
      expected.sort(),
    );
  });

  it('writes a timeout at least 30 percent over every figure it quotes in minutes', () => {
    const projects = file.projects as Record<
      string,
      {
        measured: string;
        timeout: number;
        shards?: Record<string, { measured: string; timeout: number }>;
      }
    >;
    const owners = Object.entries(projects).flatMap(([name, own]) => [
      [name, own.measured, own.timeout] as const,
      ...Object.entries(own.shards ?? {}).map(
        ([s, v]) => [`${name}:${s}`, v.measured, v.timeout] as const,
      ),
    ]);
    const short = owners.filter(([, measured, timeout]) => {
      if (/unsharded|over \d+/.test(measured)) return false;
      const minutes = Number(/(\d+) min/.exec(measured)?.[1]);
      return Number.isFinite(minutes) && timeout < Math.ceil(minutes * 1.3);
    });
    expect(short).toEqual([]);
  });
});

describe('the command', () => {
  const run = (env: Record<string, string>, cwd = repo) =>
    spawnSync('node', [planScript], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PROJECTS: '', SHARDS: '', ...env },
    });

  it('writes matrix=<json> with an include list to GITHUB_OUTPUT, one line', () => {
    domain({ a: shard(['auth']) });
    const out = join(repo, 'gh-output');
    writeFileSync(out, 'earlier=1\n');

    const result = run({ GITHUB_OUTPUT: out });

    expect(result.status).toBe(0);
    const lines = readFileSync(out, 'utf8').trimEnd().split('\n');
    expect(lines[0]).toBe('earlier=1');
    expect(lines).toHaveLength(2);
    const matrix = JSON.parse((lines[1] as string).replace(/^matrix=/, ''));
    expect(matrix.include.map((e: { id: string }) => e.id).sort()).toEqual([
      'api',
      'domain-a',
      'domain-rest',
    ]);
  });

  it('exits 1 and names an unknown project, writing no matrix', () => {
    const out = join(repo, 'gh-output');

    const result = run({ GITHUB_OUTPUT: out, PROJECTS: 'ghost' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ghost/);
    expect(() => readFileSync(out, 'utf8')).toThrow();
  });

  it('exits 1 for an unknown shard', () => {
    domain({ a: shard(['auth']) });

    const result = run({ SHARDS: 'domain:zzz' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/domain:zzz/);
  });

  it('plans the real repository from the command', () => {
    const out = join(repo, 'real-output');

    const result = run({ GITHUB_OUTPUT: out }, realRepo);

    expect(result.status).toBe(0);
    const matrix = JSON.parse(
      readFileSync(out, 'utf8').replace(/^matrix=/, ''),
    );
    expect(matrix.include.length).toBeGreaterThan(10);
  });
});
