import { defineConfig } from 'vitest/config';

// Specs that need PostgreSQL or Redis are named *.integration.spec.ts.
// TEST_SUITE=unit leaves them out, TEST_SUITE=integration runs only them, and
// no TEST_SUITE runs everything. A chosen suite passes a project that has
// none of its specs, as the other suite may hold them all. jest.preset.cjs
// reads the same variable for the projects still on Jest.
const SUITES = ['unit', 'integration'] as const;
type Suite = (typeof SUITES)[number];

function chosenSuite(): Suite | undefined {
  const suite = process.env['TEST_SUITE'];
  if (!suite) return undefined;
  if (!(SUITES as readonly string[]).includes(suite))
    throw new Error(
      `TEST_SUITE must be "unit" or "integration", or unset; got "${suite}"`,
    );
  return suite as Suite;
}

function suiteFiles(include: string[], suite: Suite | undefined) {
  if (suite === 'integration')
    return {
      exclude: [],
      include: include.map((glob) =>
        glob.replace(/\*\.spec\.ts$/, '*.integration.spec.ts'),
      ),
    };
  if (suite === 'unit')
    return { exclude: ['**/*.integration.spec.ts'], include };
  return { exclude: [], include };
}

export function nestPreset(
  root: string,
  {
    include = ['src/**/*.spec.ts'],
    setupFiles = [],
    testTimeout,
  }: { include?: string[]; setupFiles?: string[]; testTimeout?: number } = {},
) {
  const suite = chosenSuite();
  const files = suiteFiles(include, suite);
  // scripts/heavy.sh and lifecycle.mjs check cap a run in a shared
  // heavy-command slot through JEST_MAX_WORKERS, whichever runner reads it.
  const maxWorkers = Number(process.env['JEST_MAX_WORKERS']) || undefined;
  return defineConfig({
    resolve: { tsconfigPaths: true },
    root,
    test: {
      environment: 'node',
      exclude: ['**/node_modules/**', ...files.exclude],
      globals: true,
      include: files.include,
      passWithNoTests: suite !== undefined,
      // A setup file's afterAll runs after the spec's own (database-turn.setup.ts
      // gives the turn back only after the spec's teardown).
      sequence: { hooks: 'stack' },
      setupFiles,
      ...(maxWorkers && { maxWorkers }),
      ...(testTimeout && { testTimeout }),
    },
  });
}
