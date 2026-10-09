// Checks the Grafana dashboards under infra/observability/grafana/dashboards/
// before the release pushes them: each file parses, carries its uid (the
// file's name) and a title, reads its data sources through variables, never
// names an environment, filters every query by the `env` variable (the
// stack-wide usage panels aside), shows the
// deploy annotations and is listed in the inventory. The overview has a row
// per service, every error panel links to that service's logs and traces, and
// the product dashboard reads each product counter per hour and per day.
//
//   node scripts/dashboard-check.ts [--root <dir>]
//
// Prints `<file>: <rule> …` per problem and exits 1, or one ok line.

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export const DASHBOARDS = 'infra/observability/grafana/dashboards';
const INVENTORY = 'infra/observability/inventory.json';
const SERVICES = ['api', 'worker', 'web', 'mcp', 'postgres', 'redis'];
const LINKED = new Set([
  'motorfix-api',
  'motorfix-worker',
  'motorfix-web',
  'motorfix-mcp',
]);
export const PRODUCT_COUNTERS = [
  'motorfix_searches_total',
  'motorfix_sign_ins_total',
  'motorfix_garage_sign_ups_total',
  'motorfix_garage_approvals_total',
  'motorfix_quotes_total',
  'motorfix_emails_sent_total',
  'motorfix_notifications_sent_total',
  'motorfix_job_steps_total',
  'motorfix_request_received_total',
  'motorfix_documents_uploaded_total',
  'motorfix_declarations_signed_total',
  'motorfix_documents_opened_total',
];
const SIGNAL_SOURCES = new Set(['prometheus', 'loki', 'tempo', 'grafana']);
const GRAFANA = '-- Grafana --';
const USAGE = `\${usage}`;
const ENV_NAMES = /staging|production/i;
const QUERY_KEYS = new Set(['expr', 'query', 'title', 'url']);

type Json = Record<string, unknown>;
type Panel = Json & { panels?: Panel[]; targets?: Json[] };

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
// An array's objects only: a null or a number in a list is skipped, not read.
const list = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value.filter(isObject) as T[]) : [];
const text = (value: unknown) => (typeof value === 'string' ? value : '');

// Every panel, rows' collapsed children included.
function panelsOf(dashboard: Json): Panel[] {
  return list<Panel>(dashboard['panels']).flatMap((panel) => [
    panel,
    ...list<Panel>(panel.panels),
  ]);
}

function variables(dashboard: Json) {
  return list<Json>((dashboard['templating'] as Json | undefined)?.['list']);
}

function sourceProblems(source: unknown, sources: Set<string>): string[] {
  if (typeof source !== 'object' || source === null)
    return [`datasource ${JSON.stringify(source)} is not a uid object`];
  const uid = text((source as Json)['uid']);
  const type = text((source as Json)['type']);
  const problems: string[] = [];
  if (uid !== GRAFANA && !sources.has(uid))
    problems.push(`datasource uid "${uid}" is not a datasource variable`);
  if (type && !SIGNAL_SOURCES.has(type) && type !== 'datasource')
    problems.push(`datasource type "${type}" is not a signal store`);
  return problems;
}

function datasourceProblems(dashboard: Json): string[] {
  const sources = new Set(
    variables(dashboard)
      .filter((v) => v['type'] === 'datasource')
      .map((v) => `\${${text(v['name'])}}`),
  );
  const annotations = list<Json>(
    (dashboard['annotations'] as Json | undefined)?.['list'],
  );
  const holders: Json[] = [
    ...panelsOf(dashboard),
    ...panelsOf(dashboard).flatMap((panel) => list<Json>(panel.targets)),
    ...annotations,
    ...variables(dashboard).filter((v) => v['type'] !== 'datasource'),
  ];
  const problems = new Set(
    holders
      .filter((holder) => 'datasource' in holder)
      .flatMap((holder) => sourceProblems(holder['datasource'], sources)),
  );
  return [...problems].map((p) => `datasource: ${p}`);
}

// Every string under a key Grafana treats as a query, title or link.
function strings(value: unknown, keys: Set<string>): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => strings(v, keys));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, v]) =>
    keys.has(key) && typeof v === 'string' ? [v] : strings(v, keys),
  );
}

function expressions(panel: Panel) {
  return list<Json>(panel.targets)
    .map((target) => text(target['expr']) || text(target['query']))
    .filter(Boolean);
}

// Grafana Cloud's own usage figures cover the whole stack, not one
// environment, so their panels are the one place a query has no $env.
const stackWide = (panel: Panel) =>
  (panel['datasource'] as Json | undefined)?.['uid'] === USAGE;

function linksOf(panel: Panel) {
  const defaults = (panel['fieldConfig'] as Json | undefined)?.['defaults'] as
    | Json
    | undefined;
  return [...list<Json>(panel['links']), ...list<Json>(defaults?.['links'])]
    .map((link) => text(link['url']))
    .filter(Boolean);
}

function overviewProblems(dashboard: Json): string[] {
  const rows = list<Panel>(dashboard['panels'])
    .filter((panel) => panel['type'] === 'row')
    .map((panel) => text(panel['title']).toLowerCase());
  return SERVICES.filter(
    (service) =>
      !rows.some((title) => {
        // A row stands for one service: a title naming two counts for neither.
        const named = SERVICES.filter((s) => title.split(/\W+/).includes(s));
        return named.length === 1 && named[0] === service;
      }),
  ).map((service) => `overview-rows: no row titled for ${service}`);
}

function errorLinkProblems(dashboard: Json): string[] {
  return panelsOf(dashboard)
    .filter((panel) => /error/i.test(text(panel['title'])))
    .flatMap((panel) => {
      const links = linksOf(panel);
      const to = (store: string) =>
        links.some((url) => url.includes(store) && url.includes('$env'));
      return to('loki') && to('tempo')
        ? []
        : [
            `error-links: panel "${text(panel['title'])}" has no logs and traces links carrying $env`,
          ];
    });
}

function productProblems(dashboard: Json): string[] {
  const queries = panelsOf(dashboard).flatMap(expressions);
  return PRODUCT_COUNTERS.flatMap((counter) =>
    ['1h', '1d'].flatMap((window) =>
      queries.some(
        (q) => q.includes(`increase(${counter}{`) && q.includes(`[${window}]`),
      )
        ? []
        : [`product-counters: no increase(${counter}[${window}]) panel`],
    ),
  );
}

function identityProblems(dashboard: Json, file: string): string[] {
  const uid = text(dashboard['uid']);
  const problems: string[] = [];
  if (!uid) problems.push('uid: missing');
  else if (`${uid}.json` !== file)
    problems.push(`uid: "${uid}" is not the file's name`);
  const title = text(dashboard['title']).trim();
  if (!title) problems.push('title: missing');
  else if (!title.startsWith('MotorFix'))
    problems.push(`title: "${title}" does not start with MotorFix`);
  if (dashboard['id'] !== null) problems.push('id: must be null');
  return problems;
}

function envProblems(dashboard: Json): string[] {
  const literals = strings(dashboard, QUERY_KEYS)
    .filter((value) => ENV_NAMES.test(value))
    .map((value) => `env-literal: "${value}" names an environment`);
  const variable = variables(dashboard).some((v) => v['name'] === 'env')
    ? []
    : ['env-variable: no templating variable named env'];
  const unfiltered = panelsOf(dashboard)
    .filter((panel) => !stackWide(panel))
    .flatMap((panel) =>
      expressions(panel)
        .filter((expr) => !expr.includes('$env'))
        .map(
          () =>
            `env-filter: panel "${text(panel['title'])}" queries without $env`,
        ),
    );
  return [...literals, ...variable, ...unfiltered];
}

function deployProblems(dashboard: Json): string[] {
  const deploys = list<Json>(
    (dashboard['annotations'] as Json | undefined)?.['list'],
  ).some((annotation) => {
    const target = annotation['target'];
    const tags =
      isObject(target) && Array.isArray(target['tags']) ? target['tags'] : [];
    return tags.includes('deploy') && tags.includes('env:$env');
  });
  return deploys ? [] : ['deploy-annotation: no deploy, env:$env query'];
}

// The rules that hold for one dashboard only, by uid.
const OWN_RULES: Record<string, (dashboard: Json) => string[]> = {
  'motorfix-overview': (d) => [...overviewProblems(d), ...errorLinkProblems(d)],
  'motorfix-product': productProblems,
};

function fileProblems(dashboard: Json, file: string, listed: Set<string>) {
  const uid = text(dashboard['uid']);
  const inventory =
    uid && !listed.has(uid)
      ? [`inventory: no entry in ${INVENTORY} lists ${uid}`]
      : [];
  const own =
    OWN_RULES[uid] ?? (LINKED.has(uid) ? errorLinkProblems : () => []);
  return [
    ...identityProblems(dashboard, file),
    ...datasourceProblems(dashboard),
    ...envProblems(dashboard),
    ...deployProblems(dashboard),
    ...inventory,
    ...own(dashboard),
  ];
}

function listedUids(root: string) {
  try {
    const inventory = JSON.parse(readFileSync(join(root, INVENTORY), 'utf8'));
    return new Set(
      list<Json>(inventory.entries).map((entry) => text(entry['dashboard'])),
    );
  } catch {
    return new Set<string>();
  }
}

export function checkDashboards(root: string): string[] {
  const folder = join(root, DASHBOARDS);
  if (!existsSync(folder)) return [`${DASHBOARDS}: missing`];
  const listed = listedUids(root);
  const files = dashboardFiles(root);
  if (files.length === 0) return [`${DASHBOARDS}: no dashboard`];
  return files
    .sort()
    .flatMap((file) =>
      readProblems(join(folder, file), file, listed).map(
        (p) => `${file}: ${p}`,
      ),
    );
}

function readProblems(path: string, file: string, listed: Set<string>) {
  // The release pushes what the repository holds, never a link out of it.
  if (lstatSync(path).isSymbolicLink()) return ['file: a symbolic link'];
  let dashboard: unknown;
  try {
    dashboard = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return [`json: ${(error as Error).message}`];
  }
  if (!isObject(dashboard)) return ['json: not an object'];
  return fileProblems(dashboard, file, listed);
}

export const dashboardFiles = (root: string) =>
  readdirSync(join(root, DASHBOARDS)).filter((f) => f.endsWith('.json'));

function main() {
  const { values } = parseArgs({ options: { root: { type: 'string' } } });
  const root = values.root ?? process.cwd();
  const problems = checkDashboards(root);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
    return;
  }
  const count = dashboardFiles(root).length;
  console.log(`dashboard check: ${count} dashboards, ok`);
}

if (process.argv[1]?.endsWith('dashboard-check.ts')) main();
