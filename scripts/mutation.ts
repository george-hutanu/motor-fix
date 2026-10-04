// Runs Stryker for one Nx project: the target behind `nx run <p>:test:mutation`.
//
//   node scripts/mutation.ts <project> <projectRoot> [--incremental] [--mutate <glob>]
//
// The options every project shares live here; <projectRoot>/stryker.config.json
// holds the project's floor (thresholds.break, a ratchet guarded by
// config-protection.mjs) and any option where the project differs. Stryker
// sets the exit code when the score is under the floor.

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DETECTED = ['Killed', 'Timeout'];
const UNDETECTED = ['Survived', 'NoCoverage'];
const STRYKER = '@stryker-mutator/core';
const HEADER = '| Project | Mutation score | Floor |\n|---|---|---|\n';

type StrykerCore = {
  Stryker: new (
    options: Record<string, unknown>,
  ) => { runMutationTest(): Promise<{ status: string }[]> };
};

export function strykerOptions(
  project: string,
  root: string,
  incremental: boolean,
  only?: string,
): Record<string, unknown> {
  const file = join(root, 'stryker.config.json');
  let own: { thresholds?: { break?: unknown } } | null = null;
  try {
    own = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  if (typeof own?.thresholds?.break !== 'number')
    throw new Error(
      `${file} is missing, is not JSON, or sets no thresholds.break`,
    );
  const lib = join(root, 'tsconfig.lib.json');
  const reports = `reports/mutation/${project}`;
  return {
    checkers: ['typescript'],
    htmlReporter: { fileName: `${reports}/index.html` },
    // Stryker copies the repository into its sandbox and ignores .gitignore.
    ignorePatterns: [
      'dist',
      'coverage',
      '.nx',
      'reports',
      '.angular',
      '.worktrees',
      '.claude/worktrees',
      'apps/web-e2e/test-output',
      '.specify/**/.cache',
    ],
    // A static mutant reloads its module and reruns every test; on libs/domain
    // they were 14% of mutants and two thirds of the run time.
    ignoreStatic: true,
    incremental,
    incrementalFile: `${reports}/incremental.json`,
    jest: { configFile: join(root, 'jest.config.cts') },
    mutate: [
      `${root}/src/**/*.ts`,
      `!${root}/src/**/*.spec.ts`,
      `!${root}/src/**/*.test.ts`,
      `!${root}/src/**/generated/**`,
      `!${root}/src/**/test-setup.ts`,
    ],
    testRunner: 'jest',
    tsconfigFile: existsSync(lib) ? lib : join(root, 'tsconfig.app.json'),
    ...own,
    ...(only && { mutate: [only] }),
  };
}

export function hasSpecs(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
      ? entry.name !== 'node_modules' && hasSpecs(join(dir, entry.name))
      : /\.(spec|test)\.ts$/.test(entry.name),
  );
}

export function mutationScore(statuses: string[]): number | null {
  const detected = statuses.filter((s) => DETECTED.includes(s)).length;
  const counted =
    detected + statuses.filter((s) => UNDETECTED.includes(s)).length;
  return counted ? (detected / counted) * 100 : null;
}

export function summaryRows(
  summary: string,
  project: string,
  score: number | null,
  floor: number,
): string {
  const row = `| ${project} | ${score === null ? 'n/a' : `${score.toFixed(2)}%`} | ${floor} |\n`;
  return summary ? row : HEADER + row;
}

async function main() {
  const [project, root] = process.argv.slice(2);
  if (!project || !root)
    throw new Error(
      'usage: mutation.ts <project> <projectRoot> [--incremental] [--mutate <glob>]',
    );
  console.log(`mutation: ${project}`);
  if (!hasSpecs(root)) {
    console.log(`${project}: no tests yet, mutation run skipped`);
    return;
  }
  const at = process.argv.indexOf('--mutate');
  const options = strykerOptions(
    project,
    root,
    process.argv.includes('--incremental'),
    at === -1 ? undefined : process.argv[at + 1],
  );
  // A specifier the compiler cannot follow: the spec build resolves with node10,
  // which cannot see this ESM-only package.
  const { Stryker }: StrykerCore = await import(STRYKER);
  const results = await new Stryker(options).runMutationTest();
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) {
    const score = mutationScore(results.map((r) => r.status));
    const { thresholds } = options as { thresholds: { break: number } };
    appendFileSync(
      summary,
      summaryRows(
        existsSync(summary) ? readFileSync(summary, 'utf8') : '',
        project,
        score,
        thresholds.break,
      ),
    );
  }
}

if (process.argv[1]?.endsWith('mutation.ts')) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
