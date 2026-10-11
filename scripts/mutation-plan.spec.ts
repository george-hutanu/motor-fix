// @traces 1159-FR-001 1159-FR-002 1159-FR-003 1159-FR-005 1159-FR-015
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
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
} from './mutation-plan.ts';

let repo: string;

const matches = (glob: string, path: string) => matchesGlob(path, glob);

function specFiles(base: string, root: string): string[] {
  return readdirSync(join(base, root, 'src'), { recursive: true })
    .map(String)
    .filter((file) => /\.(spec|test)\.ts$/.test(file))
    .map((file) => `${root}/src/${file}`);
}

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

const shardFile = (projects: Record<string, unknown>) =>
  write(
    'scripts/mutation-shards.json',
    JSON.stringify({
      default: { measured: 'default figure', timeout: 60 },
      projects,
    }),
  );

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'mutation-plan-'));
  project('apps/api', 'api');
  project('libs/domain', 'domain');
  project('libs/plain', 'plain', false);
  project('scripts', 'scripts');
  write('libs/domain/src/index.ts');
  write('libs/domain/src/auth/auth.service.ts');
  write('libs/domain/src/auth/auth.service.spec.ts');
  write('libs/domain/src/auth/oauth/oauth.ts');
  write('libs/domain/src/auth/oauth/oauth.integration.spec.ts');
  write('libs/domain/src/quotes/quotes.ts');
  write('libs/domain/src/quotes/quotes.spec.ts');
  write('libs/domain/src/generated/client.ts');
  write('libs/domain/src/cars/cars.ts');
});

afterEach(() => {
  rmSync(repo, { force: true, recursive: true });
});

describe('mutationProjects', () => {
  it('lists every project with a test:mutation target, by name, apps, libs and scripts', () => {
    expect(mutationProjects(repo)).toEqual([
      { name: 'api', root: 'apps/api' },
      { name: 'domain', root: 'libs/domain' },
      { name: 'scripts', root: 'scripts' },
    ]);
  });
});

describe('mutatedFiles', () => {
  it('lists the source files under src, without specs, tests, generated code or test setup', () => {
    write('libs/domain/src/test-setup.ts');
    write('libs/domain/src/thing.test.ts');

    expect(mutatedFiles(repo, 'libs/domain')).toEqual([
      'auth/auth.service.ts',
      'auth/oauth/oauth.ts',
      'cars/cars.ts',
      'index.ts',
      'quotes/quotes.ts',
    ]);
  });
});

describe('plan', () => {
  it('gives one job per project when no project is sharded, with each project timeout or the default', () => {
    shardFile({ api: { measured: '41 min', timeout: 90 } });

    expect(plan(repo, {})).toEqual([
      { id: 'api', project: 'api', root: 'apps/api', shard: '', timeout: 90 },
      {
        id: 'domain',
        project: 'domain',
        root: 'libs/domain',
        shard: '',
        timeout: 60,
      },
      {
        id: 'scripts',
        project: 'scripts',
        root: 'scripts',
        shard: '',
        timeout: 60,
      },
    ]);
  });

  it('treats a missing shard file as no shards and default timeouts', () => {
    expect(plan(repo, {}).map((e) => [e.id, e.timeout])).toEqual([
      ['api', 60],
      ['domain', 60],
      ['scripts', 60],
    ]);
    expect(readShardFile(repo).projects).toEqual({});
  });

  it('gives a sharded project one job per named shard plus rest, the longest first', () => {
    shardFile({
      domain: {
        measured: 'rest figure',
        shards: {
          auth: { folders: ['auth'], measured: 'a', timeout: 150 },
          quotes: { folders: ['quotes'], measured: 'q', timeout: 100 },
        },
        timeout: 45,
      },
    });

    expect(plan(repo, { projects: 'domain' })).toEqual([
      {
        id: 'domain-auth',
        project: 'domain',
        root: 'libs/domain',
        shard: 'auth',
        timeout: 150,
      },
      {
        id: 'domain-quotes',
        project: 'domain',
        root: 'libs/domain',
        shard: 'quotes',
        timeout: 100,
      },
      {
        id: 'domain-rest',
        project: 'domain',
        root: 'libs/domain',
        shard: 'rest',
        timeout: 45,
      },
    ]);
  });

  it('narrows to the projects named and the shards named', () => {
    shardFile({
      domain: {
        measured: 'r',
        shards: { auth: { folders: ['auth'], measured: 'a', timeout: 90 } },
        timeout: 30,
      },
    });

    expect(
      plan(repo, { projects: 'api, domain', shards: 'domain:rest' }).map(
        (e) => e.id,
      ),
    ).toEqual(['api', 'domain-rest']);
    expect(plan(repo, { shards: 'domain:auth' }).map((e) => e.id)).toEqual([
      'domain-auth',
    ]);
  });

  it.each([
    [{ projects: 'nope' }, 'nope'],
    [{ projects: 'plain' }, 'plain'],
    [{ shards: 'domain:nope' }, 'domain:nope'],
    [{ shards: 'api:rest' }, 'api:rest'],
    [{ shards: 'domain' }, 'domain'],
    [{ projects: 'api', shards: 'domain:auth' }, 'domain:auth'],
  ])('refuses %j and names %s', (filters, named) => {
    shardFile({
      domain: {
        measured: 'r',
        shards: { auth: { folders: ['auth'], measured: 'a', timeout: 90 } },
        timeout: 30,
      },
    });

    expect(() => plan(repo, filters)).toThrow(named);
  });

  it.each([
    ['a folder that does not exist', { s: ['missing'] }, 'missing'],
    ['a folder in two shards', { a: ['auth'], b: ['auth'] }, 'auth'],
    [
      'a folder inside another shard folder',
      { a: ['auth'], b: ['auth/oauth'] },
      'auth/oauth/oauth.ts',
    ],
    ['a shard named rest', { rest: ['auth'] }, 'rest'],
    ['a shard with no folders', { empty: [] }, 'empty'],
    ['a folder that is not a string', { odd: [7] }, 'odd'],
  ])('refuses %s', (_case, folders, named) => {
    shardFile({
      domain: {
        measured: 'r',
        shards: Object.fromEntries(
          Object.entries(folders).map(([name, list]) => [
            name,
            { folders: list, measured: 'm', timeout: 60 },
          ]),
        ),
        timeout: 30,
      },
    });

    expect(() => plan(repo, {})).toThrow(named);
  });

  it('refuses a listed project with no mutation target', () => {
    shardFile({ plain: { measured: 'm', timeout: 30 } });

    expect(() => plan(repo, {})).toThrow('plain');
  });

  it.each([0, 361, 1.5])(
    'refuses a timeout of %s minutes, outside 1 to 360',
    (timeout) => {
      shardFile({ api: { measured: 'm', timeout } });

      expect(() => plan(repo, {})).toThrow('api');
    },
  );

  it('refuses a timeout with no measured run beside it', () => {
    shardFile({ api: { timeout: 30 } });

    expect(() => plan(repo, {})).toThrow('api');
  });
});

describe('assignFiles', () => {
  it('puts every mutated file in exactly one shard, rest taking what no folder holds', () => {
    const assigned = assignFiles(repo, 'libs/domain', {
      auth: ['auth/*'],
      top: ['*'],
    });

    expect(Object.fromEntries(assigned)).toEqual({
      'auth/auth.service.ts': 'auth',
      'auth/oauth/oauth.ts': 'rest',
      'cars/cars.ts': 'rest',
      'index.ts': 'top',
      'quotes/quotes.ts': 'rest',
    });
  });
});

describe('shardScope', () => {
  const shards = { auth: ['auth/*', 'auth/oauth'], top: ['*'] };

  it('mutates only a named shard folders and runs only the specs inside them', () => {
    expect(shardScope('libs/domain', shards, 'auth')).toEqual({
      mutate: [
        'libs/domain/src/auth/*.ts',
        'libs/domain/src/auth/oauth/**/*.ts',
        '!libs/domain/src/**/*.spec.ts',
        '!libs/domain/src/**/*.test.ts',
        '!libs/domain/src/**/generated/**',
        '!libs/domain/src/**/test-setup.ts',
      ],
      testMatch: [
        '**/libs/domain/src/auth/*.{spec,test}.ts',
        '**/libs/domain/src/auth/oauth/**/*.{spec,test}.ts',
      ],
      testPathIgnorePatterns: ['/node_modules/'],
    });
  });

  it('gives rest everything outside the named folders, files and specs alike', () => {
    expect(shardScope('libs/domain', shards, 'rest')).toEqual({
      mutate: [
        'libs/domain/src/**/*.ts',
        '!libs/domain/src/**/*.spec.ts',
        '!libs/domain/src/**/*.test.ts',
        '!libs/domain/src/**/generated/**',
        '!libs/domain/src/**/test-setup.ts',
        '!libs/domain/src/auth/*.ts',
        '!libs/domain/src/auth/oauth/**/*.ts',
        '!libs/domain/src/*.ts',
      ],
      testMatch: ['**/libs/domain/src/**/*.{spec,test}.ts'],
      testPathIgnorePatterns: [
        '/node_modules/',
        '/libs/domain/src/auth/[^/]+$',
        '/libs/domain/src/auth/oauth/',
        '/libs/domain/src/[^/]+$',
      ],
    });
  });

  it('refuses a shard the project does not have', () => {
    expect(() => shardScope('libs/domain', shards, 'nope')).toThrow('nope');
  });
});

describe('the repository shard file', () => {
  const real = join(__dirname, '..');

  it('plans every project and shard without an error', () => {
    const entries = plan(real, {});

    expect(entries.length).toBeGreaterThan(mutationProjects(real).length);
    expect(entries.every((e) => e.timeout > 0 && e.timeout <= 360)).toBe(true);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it('puts each mutated file of every sharded project in exactly one shard', () => {
    const { projects } = readShardFile(real);
    const roots = new Map(
      mutationProjects(real).map((p) => [p.name, p.root] as const),
    );
    for (const [name, own] of Object.entries(projects)) {
      if (!own.shards) continue;
      const root = roots.get(name) ?? '';
      const folders = Object.fromEntries(
        Object.entries(own.shards).map(([s, v]) => [s, v.folders]),
      );
      const assigned = assignFiles(real, root, folders);

      expect([...assigned.keys()].sort()).toEqual(mutatedFiles(real, root));
    }
  });

  // A shard with no spec of its own would score every mutant uncovered.
  it('gives every shard of the repository at least one spec of its own', () => {
    const { projects } = readShardFile(real);
    const roots = new Map(
      mutationProjects(real).map((p) => [p.name, p.root] as const),
    );
    const empty = Object.entries(projects).flatMap(([name, own]) => {
      if (!own.shards) return [];
      const folders = Object.fromEntries(
        Object.entries(own.shards).map(([s, v]) => [s, v.folders]),
      );
      const scope = (shard: string) =>
        shardScope(roots.get(name) ?? '', folders, shard);
      const specs = (shard: string) => {
        const { testMatch, testPathIgnorePatterns } = scope(shard);
        const ignored = testPathIgnorePatterns.map((p) => new RegExp(p));
        return specFiles(real, roots.get(name) ?? '').filter(
          (file) =>
            testMatch.some((glob) => matches(glob, `/${file}`)) &&
            !ignored.some((re) => re.test(`/${file}`)),
        );
      };
      return [...Object.keys(folders), 'rest']
        .filter((shard) => specs(shard).length === 0)
        .map((shard) => `${name}:${shard}`);
    });

    expect(empty).toEqual([]);
  });

  it('shards domain and web, the two projects that outran one job', () => {
    const { projects } = readShardFile(real);

    expect(Object.keys(projects.domain?.shards ?? {}).length).toBeGreaterThan(
      4,
    );
    expect(Object.keys(projects.web?.shards ?? {}).length).toBeGreaterThan(2);
  });
});
