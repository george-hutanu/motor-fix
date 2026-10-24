import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = join(__dirname, '..');
const INTEGRATION = /\.integration\.spec\.ts$/;

// The guard is private to the root spec, so its pattern block is lifted from
// that file's text and evaluated; the spec's rules are the oracle.
function guard(): RegExp {
  const text = readFileSync(join(__dirname, 'test-suites.spec.ts'), 'utf8');
  const block = /const KEY = [\s\S]*?\n\);\n/.exec(text);
  if (!block) throw new Error('guard pattern block not found');
  return new Function(`${block[0]}\nreturn NEEDS_SERVICES;`)() as RegExp;
}

const needsServices = (source: string) =>
  guard().test(
    source
      .replaceAll('§env', 'process.env')
      .replaceAll('§seed', 'seed' + '.ts'),
  );

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return ['node_modules', 'test-output'].includes(entry.name)
        ? []
        : walk(path);
    return /\.spec\.ts$/.test(entry.name) ? [path] : [];
  });
}

function projectDir(file: string): string | undefined {
  for (let dir = dirname(file); dir.startsWith(root); dir = dirname(dir))
    if (existsSync(join(dir, 'project.json'))) return dir;
  return undefined;
}

describe('the services guard on hostile sources', () => {
  // @traces 438-FR-003
  it.each([
    ['dot form with a strict comparison', "if (§env.DATABASE_URL === 'x') {}"],
    ['dot form with no space before a comparison', "§env.REDIS_URL=='x'"],
    ['dot form compound read', "§env.DATABASE_URL += '?ssl=1';"],
    [
      'dot form nullish assignment, which reads first',
      "§env.REDIS_URL ??= 'x';",
    ],
    [
      'assignment followed by a read in one source',
      "§env.DATABASE_URL = 'x';\nconst u = §env.DATABASE_URL;",
    ],
    ['a comment holding the whole expression', '// §env.DATABASE_URL'],
    ['destructuring with a trailing comma', 'const { DATABASE_URL, } = §env;'],
    [
      'destructuring across lines',
      'const {\n  NODE_ENV,\n  REDIS_URL,\n  PORT,\n} = §env;',
    ],
    [
      'destructuring with a rename and other keys',
      'const { A, DATABASE_URL: url, B } = §env;',
    ],
    [
      'destructuring with a default',
      "const { DATABASE_URL = 'postgres://x' } = §env;",
    ],
    [
      'destructuring key after a rename entry',
      'const { x: y, REDIS_URL } = §env;',
    ],
    ['destructuring with no spaces', 'const {DATABASE_URL}=§env;'],
    [
      'bracket form with single quotes after a delete of another key',
      "delete §env.A; §env['DATABASE_URL'];",
    ],
    ['seed in double quotes', 'run("§seed")'],
  ])('reports %s', (_title, source) => {
    expect(needsServices(source)).toBe(true);
  });

  // @traces 438-FR-003
  it.each([
    ['a longer dot identifier', '§env.DATABASE_URL_SHADOW'],
    ['a longer bracket key', "§env['DATABASE_URL_TEST']"],
    ['a prefixed identifier', '§env.MY_DATABASE_URL'],
    ['a dollar-suffixed identifier', '§env.DATABASE_URL$x'],
    ['an identifier continued by a non-ASCII letter', '§env.DATABASE_URLé'],
    ['a longer destructured key', 'const { DATABASE_URL_TEST } = §env;'],
    ['a prefixed destructured key', 'const { X_REDIS_URL } = §env;'],
    ['the name in value position', 'const { url: DATABASE_URL } = §env;'],
    [
      'the name in value position after other keys',
      'const { NODE_ENV, url: REDIS_URL } = §env;',
    ],
    ['the name as a default value', 'const { a = DATABASE_URL, b } = §env;'],
    ['destructuring from something else', 'const { DATABASE_URL } = config;'],
    [
      'destructuring from a longer name',
      'const { DATABASE_URL } = §environment;',
    ],
    ['another variable by dot', '§env.NODE_ENV'],
    ['another destructured variable', 'const { PORT } = §env;'],
    ['a bare name in a string', "const s = 'DATABASE_URL';"],
    ['a bare name in a comment', '// reads DATABASE_URL elsewhere'],
    ['a bare declaration', "const DATABASE_URL = 'x';"],
    ['a dot assignment', "§env.DATABASE_URL = 'x';"],
    ['a dot assignment with no space', "§env.REDIS_URL='x';"],
    ['a dot assignment on the next line', "§env.REDIS_URL\n  = 'x';"],
    ['a bracket assignment', "§env['DATABASE_URL'] = 'x';"],
    ['a delete by dot', 'delete §env.DATABASE_URL;'],
    ['a delete by bracket', "delete §env['REDIS_URL'];"],
    ['a delete separated by two spaces', 'delete  §env.DATABASE_URL;'],
    [
      'a delete separated by a newline and indent',
      'delete\n    §env.REDIS_URL;',
    ],
    ['an empty source', ''],
    ['a source of only whitespace', ' \n\t\n'],
  ])('does not report %s', (_title, source) => {
    expect(needsServices(source)).toBe(false);
  });

  // @traces 438-FR-003
  it('reports a seed path run through a shell command', () => {
    expect(needsServices("execSync('tsx prisma/§seed')")).toBe(true);
  });

  // @traces 438-FR-003
  it('decides a large source of unclosed braces in bounded time', () => {
    const source = '{ a,'.repeat(40_000);
    const started = Date.now();

    expect(needsServices(source)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  }, 30_000);

  // @traces 438-FR-003
  it('decides a large source repeating a key with no closing brace in bounded time', () => {
    const source = `{${', DATABASE_URL'.repeat(40_000)}`;
    const started = Date.now();

    expect(needsServices(source)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  }, 120_000);

  // @traces 438-FR-003
  it('decides a large source with a read at the very end', () => {
    const source = `${'const a = { b: 1 };\n'.repeat(50_000)}§env.REDIS_URL;`;

    expect(needsServices(source)).toBe(true);
  });

  // @traces 438-FR-003
  it('gives the same answer for the same source twice', () => {
    const source = 'const { DATABASE_URL } = §env;';

    expect([needsServices(source), needsServices(source)]).toEqual([
      true,
      true,
    ]);
  });
});

describe('the repository against the split rules', () => {
  const specs = ['apps', 'libs'].flatMap((dir) => walk(join(root, dir)));
  const integration = specs.filter((f) => INTEGRATION.test(f));
  const projects = [
    ...new Set(integration.map((f) => relative(root, projectDir(f) as string))),
  ].sort();

  // @traces 438-FR-001
  it('has every integration spec inside a project', () => {
    expect(integration.filter((f) => projectDir(f) === undefined)).toEqual([]);
  });

  // @traces 438-FR-001
  it('has a Jest config in every project that holds an integration spec', () => {
    const without = projects.filter(
      (p) =>
        !readdirSync(join(root, p)).some((n) => n.startsWith('jest.config.')),
    );

    expect(without).toEqual([]);
  });

  // @traces 438-FR-002
  it('holds integration specs in the two historical projects', () => {
    expect(projects).toEqual(
      expect.arrayContaining(['apps/api', 'libs/domain']),
    );
  });

  // @traces 438-FR-001
  it('keeps projects without integration specs out of the derived list', () => {
    expect(projects).not.toContain('libs/contracts');
    expect(projects).not.toContain('apps/web');
    expect(projects).not.toContain('apps/web-e2e');
    expect(projects).not.toContain('libs/data-access');
  });

  // @traces 438-FR-001
  it('derives the same list from git as from the walk', () => {
    const tracked = execFileSync('git', ['ls-files', '--', 'apps', 'libs'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((f) => INTEGRATION.test(f))
      .map((f) => relative(root, projectDir(join(root, f)) as string));

    expect([...new Set(tracked)].sort()).toEqual(projects);
  });

  // @traces 438-FR-003
  it('finds no unit-named spec that reads a service URL or runs the seed', () => {
    const re = guard();
    const misnamed = [...specs, ...walk(join(root, 'scripts'))]
      .filter((f) => !INTEGRATION.test(f))
      .filter((f) => !f.endsWith('test-suites.spec.ts'))
      .filter((f) => !f.endsWith('test-suites.adversary.spec.ts'))
      .filter((f) => {
        const p = projectDir(f);
        return (
          p !== undefined &&
          readdirSync(p).some((n) => n.startsWith('jest.config.'))
        );
      })
      .filter((f) => re.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f));

    expect(misnamed).toEqual([]);
  });
});
