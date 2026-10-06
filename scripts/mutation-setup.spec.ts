import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

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
  it('finds the projects it checks', () => {
    expect(mutated).toEqual(
      expect.arrayContaining(['apps/web', 'libs/overlays', 'scripts']),
    );
  });

  // Stryker reads a Jest config without its preset, so an environment that
  // only the preset sets falls back to node and every browser spec fails.
  it.each(mutated)(
    '%s names its test environment in its own config',
    (root) => {
      expect(read(`${root}/jest.config.cts`)).toMatch(
        /^\s*testEnvironment: '(node|jsdom)',$/m,
      );
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

  it.each(['apps/api', 'libs/domain'])(
    '%s runs one test runner at a time',
    (root) => {
      expect(JSON.parse(read(`${root}/stryker.config.json`))).toMatchObject({
        concurrency: 1,
      });
    },
  );
});

describe('mutation workflow', () => {
  const workflow = read('.github/workflows/mutation.yml');

  it('takes a full run on demand, without earlier results', () => {
    expect(workflow).toMatch(/^ {6}full:\n(?: {8}.+\n)*? {8}type: boolean$/m);
    expect(workflow).toMatch(
      /^ {6}- name: Restore the mutation results of earlier runs\n {8}if: \$\{\{ !inputs\.full \}\}$/m,
    );
    expect(workflow).toMatch(/-- --incremental=\$INCREMENTAL$/m);
    expect(workflow).toMatch(
      /INCREMENTAL: \$\{\{ inputs\.full && 'false' \|\| 'true' \}\}$/m,
    );
  });

  it('sets its time limit from a measured run, within the job ceiling', () => {
    const limit = workflow.match(/^ {4}# (.+)\n {4}timeout-minutes: (\d+)$/m);
    expect(limit?.[1]).toMatch(/measured/);
    expect(Number(limit?.[2])).toBeLessThanOrEqual(360);
  });
});
