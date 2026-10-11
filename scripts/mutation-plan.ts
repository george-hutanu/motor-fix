// Plans the Mutation workflow's matrix: one job per Nx project with a
// `test:mutation` target, or one per shard of a project that
// scripts/mutation-shards.json splits, plus that project's automatic `rest`.
//
//   PROJECTS=domain,media SHARDS=domain:auth-core node scripts/mutation-plan.ts
//
// Prints the jobs and writes `matrix=<json>` to $GITHUB_OUTPUT. Plain node,
// no npm ci: it reads only the repository's files. Exits 1 naming whatever
// the shard file or the filters get wrong.

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SHARD_FILE = 'scripts/mutation-shards.json';
export const REST = 'rest';

type Timed = { measured?: unknown; timeout?: unknown };
type ShardEntry = Timed & { folders: string[] };
type ProjectEntry = Timed & { shards?: Record<string, ShardEntry> };
export type ShardFile = {
  default: Timed;
  projects: Record<string, ProjectEntry>;
};
export type Entry = {
  id: string;
  project: string;
  root: string;
  shard: string;
  timeout: number;
};
export type Scope = {
  mutate: string[];
  testMatch: string[];
  testPathIgnorePatterns: string[];
};

const DEFAULT: Timed = {
  measured: 'no shard file: the default figure',
  timeout: 60,
};

/** The files a project's mutation run never mutates, as globs under src. */
export function excluded(root: string): string[] {
  return [
    `!${root}/src/**/*.spec.ts`,
    `!${root}/src/**/*.test.ts`,
    `!${root}/src/**/generated/**`,
    `!${root}/src/**/test-setup.ts`,
  ];
}

export function readShardFile(repo: string): ShardFile {
  const file = join(repo, SHARD_FILE);
  if (!existsSync(file)) return { default: DEFAULT, projects: {} };
  const own = JSON.parse(readFileSync(file, 'utf8')) as Partial<ShardFile>;
  return { default: own.default ?? DEFAULT, projects: own.projects ?? {} };
}

export function mutationProjects(
  repo: string,
): { name: string; root: string }[] {
  const roots = ['apps', 'libs']
    .flatMap((dir) =>
      existsSync(join(repo, dir))
        ? readdirSync(join(repo, dir), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => `${dir}/${entry.name}`)
        : [],
    )
    .concat('scripts');
  return roots
    .flatMap((root) => {
      const file = join(repo, root, 'project.json');
      if (!existsSync(file)) return [];
      const own = JSON.parse(readFileSync(file, 'utf8'));
      return own.targets?.['test:mutation'] ? [{ name: own.name, root }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function walk(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      return entry.name === 'node_modules' || entry.name === 'generated'
        ? []
        : walk(join(dir, entry.name), path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** The project's mutated files, relative to its src. */
export function mutatedFiles(repo: string, root: string): string[] {
  const src = join(repo, root, 'src');
  if (!existsSync(src)) return [];
  return walk(src)
    .filter(
      (file) =>
        !/\.(spec|test)\.ts$/.test(file) && !/(^|\/)test-setup\.ts$/.test(file),
    )
    .sort();
}

// 'x' holds x and everything under it; 'x/*' only the files directly in x;
// '*' only the files directly in src.
const shallow = (folder: string) => folder === '*' || folder.endsWith('/*');
const base = (folder: string) =>
  folder === '*' ? '' : folder.replace(/\/\*$/, '');

function holds(folder: string, file: string): boolean {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  return shallow(folder) ? dir === base(folder) : file.startsWith(`${folder}/`);
}

/** Each mutated file of the project and the shard that holds it. */
export function assignFiles(
  repo: string,
  root: string,
  shards: Record<string, string[]>,
): Map<string, string> {
  const assigned = new Map<string, string>();
  for (const file of mutatedFiles(repo, root)) {
    const owners = Object.entries(shards)
      .filter(([, folders]) => folders.some((f) => holds(f, file)))
      .map(([name]) => name);
    if (owners.length > 1)
      throw new Error(
        `${root}/src/${file} is in more than one shard: ${owners.join(', ')}`,
      );
    assigned.set(file, owners[0] ?? REST);
  }
  return assigned;
}

const glob = (root: string, folder: string, tail: string) =>
  shallow(folder)
    ? `${root}/src/${base(folder) ? `${base(folder)}/` : ''}*${tail}`
    : `${root}/src/${folder}/**/*${tail}`;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function ignored(root: string, folder: string): string {
  const dir = literal(`/${root}/src/${base(folder) ? `${base(folder)}/` : ''}`);
  return shallow(folder) ? `${dir}[^/]+$` : dir;
}

/** What one shard mutates and which specs its Jest run collects. */
export function shardScope(
  root: string,
  shards: Record<string, string[]>,
  shard: string,
): Scope {
  if (shard === REST) {
    const all = Object.values(shards).flat();
    return {
      mutate: [
        `${root}/src/**/*.ts`,
        ...excluded(root),
        ...all.map((f) => `!${glob(root, f, '.ts')}`),
      ],
      testMatch: [`**/${root}/src/**/*.{spec,test}.ts`],
      testPathIgnorePatterns: [
        '/node_modules/',
        ...all.map((f) => ignored(root, f)),
      ],
    };
  }
  const folders = shards[shard];
  if (!folders) throw new Error(`${root} has no shard ${shard}`);
  return {
    mutate: [...folders.map((f) => glob(root, f, '.ts')), ...excluded(root)],
    testMatch: folders.map((f) => `**/${glob(root, f, '.{spec,test}.ts')}`),
    testPathIgnorePatterns: ['/node_modules/'],
  };
}

/** The named shards' folders of a project, or null for an unsharded one. */
export function shardsOf(
  file: ShardFile,
  project: string,
): Record<string, string[]> | null {
  const shards = file.projects[project]?.shards;
  if (!shards) return null;
  return Object.fromEntries(
    Object.entries(shards).map(([name, own]) => [name, own.folders]),
  );
}

function timeout(owner: string, own: Timed): number {
  const minutes = own.timeout;
  if (
    typeof minutes !== 'number' ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 360
  )
    throw new Error(
      `${SHARD_FILE}: ${owner} needs a timeout of 1 to 360 whole minutes`,
    );
  if (typeof own.measured !== 'string' || !own.measured.trim())
    throw new Error(
      `${SHARD_FILE}: ${owner} needs the measured run its timeout comes from`,
    );
  return minutes;
}

function validateShard(
  repo: string,
  root: string,
  owner: string,
  entry: ShardEntry,
): void {
  if (!Array.isArray(entry.folders) || entry.folders.length === 0)
    throw new Error(`${SHARD_FILE}: ${owner} lists no folders`);
  for (const folder of entry.folders)
    if (!existsSync(join(repo, root, 'src', base(folder))))
      throw new Error(
        `${SHARD_FILE}: ${owner} names ${folder}, which is not a folder under ${root}/src`,
      );
  timeout(owner, entry);
}

function validateProject(
  repo: string,
  file: ShardFile,
  name: string,
  root: string | undefined,
): void {
  if (!root)
    throw new Error(
      `${SHARD_FILE} lists ${name}, which has no test:mutation target`,
    );
  const own = file.projects[name] ?? {};
  timeout(name, own);
  for (const [shard, entry] of Object.entries(own.shards ?? {})) {
    if (shard === REST)
      throw new Error(
        `${SHARD_FILE}: ${name} names a shard rest, which is automatic`,
      );
    validateShard(repo, root, `${name}:${shard}`, entry);
  }
  const shards = shardsOf(file, name);
  if (shards) assignFiles(repo, root, shards);
}

function validate(
  repo: string,
  file: ShardFile,
  roots: Map<string, string>,
): void {
  timeout('default', file.default);
  for (const name of Object.keys(file.projects))
    validateProject(repo, file, name, roots.get(name));
}

const list = (text: string | undefined) =>
  (text ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

function isShard(file: ShardFile, item: string): boolean {
  const [project = '', shard = '', ...extra] = item.split(':');
  const shards = shardsOf(file, project);
  return (
    extra.length === 0 && shards !== null && (shard === REST || shard in shards)
  );
}

/** The shards named in the filter, by project. */
function wantedShards(
  file: ShardFile,
  items: string[],
  named: string[],
): Map<string, Set<string>> {
  const wanted = new Map<string, Set<string>>();
  for (const item of items) {
    if (!isShard(file, item))
      throw new Error(`no shard ${item} (project:shard, from ${SHARD_FILE})`);
    const [project = '', shard = ''] = item.split(':');
    if (named.length && !named.includes(project))
      throw new Error(`shard ${item} is outside the projects ${named}`);
    wanted.set(project, (wanted.get(project) ?? new Set()).add(shard));
  }
  return wanted;
}

function entriesOf(file: ShardFile, name: string, root: string): Entry[] {
  const own = file.projects[name];
  const minutes = own ? timeout(name, own) : timeout('default', file.default);
  const entry = (shard: string, id: string, timeout: number) => ({
    id,
    project: name,
    root,
    shard,
    timeout,
  });
  if (!own?.shards) return [entry('', name, minutes)];
  return [
    ...Object.entries(own.shards).map(([shard, value]) =>
      entry(shard, `${name}-${shard}`, timeout(`${name}:${shard}`, value)),
    ),
    entry(REST, `${name}-${REST}`, minutes),
  ];
}

/** The matrix, longest jobs first, so max-parallel starts them first. */
export function plan(
  repo: string,
  filters: { projects?: string; shards?: string },
): Entry[] {
  const file = readShardFile(repo);
  const all = mutationProjects(repo);
  const roots = new Map(all.map((p) => [p.name, p.root] as const));
  validate(repo, file, roots);

  const named = list(filters.projects);
  for (const name of named)
    if (!roots.has(name))
      throw new Error(`no project ${name} with a test:mutation target`);
  const wanted = wantedShards(file, list(filters.shards), named);
  const picked = (name: string) =>
    named.length ? named.includes(name) : !wanted.size || wanted.has(name);

  return all
    .filter((p) => picked(p.name))
    .flatMap(({ name, root }) =>
      entriesOf(file, name, root).filter(
        (e) => wanted.get(name)?.has(e.shard) ?? true,
      ),
    )
    .sort((a, b) => b.timeout - a.timeout || a.id.localeCompare(b.id));
}

function main() {
  const entries = plan(process.cwd(), {
    projects: process.env['PROJECTS'],
    shards: process.env['SHARDS'],
  });
  for (const e of entries)
    console.log(
      `${e.id}: ${e.root}${e.shard ? ` shard ${e.shard}` : ''}, ${e.timeout} min`,
    );
  const output = process.env['GITHUB_OUTPUT'];
  if (output)
    appendFileSync(output, `matrix=${JSON.stringify({ include: entries })}\n`);
}

if (process.argv[1]?.endsWith('mutation-plan.ts')) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
