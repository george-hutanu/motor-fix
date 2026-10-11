// Runs Stryker for one Nx project: the target behind `nx run <p>:test:mutation`.
//
//   node scripts/mutation.ts <project> <projectRoot> [--incremental] [--mutate <glob>] [--shard <name>]
//
// The options every project shares live here; <projectRoot>/stryker.config.json
// holds the project's floor (thresholds.break, a ratchet guarded by
// config-protection.mjs) and any option where the project differs. Stryker
// sets the exit code when the score is under the floor. `--shard` runs one
// shard of a project split in scripts/mutation-shards.json: only its files
// and its specs, with the break off, since the Mutation workflow's summary
// job holds the shards' combined score to the floor. Every run writes
// score.json beside its report for that job.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { readShardFile, shardScope, shardsOf } from './mutation-plan.ts';

const DETECTED = ['Killed', 'Timeout'];
const UNDETECTED = ['Survived', 'NoCoverage'];
const STRYKER = '@stryker-mutator/core';
const HEADER =
  '| Project | Mutation score | Floor | Minutes |\n|---|---|---|---|\n';

type StrykerCore = {
  Stryker: new (
    options: Record<string, unknown>,
  ) => { runMutationTest(): Promise<{ status: string }[]> };
};

// Long enough for domain's 329 specs, which outran Stryker's 5-minute
// default before any mutant ran (run 38037093986).
const DRY_RUN_TIMEOUT_MINUTES = 30;

export const reportsDir = (project: string, shard?: string) =>
  `reports/mutation/${project}${shard ? `/${shard}` : ''}`;

type Scope = ReturnType<typeof shardScope>;

function scopeOf(project: string, root: string, shard: string): Scope {
  const shards = shardsOf(readShardFile(process.cwd()), project);
  if (!shards)
    throw new Error(`${project} has no shards in scripts/mutation-shards.json`);
  return shardScope(root, shards, shard);
}

export function strykerOptions(
  project: string,
  root: string,
  incremental: boolean,
  only?: string,
  shard?: string,
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
  const reports = reportsDir(project, shard);
  const scope = shard ? scopeOf(project, root, shard) : undefined;
  return {
    checkers: ['typescript'],
    dryRunTimeoutMinutes: DRY_RUN_TIMEOUT_MINUTES,
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
    // Leaves the option objects of input(), output() and the signal queries
    // unmutated: Angular's compiler refuses one that is not a literal (1010).
    ignorers: ['angular'],
    // A static mutant reloads its module and reruns every test; on libs/domain
    // they were 14% of mutants and two thirds of the run time.
    ignoreStatic: true,
    incremental,
    incrementalFile: `${reports}/incremental.json`,
    jest: jestOptions(root, scope),
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
    ...(scope && {
      mutate: scope.mutate,
      thresholds: { ...own.thresholds, break: null },
    }),
    ...(only && { mutate: [only] }),
  };
}

// Stryker reads the Jest config without normalising it, so a project's own
// `<rootDir>/…` environment would reach it as a module it cannot find: hand it
// the resolved file instead.
// A shard's spec paths go in the same way, over the file's own.
function jestOptions(root: string, scope?: Scope): Record<string, unknown> {
  const configFile = join(root, 'jest.config.cts');
  let text = '';
  try {
    text = readFileSync(configFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const own = text.match(/^\s*testEnvironment: '<rootDir>\/([^']+)',$/m)?.[1];
  const config = {
    ...(own && { testEnvironment: resolve(root, own) }),
    ...(scope && {
      testMatch: scope.testMatch,
      testPathIgnorePatterns: scope.testPathIgnorePatterns,
    }),
  };
  return Object.keys(config).length ? { config, configFile } : { configFile };
}

// Nx forwards `--incremental` as `--incremental=true` and `--mutate x` as
// `--mutate=x`; a person typing the command uses the spaced forms.
export function flags(args: string[]): {
  incremental: boolean;
  only: string | undefined;
  shard: string | undefined;
} {
  const value = (name: string) => {
    const at = args.indexOf(name);
    if (at !== -1) return args[at + 1] ?? '';
    return args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  };
  const incremental = value('--incremental');
  return {
    incremental: incremental !== undefined && incremental !== 'false',
    only: value('--mutate'),
    shard: value('--shard') || undefined,
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

export type ScoreRecord = {
  floor: number;
  killed: number;
  minutes: number;
  noCoverage: number;
  project: string;
  score: number | null;
  shard: string;
  survived: number;
  timeout: number;
};

/** What one job leaves for the summary job: its counts, not just a score. */
export function scoreRecord(
  project: string,
  shard: string,
  statuses: string[],
  floor: number,
  ms: number,
): ScoreRecord {
  const count = (status: string) => statuses.filter((s) => s === status).length;
  return {
    floor,
    killed: count('Killed'),
    minutes: Math.round(ms / 6_000) / 10,
    noCoverage: count('NoCoverage'),
    project,
    score: mutationScore(statuses),
    shard,
    survived: count('Survived'),
    timeout: count('Timeout'),
  };
}

export function summaryRows(
  summary: string,
  project: string,
  score: number | null,
  floor: number,
  ms: number,
): string {
  const row = `| ${project} | ${score === null ? 'n/a' : `${score.toFixed(2)}%`} | ${floor} | ${(ms / 60_000).toFixed(1)} |\n`;
  return summary ? row : HEADER + row;
}

function floorOf(root: string): number {
  const own = JSON.parse(
    readFileSync(join(root, 'stryker.config.json'), 'utf8'),
  );
  return own.thresholds.break;
}

function writeScore(reports: string, record: object): void {
  mkdirSync(reports, { recursive: true });
  writeFileSync(join(reports, 'score.json'), `${JSON.stringify(record)}\n`);
}

async function main() {
  const [project, root] = process.argv.slice(2);
  if (!project || !root)
    throw new Error(
      'usage: mutation.ts <project> <projectRoot> [--incremental] [--mutate <glob>] [--shard <name>]',
    );
  const { incremental, only, shard } = flags(process.argv.slice(4));
  const label = shard ? `${project} ${shard}` : project;
  console.log(`mutation: ${label}`);
  const reports = reportsDir(project, shard);
  if (!hasSpecs(root)) {
    console.log(`${label}: no tests yet, mutation run skipped`);
    writeScore(reports, { project, shard: shard ?? '', skipped: true });
    return;
  }
  const options = strykerOptions(project, root, incremental, only, shard);
  // A specifier the compiler cannot follow: the spec build resolves with node10,
  // which cannot see this ESM-only package.
  const { Stryker }: StrykerCore = await import(STRYKER);
  const started = Date.now();
  const results = await new Stryker(options).runMutationTest();
  const record = scoreRecord(
    project,
    shard ?? '',
    results.map((r) => r.status),
    floorOf(root),
    Date.now() - started,
  );
  writeScore(reports, record);
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary)
    appendFileSync(
      summary,
      summaryRows(
        existsSync(summary) ? readFileSync(summary, 'utf8') : '',
        label,
        record.score,
        record.floor,
        Date.now() - started,
      ),
    );
}

if (process.argv[1]?.endsWith('mutation.ts')) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
