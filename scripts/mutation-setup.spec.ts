// @traces 1159-FR-011 1159-FR-013 1159-FR-017
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { strykerOptions } from './mutation.ts';

// What every project's mutation run depends on, read from the repository as
// text: Stryker reads these files differently from a plain Jest run.
const repo = join(__dirname, '..');
const read = (path: string) => readFileSync(join(repo, path), 'utf8');

const mutated = ['apps', 'libs']
  .flatMap((dir) =>
    readdirSync(join(repo, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${dir}/${entry.name}`),
  )
  .concat('scripts')
  .filter((root) => {
    try {
      read(`${root}/stryker.config.json`);
      return true;
    } catch {
      return false;
    }
  });

function sources(dir: string): string[] {
  return readdirSync(join(repo, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory())
        return entry.name === 'node_modules' ? [] : sources(path);
      return path.endsWith('.ts') ? [path] : [];
    },
  );
}

const sourceFiles = mutated
  .filter((root) => root !== 'scripts')
  .flatMap((root) => sources(`${root}/src`));

describe('mutation setup', () => {
  const cwd = process.cwd();

  afterEach(() => {
    process.chdir(cwd);
  });

  it('finds the projects it checks', () => {
    expect(mutated).toEqual(
      expect.arrayContaining(['apps/web', 'libs/overlays', 'scripts']),
    );
  });

  // Stryker reads a Jest config without its preset, so an environment that
  // only the preset sets falls back to node and every browser spec fails.
  // A project may name its own environment file under <rootDir>.
  it.each(mutated)(
    '%s names its test environment in its own config',
    (root) => {
      const named = read(`${root}/jest.config.cts`).match(
        /^\s*testEnvironment: '(node|jsdom|<rootDir>\/[^']+)',$/m,
      )?.[1];
      expect(named).toBeDefined();
      const file = named?.replace('<rootDir>', root) ?? '';
      if (file !== named) expect(existsSync(join(repo, file))).toBe(true);
    },
  );

  // Stryker reads the config without normalising it, so it would look for a
  // module called "<rootDir>/…"; strykerOptions hands it the resolved file.
  it.each(mutated)(
    '%s gives Stryker an environment file it can load',
    (root) => {
      process.chdir(repo);
      const env = (
        strykerOptions(root, root, false).jest as {
          config?: { testEnvironment?: string };
        }
      ).config?.testEnvironment;
      const own = /testEnvironment: '<rootDir>\//.test(
        read(`${root}/jest.config.cts`),
      );
      expect(env === undefined).toBe(!own);
      if (env) expect(existsSync(env)).toBe(true);
    },
  );

  // A built-in environment named in a docblock replaces the one Stryker wraps
  // to collect coverage, and the run stops on missing coverage.
  it('leaves no spec on a built-in environment of its own', () => {
    const own = sourceFiles.filter((file) =>
      /@jest-environment\s+(node|jsdom)\s*$/m.test(read(file)),
    );
    expect(own).toEqual([]);
  });

  // A mutated constant read by a component decorator is no longer a literal
  // Angular can analyse, and the whole test run fails to compile.
  it('silences the constants component metadata reads', () => {
    const unsilenced = sourceFiles.flatMap((file) => {
      const text = read(file);
      const names = [
        ...text.matchAll(/^\s+(?:styles|template): ([A-Z][A-Z0-9_]*),$/gm),
      ].map((match) => match[1]);
      return [...new Set(names)]
        .filter(
          (name) =>
            !new RegExp(
              `// Stryker disable next-line \\w+: .+\\n(?:export )?const ${name}\\b`,
            ).test(text),
        )
        .map((name) => `${relative(repo, join(repo, file))}: ${name}`);
    });
    expect(unsilenced).toEqual([]);
  });

  // Each test runner would take its own database turn; one at a time keeps
  // the turns from queueing past Stryker's timeout.
  const withDatabase = mutated.filter(
    (root) =>
      root !== 'scripts' &&
      sources(`${root}/src`).some((file) =>
        file.endsWith('.integration.spec.ts'),
      ),
  );

  it('finds the projects whose specs use the database', () => {
    expect(withDatabase).toEqual(
      expect.arrayContaining(['apps/api', 'libs/domain']),
    );
  });

  it.each(withDatabase)('%s runs one test runner at a time', (root) => {
    expect(JSON.parse(read(`${root}/stryker.config.json`))).toMatchObject({
      concurrency: 1,
    });
  });

  // Its specs read git (structure-check, observability-inventory), which sees
  // nothing in Stryker's copied sandbox; .gitignore keeps .stryker-tmp and
  // reports out of git.
  it('runs the scripts project in the checked-out repository', () => {
    expect(JSON.parse(read('scripts/stryker.config.json'))).toMatchObject({
      inPlace: true,
    });
    expect(read('.gitignore')).toMatch(/^\.stryker-tmp\/$/m);
    expect(read('.gitignore')).toMatch(/^reports\/$/m);
  });
});
