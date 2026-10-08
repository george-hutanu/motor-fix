// Checks infra/observability/inventory.json against the code: every app,
// Railway service, queue and outside service the code holds has an entry, no
// entry outlives what it names, every dashboard and alert an entry points to is
// declared as Grafana JSON under infra/observability/, and the endpoint count
// matches apps/api/openapi.json. A new one fails CI until its PR lists it, with
// its dashboard and alerts or "none" and the reason.
//
// Queues, hosts and SDK clients are found by text, so only apps/ and libs/ are
// read, without the generated client, tests and stubs. PostgreSQL, Redis and
// product counters are listed by hand: such an entry is stale once its source
// path is gone.
//
//   node scripts/observability-inventory.ts [--root <dir>] [--write]
//
// --write rewrites the endpoint count from openapi.json.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

type Entry = Record<string, unknown>;
type Inventory = {
  endpoints?: { count?: unknown; source?: unknown };
  entries?: unknown;
};
type Grafana = {
  uid?: unknown;
  groups?: { rules?: { uid?: unknown }[] }[];
};
type Found = { kind: string; name: string; file: string; key: string };

const INVENTORY = 'infra/observability/inventory.json';
const OPENAPI = 'apps/api/openapi.json';
const RAILWAY = 'scripts/railway-deploy.ts';
const KINDS = [
  'app',
  'railway-service',
  'queue',
  'outside-service',
  'product-counter',
];
const REQUIRED = ['kind', 'name', 'source', 'dashboard', 'alerts', 'story'];
const METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);
const SDK_CLIENTS: Record<string, string> = {
  "from 'web-push'": 'web-push',
  'new S3Client(': 's3',
};
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.nx', 'coverage']);
const EXCLUDED = [
  /^libs\/data-access\//,
  /^libs\/domain\/src\/generated\//,
  /\.spec\.ts$/,
  /\.testing\.ts$/,
  /[^/]*(stub|test-store)[^/]*$/,
];
const PLACEHOLDER_TLD = /\.(example|test|invalid|localhost)$/;
const VALUE = String.raw`('[^']+'|"[^"]+"|[A-Za-z_$][\w$]*)`;
const QUEUE = new RegExp(
  String.raw`(?:new Queue|registerQueue)\(\s*${VALUE}|\bqueue:\s*${VALUE}`,
  'g',
);
const CONSTANT = /export const ([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g;
const HOST = /https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/g;

function files(root: string, dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(
    (item) => {
      const path = `${dir}/${item.name}`;
      if (item.isDirectory()) {
        return SKIPPED_DIRS.has(item.name) ? [] : files(root, path);
      }
      return path.endsWith('.ts') && !EXCLUDED.some((re) => re.test(path))
        ? [path]
        : [];
    },
  );
}

function readTexts(root: string): Map<string, string> {
  const sources = ['apps', 'libs'].flatMap((dir) => files(root, dir));
  return new Map(
    sources.map((file) => [file, readFileSync(join(root, file), 'utf8')]),
  );
}

function exportedConstants(texts: Map<string, string>): Map<string, string> {
  const constants = new Map<string, string>();
  for (const text of texts.values())
    for (const [, name, value] of text.matchAll(CONSTANT))
      constants.set(name, value);
  return constants;
}

function queueNames(text: string, constants: Map<string, string>): string[] {
  return [...text.matchAll(QUEUE)].flatMap((match) => {
    const value = match[1] ?? match[2];
    const name = /^['"]/.test(value)
      ? value.slice(1, -1)
      : constants.get(value);
    return name ? [name] : [];
  });
}

function outsideServices(text: string): [string, string][] {
  const hosts = [...text.matchAll(HOST)]
    .map((match) => match[1])
    .filter((host) => !PLACEHOLDER_TLD.test(host))
    .map((host): [string, string] => ['host', host]);
  const clients = Object.entries(SDK_CLIENTS)
    .filter(([needle]) => text.includes(needle))
    .map(([, client]): [string, string] => ['client', client]);
  return [...hosts, ...clients];
}

function railwayServices(root: string): string[] {
  const path = join(root, RAILWAY);
  const deploy = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const services = /services:\s*\[([^\]]*)\]/.exec(deploy)?.[1] ?? '';
  return [...services.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function discover(root: string): Found[] {
  const found: Found[] = [];
  const add = (kind: string, name: string, file: string, key = 'name') => {
    if (!found.some((f) => f.kind === kind && f.name === name && f.key === key))
      found.push({ file, key, kind, name });
  };
  for (const app of readdirSync(join(root, 'apps'), { withFileTypes: true }))
    if (app.isDirectory()) add('app', app.name, `apps/${app.name}`);
  for (const name of railwayServices(root))
    add('railway-service', name, RAILWAY);

  const texts = readTexts(root);
  const constants = exportedConstants(texts);
  for (const [file, text] of texts)
    for (const name of queueNames(text, constants)) add('queue', name, file);
  const outside = [...texts].flatMap(([file, text]) =>
    outsideServices(text).map(([key, name]) => ({ file, key, name })),
  );
  for (const key of ['host', 'client'])
    for (const item of outside.filter((o) => o.key === key))
      add('outside-service', item.name, item.file, key);
  return found;
}

function operations(root: string): number {
  const spec = JSON.parse(readFileSync(join(root, OPENAPI), 'utf8')) as {
    paths?: Record<string, Record<string, unknown>>;
  };
  return Object.values(spec.paths ?? {}).reduce(
    (count, item) =>
      count + Object.keys(item).filter((key) => METHODS.has(key)).length,
    0,
  );
}

function grafanaFiles(root: string, dir: string): Grafana[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(
    (item) => {
      const path = `${dir}/${item.name}`;
      if (item.isDirectory()) return grafanaFiles(root, path);
      if (!path.endsWith('.json') || path === INVENTORY) return [];
      try {
        return [JSON.parse(readFileSync(join(root, path), 'utf8'))];
      } catch {
        return [];
      }
    },
  );
}

function declaredUids(root: string) {
  const grafana = grafanaFiles(root, 'infra/observability');
  const strings = (values: unknown[]) =>
    new Set(values.filter((v): v is string => typeof v === 'string'));
  const list = <T>(value: T[] | undefined) =>
    Array.isArray(value) ? value : [];
  return {
    alerts: strings(
      grafana.flatMap((file) =>
        list(file.groups).flatMap((group) =>
          list(group.rules).map((rule) => rule.uid),
        ),
      ),
    ),
    dashboards: strings(grafana.map((file) => file.uid)),
  };
}

function readInventory(root: string): Inventory | null {
  try {
    return JSON.parse(readFileSync(join(root, INVENTORY), 'utf8'));
  } catch {
    return null;
  }
}

function matches(entry: Entry, found: Found) {
  return entry['kind'] === found.kind && entry[found.key] === found.name;
}

function label(entry: Entry) {
  return `${entry['kind']} ${entry['name']}`;
}

function shapeProblem(entry: Entry, index: number, seen: Set<string>) {
  const missing = REQUIRED.find((field) => entry?.[field] === undefined);
  if (missing) return `inventory: entries[${index}] has no "${missing}"`;
  if (!KINDS.includes(entry['kind'] as string))
    return `inventory: entries[${index}] has an unknown kind`;
  if (seen.has(label(entry)))
    return `inventory: ${label(entry)} is listed twice`;
  seen.add(label(entry));
  return null;
}

function isStale(root: string, entry: Entry, found: Found[]) {
  const discovered =
    ['app', 'railway-service', 'queue'].includes(entry['kind'] as string) ||
    entry['host'] !== undefined ||
    entry['client'] !== undefined;
  return discovered
    ? !found.some((item) => matches(entry, item))
    : !existsSync(join(root, entry['source'] as string));
}

function alertProblems(entry: Entry, declared: Set<string>): string[] {
  const { alerts } = entry;
  if (alerts === 'none') return [];
  if (!Array.isArray(alerts) || alerts.length === 0)
    return [`${label(entry)}: alerts must be "none" or a list of rule uids`];
  return alerts
    .filter((uid) => !declared.has(uid))
    .map((uid) => `${label(entry)}: alert ${uid} is not declared`);
}

function referenceProblems(
  entry: Entry,
  uids: ReturnType<typeof declaredUids>,
): string[] {
  const { alerts, dashboard, reason } = entry;
  const problems = alertProblems(entry, uids.alerts);
  if (dashboard !== 'none' && !uids.dashboards.has(dashboard as string))
    problems.unshift(`${label(entry)}: dashboard ${dashboard} is not declared`);
  const needsReason = dashboard === 'none' || alerts === 'none';
  if (needsReason && !(typeof reason === 'string' && reason.trim()))
    problems.push(`${label(entry)}: "none" needs a reason`);
  return problems;
}

export function checkInventory(root: string): string[] {
  const inventory = readInventory(root);
  if (!Array.isArray(inventory?.entries))
    return [`inventory: ${INVENTORY} is not valid JSON`];

  const seen = new Set<string>();
  const shape = inventory.entries.map((entry: Entry, index: number) =>
    shapeProblem(entry, index, seen),
  );
  const entries: Entry[] = inventory.entries.filter(
    (_: Entry, index: number) => shape[index] === null,
  );
  const found = discover(root);
  const count = operations(root);
  const uids = declaredUids(root);
  return [
    ...shape.filter((problem: string | null) => problem !== null),
    ...found
      .filter((item) => !entries.some((entry) => matches(entry, item)))
      .map((item) => `missing ${item.kind} ${item.name} (${item.file})`),
    ...entries
      .filter((entry) => isStale(root, entry, found))
      .map((entry) => `stale ${label(entry)}`),
    ...(inventory.endpoints?.count === count
      ? []
      : [
          `endpoints: inventory says ${inventory.endpoints?.count}, openapi.json has ${count} (run --write)`,
        ]),
    ...entries.flatMap((entry) => referenceProblems(entry, uids)),
  ];
}

export function writeEndpointCount(root: string) {
  const inventory = JSON.parse(readFileSync(join(root, INVENTORY), 'utf8'));
  inventory.endpoints = { ...inventory.endpoints, count: operations(root) };
  writeFileSync(
    join(root, INVENTORY),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
}

function main() {
  const { values } = parseArgs({
    options: { root: { type: 'string' }, write: { type: 'boolean' } },
  });
  const root = values.root ?? process.cwd();
  if (values.write) {
    writeEndpointCount(root);
    console.log(
      `observability inventory: endpoints set to ${operations(root)}`,
    );
    return;
  }
  const problems = checkInventory(root);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(
      `\nList it in ${INVENTORY} with its dashboard and alerts, or "none" and the reason.`,
    );
    process.exitCode = 1;
    return;
  }
  const inventory = readInventory(root) as { entries: unknown[] };
  console.log(
    `observability inventory: ${inventory.entries.length} entries, ${operations(root)} endpoints, ok`,
  );
}

if (process.argv[1]?.endsWith('observability-inventory.ts')) main();
