// Decides which of ci.yml's path-filtered jobs and steps a pull request
// needs, so a change to the app's source does not pay for the Docker build,
// the compose stack or the harness specs.
//
//   node scripts/ci-paths.ts <base-ref>
//
// Compares HEAD with its merge base on <base-ref> and writes
// `docker=`, `compose=` and `harness=` (true|false) to $GITHUB_OUTPUT.
// Renames count as both paths, as in docs-only.ts. A change to ci.yml itself
// runs all three, so a workflow edit is proved by the run that carries it.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const WORKFLOW = '.github/workflows/ci.yml';

type Rule = (path: string) => boolean;

const under =
  (...prefixes: string[]): Rule =>
  (path) =>
    prefixes.some((prefix) => path.startsWith(prefix));
const exactly =
  (...names: string[]): Rule =>
  (path) =>
    names.includes(path);
const matching =
  (pattern: RegExp): Rule =>
  (path) =>
    pattern.test(path);

// The images' inputs: the Dockerfiles and what they install and build with.
// The app's source is left out: the Checks job's Build step compiles it.
const DOCKER: Rule[] = [
  matching(/(^|\/)Dockerfile$/),
  exactly(
    '.dockerignore',
    '.nvmrc',
    'package.json',
    'package-lock.json',
    'nx.json',
    'tsconfig.base.json',
    'libs/domain/prisma.config.ts',
    WORKFLOW,
  ),
  under('docker/', 'infra/keycloak/'),
  matching(/^apps\/[^/]+\/(project\.json|tsconfig[^/]*\.json)$/),
];

// The local stack the PR tester boots (docker-compose.yml) and what it mounts.
const COMPOSE: Rule[] = [
  matching(/^docker-compose[^/]*\.ya?ml$/),
  under('infra/'),
  exactly(WORKFLOW),
];

// The harness specs (npm run test:harness) and the gates they prove. The
// lockfile is in: a Vitest or Playwright bump can break them.
const HARNESS: Rule[] = [
  under('.claude/', '.specify/', '.husky/', '.github/', 'scripts/'),
  exactly('package.json', 'package-lock.json'),
];

export type Filters = { compose: boolean; docker: boolean; harness: boolean };

export function classify(paths: string[]): Filters {
  const changed = paths.map((path) => path.trim()).filter(Boolean);
  const any = (rules: Rule[]) =>
    changed.some((path) => rules.some((rule) => rule(path)));
  return { compose: any(COMPOSE), docker: any(DOCKER), harness: any(HARNESS) };
}

function main() {
  const base = process.argv[2];
  if (!base) throw new Error('Usage: node scripts/ci-paths.ts <base-ref>');
  const changed = execFileSync(
    'git',
    [
      '-c',
      'core.quotePath=off',
      'diff',
      '--name-only',
      '--no-renames',
      `${base}...HEAD`,
    ],
    { encoding: 'utf8' },
  ).split('\n');
  const filters = classify(changed);
  const lines = Object.entries(filters)
    .map(([name, value]) => `${name}=${value}\n`)
    .join('');
  process.stdout.write(lines);
  if (process.env['GITHUB_OUTPUT']) {
    appendFileSync(process.env['GITHUB_OUTPUT'], lines);
  }
}

if (process.argv[1]?.endsWith('ci-paths.ts')) main();
