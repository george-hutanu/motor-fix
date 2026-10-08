// Gives the pre-commit hook a PostgreSQL and a Redis private to this worktree
// when the projects it is about to test hold integration specs.
//
//   node scripts/test-services.ts <base-ref>
//
// Starts (or reuses) the compose project named after the worktree, on ports
// Docker assigns, waits for PostgreSQL, applies the branch's migrations, and
// prints `export DATABASE_URL=… REDIS_URL=…` for the hook to eval. Prints
// nothing when no affected project holds an integration spec. Everything else
// goes to stderr; any failure exits non-zero, so the commit stops rather than
// running without its integration specs.
//
// The services stay up between commits, so only the first one pays the start.
// A database holding a migration this branch does not have, or one applied
// with other SQL (the worktree changed branch), is recreated before the
// migrations run. `docker compose -p <project> down -v` removes them.
//
//   node scripts/test-services.ts down [<worktree>]
//
// Stops that worktree's stack (the current checkout's by default), keeping its
// volumes, and prints `{"project","stopped"[,"reason"]}`. `lifecycle.mjs merge`
// runs it for the merged branch's worktree.
//
//   node scripts/test-services.ts sweep
//
// Stops every test stack of this clone whose worktree is gone (volumes too)
// or whose branch's newest PR merged or closed (volumes kept), and prints one
// line. `/speckit-watch` runs it on each `--fix` pass. Neither ever exits
// non-zero for Docker: no Docker, or a down it refuses, is one stderr line.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

type Project = { name: string; root: string };
type Ports = { postgres: number; redis: number };
type Migration = { name: string; checksum: string };

const migrations = 'libs/domain/prisma/migrations';
// How long PostgreSQL gets to accept connections after `up`.
const waitSeconds = Number(process.env.TEST_SERVICES_WAIT_SECONDS ?? 60);

export function composeProject(worktree: string): string {
  const slug = basename(worktree)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  const hash = createHash('sha1').update(worktree).digest('hex').slice(0, 6);
  return `mf-test-${slug}-${hash}`;
}

type Stack = { name: string; dir: string };
type Worktree = { path: string; branch: string | undefined };
type Pr = { headRefName: string; number: number; state: string };
type Stop = { project: string; reason: string; volumes: boolean };

// `docker compose ls --all --format json`: a stack's folder is the one its
// first compose file sits in.
export function parseStacks(json: string): Stack[] {
  if (!json.trim()) return [];
  return (JSON.parse(json) as { Name: string; ConfigFiles: string }[]).map(
    (row) => ({ dir: dirname(row.ConfigFiles.split(',')[0]), name: row.Name }),
  );
}

export function parseWorktrees(porcelain: string): Worktree[] {
  return porcelain
    .split('\n\n')
    .map((entry) => entry.split('\n'))
    .filter((lines) => lines[0]?.startsWith('worktree '))
    .map((lines) => ({
      branch: lines
        .find((line) => line.startsWith('branch '))
        ?.slice('branch refs/heads/'.length),
      path: lines[0].slice('worktree '.length),
    }));
}

// Which test stacks to stop. Only a stack named by composeProject after its
// own folder counts: a gone folder goes with its volumes; a folder that is a
// worktree of this clone goes, volumes kept, once its branch's newest PR
// merged or closed. `prs` is null when the PR list could not be read.
export function sweepPlan(
  stacks: (Stack & { exists: boolean })[],
  worktrees: Worktree[],
  prs: Pr[] | null,
): Stop[] {
  return stacks
    .filter((stack) => stack.name === composeProject(stack.dir))
    .map((stack) =>
      stack.exists
        ? closedPr(stack, worktrees, prs)
        : { project: stack.name, reason: 'worktree gone', volumes: true },
    )
    .filter((stop): stop is Stop => stop !== undefined);
}

function closedPr(
  stack: Stack,
  worktrees: Worktree[],
  prs: Pr[] | null,
): Stop | undefined {
  const branch = worktrees.find((w) => w.path === stack.dir)?.branch;
  if (!branch || branch === 'main' || !prs) return undefined;
  const newest = prs
    .filter((pr) => pr.headRefName === branch)
    .sort((a, b) => b.number - a.number)[0];
  if (!newest || newest.state === 'OPEN') return undefined;
  return {
    project: stack.name,
    reason: `PR #${newest.number} ${newest.state.toLowerCase()}`,
    volumes: false,
  };
}

export function needsServices(
  affected: string[],
  specs: string[],
  projects: Project[],
): boolean {
  return projects.some(
    ({ name, root }) =>
      affected.includes(name) &&
      specs.some((spec) => spec.startsWith(`${root}/`)),
  );
}

export function projectName(file: string, json: unknown): string {
  const name = (json as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') throw new Error(`${file} has no name`);
  return name;
}

export function schemaDrift(applied: Migration[], local: Migration[]): boolean {
  const sql = new Map(local.map((m) => [m.name, m.checksum]));
  return applied.some((m) => sql.get(m.name) !== m.checksum);
}

export function parsePort(output: string): number {
  const match = output.match(/:(\d+)\s*$/m);
  if (!match) throw new Error(`no published port in "${output.trim()}"`);
  return Number(match[1]);
}

export function serviceEnv(ports: Ports): Record<string, string> {
  return {
    DATABASE_URL: `postgresql://motorfix:motorfix@127.0.0.1:${ports.postgres}/motorfix`,
    REDIS_URL: `redis://127.0.0.1:${ports.redis}`,
  };
}

export function shellExports(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `export ${key}='${value.replaceAll("'", `'\\''`)}'`)
    .join('\n');
}

export function noDockerMessage(project: string): string {
  return [
    'pre-commit: the affected projects have integration specs, which need PostgreSQL and Redis, and Docker is not running.',
    'Start Docker and commit again. The hook then runs, for this worktree (also the way to run those specs by hand):',
    `  POSTGRES_PORT=0 REDIS_PORT=0 docker compose -p ${project} up -d --wait postgres redis`,
    `  export DATABASE_URL=postgresql://motorfix:motorfix@127.0.0.1:$(docker compose -p ${project} port postgres 5432 | sed 's/.*://')/motorfix`,
    `  export REDIS_URL=redis://127.0.0.1:$(docker compose -p ${project} port redis 6379 | sed 's/.*://')`,
    '  npx prisma migrate deploy --config libs/domain/prisma.config.ts',
    'Do not commit with JEST_SUITE set: the hook refuses it.',
  ].join('\n');
}

const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);

function run(command: string, args: string[], env = process.env): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function waitForPostgres(compose: string[]) {
  // The image restarts PostgreSQL once after its first initdb; a TCP answer
  // inside the container is the server that stays.
  for (let i = 0; i < waitSeconds; i++) {
    const ready = spawnSync('docker', [
      ...compose,
      'exec',
      '-T',
      'postgres',
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      'motorfix',
    ]);
    if (ready.status === 0) return;
    spawnSync('sleep', ['1']);
  }
  throw new Error(
    `PostgreSQL did not accept connections within ${waitSeconds} s`,
  );
}

function localMigrations(): Migration[] {
  return readdirSync(migrations)
    .filter((dir) => existsSync(join(migrations, dir, 'migration.sql')))
    .map((dir) => ({
      // Prisma's checksum: SHA-256 of migration.sql.
      checksum: createHash('sha256')
        .update(readFileSync(join(migrations, dir, 'migration.sql')))
        .digest('hex'),
      name: dir,
    }));
}

function appliedMigrations(compose: string[]): Migration[] {
  const psql = (sql: string) =>
    run('docker', [
      ...compose,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'motorfix',
      '-tAF',
      ' ',
      '-c',
      sql,
    ]).trim();
  if (psql("select to_regclass('public._prisma_migrations') is null") === 't')
    return [];
  // A migration that started and never finished counts as other SQL, so the
  // database is recreated rather than left for deploy to refuse.
  return psql(
    "select migration_name, case when finished_at is null then '' else checksum end from _prisma_migrations where rolled_back_at is null",
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, checksum = ''] = line.split(' ');
      return { checksum, name };
    });
}

function main() {
  const base = process.argv[2];
  if (!base) throw new Error(usage);
  const projects = git('ls-files', '*project.json').map((file) => ({
    name: projectName(file, JSON.parse(readFileSync(file, 'utf8'))),
    root: dirname(file),
  }));
  // JSON.parse throws on anything else, so a changed Nx output stops the
  // commit instead of quietly deciding no services are needed.
  const affected: string[] = JSON.parse(
    run('npx', [
      'nx',
      'show',
      'projects',
      '--affected',
      `--base=${base}`,
      '--withTarget=test',
      '--json',
    ]),
  );
  if (
    !needsServices(
      affected,
      // New specs not yet added count too: nx affected runs them.
      git(
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '*.integration.spec.ts',
      ),
      projects,
    )
  )
    return;

  const project = composeProject(git('rev-parse', '--show-toplevel')[0]);
  if (!dockerUp()) {
    console.error(noDockerMessage(project));
    process.exit(1);
  }
  const compose = ['compose', '-p', project, '-f', 'docker-compose.yml'];
  const up = () => {
    run('docker', [...compose, 'up', '-d', '--wait', 'postgres', 'redis'], {
      ...process.env,
      POSTGRES_PORT: '0',
      REDIS_PORT: '0',
    });
    waitForPostgres(compose);
  };
  up();
  if (schemaDrift(appliedMigrations(compose), localMigrations())) {
    console.error(
      `pre-commit: ${project} holds another branch's schema; recreating it`,
    );
    run('docker', [...compose, 'down', '-v']);
    up();
  }
  const env = serviceEnv({
    postgres: parsePort(
      run('docker', [...compose, 'port', 'postgres', '5432']),
    ),
    redis: parsePort(run('docker', [...compose, 'port', 'redis', '6379'])),
  });
  try {
    run(
      'npx',
      [
        'prisma',
        'migrate',
        'deploy',
        '--config',
        'libs/domain/prisma.config.ts',
      ],
      { ...process.env, ...env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    );
  } catch (error) {
    throw new Error(
      `${(error as Error).message}; to start from an empty database: docker compose -p ${project} down -v`,
    );
  }
  console.error(`pre-commit: integration specs run against ${project}`);
  console.log(shellExports(env));
}

// Docker (and git, gh) get this long per call when stopping stacks, so a hung
// daemon never holds a merge or a watch pass.
const dockerTimeout = 60_000;

const tryRun = (command: string, args: string[]) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: dockerTimeout,
  });
  const error =
    result.error?.message ??
    (result.status === 0
      ? undefined
      : (result.stderr || result.stdout || '').trim().split('\n').at(-1) ||
        `${command} exited ${result.status}`);
  return { error, stdout: result.stdout ?? '' };
};

const dockerUp = () => !tryRun('docker', ['info']).error;

const stopStack = (project: string, volumes: boolean) =>
  tryRun('docker', [
    'compose',
    '-p',
    project,
    'down',
    ...(volumes ? ['-v'] : []),
  ]).error;

function down(worktree: string) {
  const project = composeProject(worktree);
  if (!dockerUp()) {
    console.error(`test-services: docker unavailable, ${project} not stopped`);
    console.log(
      JSON.stringify({ project, reason: 'docker unavailable', stopped: false }),
    );
    return;
  }
  const error = stopStack(project, false);
  if (error) console.error(`test-services: ${project} not stopped: ${error}`);
  console.log(
    JSON.stringify(
      error
        ? { project, reason: error, stopped: false }
        : { project, stopped: true },
    ),
  );
}

// Output a tool printed that is not the JSON asked for (an HTML error page,
// a changed format) reads as no answer, never as a crash.
function readJson<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

function sweepStops(): Stop[] | undefined {
  const listed = tryRun('docker', [
    'compose',
    'ls',
    '--all',
    '--format',
    'json',
  ]);
  if (listed.error) {
    console.error(`test-services: cannot list stacks: ${listed.error}`);
    return undefined;
  }
  const parsed = readJson(() => parseStacks(listed.stdout));
  if (!parsed) {
    console.error('test-services: cannot read the stack list, no stack swept');
    return undefined;
  }
  const stacks = parsed.map((stack) => ({
    ...stack,
    exists: existsSync(stack.dir),
  }));
  const worktrees = tryRun('git', ['worktree', 'list', '--porcelain']);
  const prList = tryRun('gh', [
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    '1000',
    '--json',
    'headRefName,state,number',
  ]);
  const prJson = prList.error
    ? null
    : readJson(() => JSON.parse(prList.stdout) as unknown);
  const prs = Array.isArray(prJson) ? (prJson as Pr[]) : null;
  if (!prs)
    console.error(
      `test-services: no PR list, only gone worktrees swept: ${prList.error ?? 'unreadable output'}`,
    );
  return sweepPlan(
    stacks,
    worktrees.error ? [] : parseWorktrees(worktrees.stdout),
    prs,
  );
}

function sweep() {
  if (!dockerUp()) {
    // On stdout too: it is the line a /speckit-watch pass prints.
    console.error('test-services: docker unavailable, nothing swept');
    console.log('test-services: docker unavailable, nothing swept');
    return;
  }
  const stops = sweepStops();
  if (!stops) return;
  const stopped: string[] = [];
  const failed: string[] = [];
  for (const stop of stops) {
    const error = stopStack(stop.project, stop.volumes);
    if (error) {
      console.error(`test-services: ${stop.project} not stopped: ${error}`);
      failed.push(`${stop.project} (${error})`);
    } else stopped.push(`${stop.project} (${stop.reason})`);
  }
  const parts = [
    stopped.length ? `stopped ${stopped.join(', ')}` : '',
    failed.length ? `not stopped ${failed.join(', ')}` : '',
  ].filter(Boolean);
  console.log(`test-services: ${parts.join('; ') || 'nothing to stop'}`);
}

// Outside a checkout, the folder it runs in.
function currentCheckout(): string {
  try {
    return git('rev-parse', '--show-toplevel')[0];
  } catch {
    return process.cwd();
  }
}

const usage = [
  'Usage: node scripts/test-services.ts <base-ref>',
  '       node scripts/test-services.ts down [<worktree>]',
  '       node scripts/test-services.ts sweep',
].join('\n');

if (process.argv[1]?.endsWith('test-services.ts')) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'down' || command === 'sweep') {
    if (rest.length > (command === 'down' ? 1 : 0)) {
      console.error(usage);
      process.exit(2);
    }
    if (command === 'sweep') sweep();
    else down(resolve(rest[0] ?? currentCheckout()));
    process.exit(0);
  }
  // Anything else is the base ref, alone: a word that names no commit is an
  // unknown subcommand, not a ref to diff against.
  const isCommit =
    command !== undefined &&
    spawnSync(
      'git',
      ['rev-parse', '--verify', '--quiet', `${command}^{commit}`],
      {
        stdio: 'ignore',
      },
    ).status === 0;
  if (!isCommit || rest.length > 0) {
    console.error(usage);
    process.exit(2);
  }
  try {
    main();
  } catch (error) {
    console.error(`pre-commit: ${(error as Error).message}`);
    process.exit(1);
  }
}
