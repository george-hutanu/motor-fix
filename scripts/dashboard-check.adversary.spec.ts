import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkDashboards,
  DASHBOARDS,
  PRODUCT_COUNTERS,
} from './dashboard-check.ts';

type Json = Record<string, unknown>;

const prom = { type: 'prometheus', uid: `\${prom}` };
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

function dashboard(uid: string, panels?: Json[]): Json {
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
    panels: panels ?? [panel('Requests', `sum(rate(x{${ENV}}[5m]))`)],
    schemaVersion: 41,
    tags: ['motorfix'],
    templating: {
      list: [
        { name: 'prom', query: 'prometheus', type: 'datasource' },
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

const SERVICES = ['api', 'worker', 'web', 'mcp', 'postgres', 'redis'];
const overviewWith = (rows: Json[]) =>
  dashboard('motorfix-overview', [
    ...rows,
    panel('Error %', `sum(rate(x{${ENV}}[5m]))`, { links: LINKS }),
  ]);

let root: string;
let outside: string;

function put(file: string, content: Json | string | Buffer | unknown[]) {
  writeFileSync(
    join(root, DASHBOARDS, file),
    typeof content === 'string' || Buffer.isBuffer(content)
      ? content
      : JSON.stringify(content),
  );
}

function inventory(uids: string[]) {
  writeFileSync(
    join(root, 'infra/observability/inventory.json'),
    JSON.stringify({ entries: uids.map((dashboard) => ({ dashboard })) }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dashboard-adv-'));
  outside = mkdtempSync(join(tmpdir(), 'dashboard-adv-out-'));
  mkdirSync(join(root, DASHBOARDS), { recursive: true });
  inventory(['motorfix-api', 'motorfix-overview', 'motorfix-product']);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
  rmSync(outside, { force: true, recursive: true });
});

const problems = () => checkDashboards(root);

// @traces 879-FR-015
describe('the dashboard check against hostile files', () => {
  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '7'],
    ['a string', '"x"'],
    ['an empty file', ''],
  ])('reports a file holding %s instead of throwing', (_n, text) => {
    put('motorfix-api.json', text);

    const found = problems();

    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => p.startsWith('motorfix-api.json: '))).toBe(true);
  });

  it('reports a file with a byte-order mark as a problem naming the file', () => {
    put(
      'motorfix-api.json',
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(JSON.stringify(dashboard('motorfix-api'))),
      ]),
    );

    expect(problems().every((p) => p.startsWith('motorfix-api.json: '))).toBe(
      true,
    );
  });

  it('reports a UTF-16 encoded file as invalid JSON', () => {
    put(
      'motorfix-api.json',
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(JSON.stringify(dashboard('motorfix-api')), 'utf16le'),
      ]),
    );

    expect(problems()).toEqual([
      expect.stringMatching(/^motorfix-api\.json: json: /),
    ]);
  });

  it('reports a Latin-1 file as a problem naming the file without throwing', () => {
    put(
      'motorfix-api.json',
      Buffer.from(
        JSON.stringify(dashboard('motorfix-api')).replace('API', 'Apî'),
        'latin1',
      ),
    );

    expect(() => problems()).not.toThrow();
  });

  it('reports a binary blob as invalid JSON', () => {
    put('motorfix-api.json', Buffer.from([0, 1, 2, 255, 254, 0, 9, 8]));

    expect(problems()).toEqual([
      expect.stringMatching(/^motorfix-api\.json: json: /),
    ]);
  });

  it('reports a directory named like a dashboard without throwing', () => {
    mkdirSync(join(root, DASHBOARDS, 'motorfix-api.json'));

    expect(() => problems()).not.toThrow();
    expect(problems().length).toBeGreaterThan(0);
  });

  it('ignores files that are not .json', () => {
    put('README.md', '# notes');
    put('motorfix-api.json', dashboard('motorfix-api'));

    expect(problems()).toEqual([]);
  });

  it('does not follow a symlink to a file outside the tree', () => {
    writeFileSync(
      join(outside, 'motorfix-api.json'),
      JSON.stringify(dashboard('motorfix-api')),
    );
    symlinkSync(
      join(outside, 'motorfix-api.json'),
      join(root, DASHBOARDS, 'motorfix-api.json'),
    );

    expect(problems().length).toBeGreaterThan(0);
  });

  it('checks a dashboard of ten thousand panels', () => {
    const panels = Array.from({ length: 10_000 }, (_v, i) =>
      panel(`P${i}`, `up{${ENV}}`),
    );
    put('motorfix-api.json', dashboard('motorfix-api', panels));

    expect(problems()).toEqual([]);
  });

  it('checks a dashboard of tens of megabytes without throwing', () => {
    const file = dashboard('motorfix-api');
    file['description'] = 'x'.repeat(30 * 1024 * 1024);
    put('motorfix-api.json', file);

    expect(problems()).toEqual([]);
  });

  it('gives the same answer twice and in the same order', () => {
    put('motorfix-api.json', {
      ...dashboard('motorfix-api'),
      id: 3,
      title: '',
    });
    put('motorfix-overview.json', overviewWith([]));

    const first = problems();

    expect(problems()).toEqual(first);
    expect(first.length).toBeGreaterThan(2);
  });

  it('reports a problem per file when several files are broken', () => {
    put('motorfix-api.json', '{');
    put('motorfix-product.json', '{');

    const files = problems().map((p) => p.split(':')[0]);

    expect(files).toEqual(
      expect.arrayContaining(['motorfix-api.json', 'motorfix-product.json']),
    );
  });
});

// @traces 879-FR-015 879-FR-003
describe('the dashboard check on datasources', () => {
  it('fails a variable reference no templating entry declares', () => {
    const ghost = { type: 'prometheus', uid: `\${ghost}` };
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        panel('Requests', `up{${ENV}}`, { datasource: ghost }),
      ]),
    );

    expect(problems().join('\n')).toContain('motorfix-api.json: datasource: ');
  });

  it('fails a reference to a variable that is not of type datasource', () => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        panel('Requests', `up{${ENV}}`, {
          datasource: { type: 'prometheus', uid: `\${env}` },
        }),
      ]),
    );

    expect(problems().join('\n')).toContain('motorfix-api.json: datasource: ');
  });

  it('fails a datasource written as a string on a target', () => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        panel('Requests', `up{${ENV}}`, {
          targets: [{ datasource: 'Prometheus', expr: `up{${ENV}}` }],
        }),
      ]),
    );

    expect(problems().join('\n')).toContain('motorfix-api.json: datasource: ');
  });

  it('fails a datasource display name inside a panel nested in a row', () => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        {
          collapsed: true,
          panels: [panel('Inner', `up{${ENV}}`, { datasource: 'Loki' })],
          title: 'api',
          type: 'row',
        },
      ]),
    );

    expect(problems().join('\n')).toContain('motorfix-api.json: datasource: ');
  });

  it('fails an annotation whose datasource is a display name', () => {
    const file = dashboard('motorfix-api');
    (file['annotations'] as { list: Json[] }).list.push({
      datasource: 'Prometheus',
      enable: true,
      name: 'Extra',
    });
    put('motorfix-api.json', file);

    expect(problems().join('\n')).toContain('motorfix-api.json: datasource: ');
  });

  it('fails a datasource uid that merely contains a variable reference', () => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        panel('Requests', `up{${ENV}}`, {
          datasource: { type: 'prometheus', uid: `grafanacloud-\${prom}` },
        }),
      ]),
    );

    expect(problems().join('\n')).toContain('motorfix-api.json: datasource: ');
  });
});

// @traces 879-FR-015 879-FR-002
describe('the dashboard check on environment names', () => {
  it.each([
    ['upper case Production', 'up{deployment_environment="Production"}'],
    ['upper case STAGING', 'up{deployment_environment="STAGING"}'],
    ['a regex match', 'up{deployment_environment=~"stag.*|staging"}'],
  ])('fails %s in a query', (_n, expr) => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [panel('R', `${expr} ${ENV}`)]),
    );

    expect(problems().join('\n')).toContain('motorfix-api.json: env-literal: ');
  });

  it('fails the name inside a panel nested in a row', () => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        {
          collapsed: true,
          panels: [panel('Inner', `up{${ENV}, x="production"}`)],
          title: 'api',
          type: 'row',
        },
      ]),
    );

    expect(problems().join('\n')).toContain('motorfix-api.json: env-literal: ');
  });

  it('fails the name in a templating variable query', () => {
    const file = dashboard('motorfix-api');
    (file['templating'] as { list: Json[] }).list.push({
      datasource: prom,
      name: 'other',
      query: 'label_values(up{deployment_environment="staging"}, job)',
      type: 'query',
    });
    put('motorfix-api.json', file);

    expect(problems().join('\n')).toContain('motorfix-api.json: env-literal: ');
  });

  it('fails the name in a target on a nested panel title link', () => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        panel('R', `up{${ENV}}`, {
          fieldConfig: {
            defaults: {
              links: [
                { title: 'x', url: '/d/motorfix-overview?var-env=production' },
              ],
            },
          },
        }),
      ]),
    );

    expect(problems().join('\n')).toContain('motorfix-api.json: env-literal: ');
  });

  it('does not flag env names inside a description', () => {
    put(
      'motorfix-api.json',
      dashboard('motorfix-api', [
        panel('R', `up{${ENV}}`, { description: 'unlike staging' }),
      ]),
    );

    expect(problems()).toEqual([]);
  });
});

// @traces 879-FR-015 879-FR-004
describe('the dashboard check on annotations and variables', () => {
  it.each([
    ['no annotations key', undefined],
    ['annotations that is null', null],
    ['a list that is not an array', { list: 'deploy' }],
    ['a list holding null', { list: [null] }],
  ])('fails %s with the deploy-annotation rule', (_n, annotations) => {
    const file = dashboard('motorfix-api');
    if (annotations === undefined) delete file['annotations'];
    else file['annotations'] = annotations;
    put('motorfix-api.json', file);

    expect(problems().join('\n')).toContain(
      'motorfix-api.json: deploy-annotation: ',
    );
  });

  it.each([
    ['only deploy', ['deploy']],
    ['only env:$env', ['env:$env']],
    ['a fixed environment', ['deploy', 'env:other']],
    ['an empty tag list', []],
  ])('fails an annotation tagged with %s', (_n, tags) => {
    put('motorfix-api.json', {
      ...dashboard('motorfix-api'),
      annotations: {
        list: [
          {
            datasource: { type: 'grafana', uid: '-- Grafana --' },
            target: { tags, type: 'tags' },
          },
        ],
      },
    });

    expect(problems().join('\n')).toContain(
      'motorfix-api.json: deploy-annotation: ',
    );
  });

  it('fails templating that is missing altogether', () => {
    const file = dashboard('motorfix-api');
    delete file['templating'];
    put('motorfix-api.json', file);

    expect(problems().join('\n')).toContain(
      'motorfix-api.json: env-variable: ',
    );
  });

  it('fails an env variable that only differs by case', () => {
    const file = dashboard('motorfix-api');
    const list = (file['templating'] as { list: Json[] }).list;
    list[1] = { ...list[1], name: 'Env' };
    put('motorfix-api.json', file);

    expect(problems().join('\n')).toContain(
      'motorfix-api.json: env-variable: ',
    );
  });
});

// @traces 879-FR-015 879-FR-001
describe('the dashboard check on identity', () => {
  it.each([
    ['a whitespace uid', ' '],
    ['a numeric uid', 7],
    ['a null uid', null],
  ])('fails %s', (_n, uid) => {
    put('motorfix-api.json', { ...dashboard('motorfix-api'), uid });

    expect(problems().join('\n')).toContain('motorfix-api.json: uid: ');
  });

  it.each([
    ['a number', 7],
    ['an object', {}],
    ['whitespace', '   '],
  ])('fails a title that is %s', (_n, title) => {
    put('motorfix-api.json', { ...dashboard('motorfix-api'), title });

    expect(problems().join('\n')).toContain('motorfix-api.json: title: ');
  });

  it('fails a title that does not start with MotorFix', () => {
    put('motorfix-api.json', { ...dashboard('motorfix-api'), title: 'API' });

    expect(problems().join('\n')).toContain('motorfix-api.json: title: ');
  });

  it('fails an id of 0 and an id given as the string null', () => {
    put('motorfix-api.json', { ...dashboard('motorfix-api'), id: 0 });
    put('motorfix-product.json', {
      ...dashboard('motorfix-product'),
      id: 'null',
    });

    const found = problems().join('\n');

    expect(found).toContain('motorfix-api.json: id: ');
    expect(found).toContain('motorfix-product.json: id: ');
  });

  it('fails a missing id', () => {
    const file = dashboard('motorfix-api');
    delete file['id'];
    put('motorfix-api.json', file);

    expect(problems().join('\n')).toContain('motorfix-api.json: id: ');
  });

  it('fails an inventory that is missing', () => {
    rmSync(join(root, 'infra/observability/inventory.json'));
    put('motorfix-api.json', dashboard('motorfix-api'));

    const found = problems();

    expect(() => problems()).not.toThrow();
    expect(found.length).toBeGreaterThan(0);
  });

  it.each([
    ['invalid JSON', '{'],
    ['an object without entries', '{}'],
    ['entries that is null', '{"entries":null}'],
    ['entries holding null', '{"entries":[null]}'],
  ])('reports an inventory holding %s without throwing', (_n, text) => {
    writeFileSync(join(root, 'infra/observability/inventory.json'), text);
    put('motorfix-api.json', dashboard('motorfix-api'));

    expect(() => problems()).not.toThrow();
    expect(problems().join('\n')).toContain('motorfix-api.json: inventory: ');
  });

  it('does not accept an inventory entry whose dashboard is a prefix of the uid', () => {
    inventory(['motorfix']);
    put('motorfix-api.json', dashboard('motorfix-api'));

    expect(problems().join('\n')).toContain('motorfix-api.json: inventory: ');
  });
});

// @traces 879-FR-015 879-FR-005
describe('the dashboard check on the overview rows', () => {
  it('passes rows nested in the row list at the top level', () => {
    put(
      'motorfix-overview.json',
      overviewWith(SERVICES.map((title) => ({ title, type: 'row' }))),
    );

    expect(problems()).toEqual([]);
  });

  it('fails a title that is not a row panel', () => {
    put(
      'motorfix-overview.json',
      overviewWith(SERVICES.map((title) => ({ title, type: 'stat' }))),
    );

    expect(problems().filter((p) => p.includes('overview-rows'))).toHaveLength(
      SERVICES.length,
    );
  });

  it('names every service when the overview has no panels', () => {
    put('motorfix-overview.json', {
      ...dashboard('motorfix-overview'),
      panels: [],
    });

    expect(problems().filter((p) => p.includes('overview-rows'))).toHaveLength(
      SERVICES.length,
    );
  });

  it('does not accept one row title standing for two services', () => {
    put(
      'motorfix-overview.json',
      overviewWith([
        { title: 'api worker web mcp postgres redis', type: 'row' },
      ]),
    );

    expect(problems().filter((p) => p.includes('overview-rows'))).toHaveLength(
      SERVICES.length,
    );
  });

  it('does not require service rows on other dashboards', () => {
    put('motorfix-api.json', dashboard('motorfix-api'));

    expect(problems()).toEqual([]);
  });

  it('accepts a service row in any letter case', () => {
    put(
      'motorfix-overview.json',
      overviewWith(
        SERVICES.map((s) => ({ title: s.toUpperCase(), type: 'row' })),
      ),
    );

    expect(problems().filter((p) => p.includes('overview-rows'))).toEqual([]);
  });

  it('fails a row whose title only contains a service as a substring', () => {
    put(
      'motorfix-overview.json',
      overviewWith(SERVICES.map((s) => ({ title: `${s}man`, type: 'row' }))),
    );

    expect(problems().filter((p) => p.includes('overview-rows'))).toHaveLength(
      SERVICES.length,
    );
  });
});

// @traces 879-FR-008 879-FR-015
describe('the product dashboard', () => {
  it('names every product counter, the job steps one included', () => {
    expect(PRODUCT_COUNTERS).toEqual([
      'motorfix_searches_total',
      'motorfix_sign_ins_total',
      'motorfix_garage_sign_ups_total',
      'motorfix_garage_approvals_total',
      'motorfix_garage_reports_total',
      'motorfix_quotes_total',
      'motorfix_emails_sent_total',
      'motorfix_notifications_sent_total',
      'motorfix_job_steps_total',
      'motorfix_request_received_total',
      'motorfix_documents_uploaded_total',
      'motorfix_declarations_signed_total',
      'motorfix_documents_opened_total',
      'motorfix_quote_received_total',
      'motorfix_account_changes_total',
    ]);
  });

  it.each(PRODUCT_COUNTERS)(
    'fails a product dashboard with no panel for %s',
    (counter) => {
      const panels = PRODUCT_COUNTERS.filter((c) => c !== counter).flatMap(
        (c) =>
          ['1h', '1d'].map((w) =>
            panel(`${c} ${w}`, `sum(increase(${c}{${ENV}}[${w}]))`),
          ),
      );
      put('motorfix-product.json', dashboard('motorfix-product', panels));

      expect(problems().join('\n')).toContain(counter);
    },
  );

  it('fails a product dashboard that shows a counter for one window only', () => {
    const panels = PRODUCT_COUNTERS.map((c) =>
      panel(c, `sum(increase(${c}{${ENV}}[1h]))`),
    );
    put('motorfix-product.json', dashboard('motorfix-product', panels));

    expect(problems().length).toBeGreaterThan(0);
  });

  it('fails a product panel that queries a database datasource', () => {
    const sql = { type: 'grafana-postgresql-datasource', uid: `\${prom}` };
    put(
      'motorfix-product.json',
      dashboard('motorfix-product', [
        panel('Users', 'select 1', { datasource: sql }),
      ]),
    );

    expect(problems().join('\n')).toContain(
      'motorfix-product.json: datasource: ',
    );
  });
});

// @traces 879-FR-001 879-FR-015
describe('the dashboards of this repository', () => {
  const repo = join(__dirname, '..');

  it('pass the check', () => {
    expect(checkDashboards(repo)).toEqual([]);
  });
});
