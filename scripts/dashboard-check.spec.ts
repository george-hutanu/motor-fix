import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkDashboards,
  DASHBOARDS,
  PRODUCT_COUNTERS,
} from './dashboard-check.ts';

type Json = Record<string, unknown>;

const prom = { type: 'prometheus', uid: '${prom}' };
const ENV = 'deployment_environment="$env"';

const LINKS = [
  { title: 'Logs', url: '/explore?loki={service_name="api", env="$env"}' },
  { title: 'Traces', url: '/explore?tempo=api&env=$env' },
];

const panel = (title: string, expr: string, extra: Json = {}): Json => ({
  datasource: prom,
  targets: [{ datasource: prom, expr, refId: 'A' }],
  title,
  type: 'timeseries',
  ...extra,
});

function dashboard(uid: string, panels: Json[] = []): Json {
  return {
    annotations: {
      list: [
        {
          datasource: { type: 'grafana', uid: '-- Grafana --' },
          enable: true,
          name: 'Deploys',
          target: { tags: ['deploy', 'env:$env'], type: 'tags' },
        },
      ],
    },
    id: null,
    panels: panels.length
      ? panels
      : [panel('Requests', `sum(rate(http_requests_total{${ENV}}[5m]))`)],
    schemaVersion: 41,
    tags: ['motorfix'],
    templating: {
      list: [
        { name: 'prom', query: 'prometheus', type: 'datasource' },
        { name: 'loki', query: 'loki', type: 'datasource' },
        {
          datasource: prom,
          name: 'env',
          query: 'label_values(up, deployment_environment)',
          type: 'query',
        },
      ],
    },
    title: `MotorFix — ${uid}`,
    uid,
  };
}

const overview = () =>
  dashboard('motorfix-overview', [
    ...['api', 'worker', 'web', 'mcp', 'postgres', 'redis'].map((s) => ({
      title: s,
      type: 'row',
    })),
    panel('Error %', `sum(rate(x{${ENV}}[5m]))`, { links: LINKS }),
  ]);

const product = () =>
  dashboard(
    'motorfix-product',
    PRODUCT_COUNTERS.flatMap((counter) =>
      ['1h', '1d'].map((window) =>
        panel(
          `${counter} ${window}`,
          `sum(increase(${counter}{${ENV}}[${window}]))`,
        ),
      ),
    ),
  );

let root: string;

function put(file: string, content: Json | string) {
  writeFileSync(
    join(root, DASHBOARDS, file),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

function inventory(uids: string[]) {
  writeFileSync(
    join(root, 'infra/observability/inventory.json'),
    JSON.stringify({ entries: uids.map((dashboard) => ({ dashboard })) }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dashboard-check-'));
  mkdirSync(join(root, DASHBOARDS), { recursive: true });
  inventory(['motorfix-api', 'motorfix-overview', 'motorfix-product']);
});

afterEach(() => rmSync(root, { force: true, recursive: true }));

// @traces 879-FR-015 879-FR-002 879-FR-003 879-FR-004
describe('the dashboard check', () => {
  it('passes valid dashboards', () => {
    put('motorfix-overview.json', overview());
    put('motorfix-product.json', product());

    expect(checkDashboards(root)).toEqual([]);
  });

  it('fails a folder that is missing or empty', () => {
    expect(checkDashboards(root)).toEqual([`${DASHBOARDS}: no dashboard`]);
    rmSync(join(root, DASHBOARDS), { recursive: true });
    expect(checkDashboards(root)).toEqual([`${DASHBOARDS}: missing`]);
  });

  it('names a file that is not JSON', () => {
    put('motorfix-api.json', '{ "uid": ');

    expect(checkDashboards(root)).toEqual([
      expect.stringMatching(/^motorfix-api\.json: json: /),
    ]);
  });

  it.each([
    ['uid', { uid: undefined }, 'uid: missing'],
    ['uid', { uid: 'motorfix-other' }, 'uid: "motorfix-other" is not'],
    ['title', { title: '' }, 'title: missing'],
    ['id', { id: 7 }, 'id: must be null'],
  ])('fails on %s', (_rule, change, problem) => {
    put('motorfix-api.json', { ...dashboard('motorfix-api'), ...change });

    expect(checkDashboards(root).join('\n')).toContain(
      `motorfix-api.json: ${problem}`,
    );
  });

  it.each([
    ['a display name', 'Grafana Cloud Prometheus'],
    ['an object without a uid', { type: 'prometheus' }],
    [
      'a uid that is no variable',
      { type: 'prometheus', uid: 'grafanacloud-prom' },
    ],
    ['a database', { type: 'grafana-postgresql-datasource', uid: '${prom}' }],
  ])('fails a datasource given as %s', (_case, datasource) => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        panel('Requests', `up{${ENV}}`, { datasource }),
      ]),
    );

    expect(checkDashboards(root)).toEqual([
      expect.stringMatching(/^motorfix-api\.json: datasource: /),
    ]);
  });

  it.each([
    ['a query', panel('Requests', `up{deployment_environment="production"}`)],
    ['a title', panel('Staging requests', `up{${ENV}}`)],
    [
      'a link',
      panel('Requests', `up{${ENV}}`, {
        links: [{ title: 'Logs', url: '/explore?env=staging' }],
      }),
    ],
  ])('fails an environment written into %s', (_case, written) => {
    put('motorfix-api.json', dashboard('motorfix-api', [written]));

    expect(checkDashboards(root).join('\n')).toContain(
      'motorfix-api.json: env-literal: ',
    );
  });

  it('fails without an env variable', () => {
    const file = dashboard('motorfix-api');
    (file['templating'] as { list: Json[] }).list.pop();
    put('motorfix-api.json', file);

    expect(checkDashboards(root)).toContain(
      'motorfix-api.json: env-variable: no templating variable named env',
    );
  });

  it('fails a panel that does not filter by env', () => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [panel('Requests', 'sum(up)')]),
    );

    expect(checkDashboards(root)).toEqual([
      'motorfix-api.json: env-filter: panel "Requests" queries without $env',
    ]);
  });

  it('leaves the stack-wide usage panels unfiltered', () => {
    const usage = { type: 'prometheus', uid: '${usage}' };
    const file = dashboard('motorfix-api', [
      panel('Active series', 'max(grafanacloud_instance_active_series)', {
        datasource: usage,
        targets: [{ datasource: usage, expr: 'max(x)', refId: 'A' }],
      }),
    ]);
    (file['templating'] as { list: Json[] }).list.push({
      name: 'usage',
      query: 'prometheus',
      type: 'datasource',
    });
    put('motorfix-api.json', file);

    expect(checkDashboards(root)).toEqual([]);
  });

  it('fails without the deploy annotation', () => {
    put('motorfix-api.json', {
      ...dashboard('motorfix-api'),
      annotations: { list: [] },
    });

    expect(checkDashboards(root)).toEqual([
      'motorfix-api.json: deploy-annotation: no deploy, env:$env query',
    ]);
  });

  it('fails a uid no inventory entry lists', () => {
    put('motorfix-redis.json', dashboard('motorfix-redis'));

    expect(checkDashboards(root)).toEqual([
      'motorfix-redis.json: inventory: no entry in infra/observability/inventory.json lists motorfix-redis',
    ]);
  });

  it('fails an overview without a row for each service', () => {
    const file = overview();
    file['panels'] = (file['panels'] as Json[]).filter(
      (p) => p['title'] !== 'mcp' && p['title'] !== 'redis',
    );
    put('motorfix-overview.json', file);

    expect(checkDashboards(root)).toEqual([
      'motorfix-overview.json: overview-rows: no row titled for mcp',
      'motorfix-overview.json: overview-rows: no row titled for redis',
    ]);
  });

  it.each([
    ['no links', []],
    [
      'links without $env',
      LINKS.map((l) => ({ ...l, url: l.url.replace('$env', 'x') })),
    ],
    ['a logs link only', LINKS.slice(0, 1)],
  ])('fails an error panel with %s to logs and traces', (_case, links) => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        panel('Errors', `sum(rate(x{${ENV}}[5m]))`, { links }),
      ]),
    );

    expect(checkDashboards(root)).toEqual([
      'motorfix-api.json: error-links: panel "Errors" has no logs and traces links carrying $env',
    ]);
  });

  it('takes the links from the field defaults too', () => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        panel('Errors', `sum(rate(x{${ENV}}[5m]))`, {
          fieldConfig: { defaults: { links: LINKS } },
        }),
      ]),
    );

    expect(checkDashboards(root)).toEqual([]);
  });

  it('fails a product dashboard missing a counter per hour or per day', () => {
    const file = product();
    file['panels'] = (file['panels'] as Json[]).filter(
      (p) => p['title'] !== 'motorfix_quotes_total 1d',
    );
    put('motorfix-product.json', file);

    expect(checkDashboards(root)).toEqual([
      'motorfix-product.json: product-counters: no increase(motorfix_quotes_total[1d]) panel',
    ]);
  });

  it('passes on this repository', () => {
    expect(checkDashboards(join(__dirname, '..'))).toEqual([]);
  });
});
