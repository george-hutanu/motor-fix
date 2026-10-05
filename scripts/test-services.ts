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
// `docker compose -p <project> down -v` removes them.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

type Project = { name: string; root: string };
type Ports = { postgres: number; redis: number };

export function composeProject(worktree: string): string {
  const slug = basename(worktree)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  const hash = createHash('sha1').update(worktree).digest('hex').slice(0, 6);
  return `mf-test-${slug}-${hash}`;
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
  for (let i = 0; i < 60; i++) {
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
  throw new Error('PostgreSQL did not accept connections within 60 s');
}

function main() {
  const base = process.argv[2];
  if (!base) throw new Error('Usage: node scripts/test-services.ts <base-ref>');
  const projects = git('ls-files', '*project.json').map((file) => ({
    name: JSON.parse(readFileSync(file, 'utf8')).name as string,
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
    !needsServices(affected, git('ls-files', '*.integration.spec.ts'), projects)
  )
    return;

  const project = composeProject(git('rev-parse', '--show-toplevel')[0]);
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    console.error(noDockerMessage(project));
    process.exit(1);
  }
  const compose = ['compose', '-p', project, '-f', 'docker-compose.yml'];
  run('docker', [...compose, 'up', '-d', '--wait', 'postgres', 'redis'], {
    ...process.env,
    POSTGRES_PORT: '0',
    REDIS_PORT: '0',
  });
  waitForPostgres(compose);
  const env = serviceEnv({
    postgres: parsePort(
      run('docker', [...compose, 'port', 'postgres', '5432']),
    ),
    redis: parsePort(run('docker', [...compose, 'port', 'redis', '6379'])),
  });
  run(
    'npx',
    ['prisma', 'migrate', 'deploy', '--config', 'libs/domain/prisma.config.ts'],
    { ...process.env, ...env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  );
  console.error(`pre-commit: integration specs run against ${project}`);
  console.log(shellExports(env));
}

if (process.argv[1]?.endsWith('test-services.ts')) {
  try {
    main();
  } catch (error) {
    console.error(`pre-commit: ${(error as Error).message}`);
    process.exit(1);
  }
}
