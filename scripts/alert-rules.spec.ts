import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { block, read, script } from './workflow-text.ts';

// The alert rules Grafana is given, read from the repository as the
// "Grafana alerts" workflow applies them, and that workflow's own script run
// against a stand-in curl.
const root = join(__dirname, '..');
const alertsDir = join(root, 'infra', 'observability', 'alerts');
const dashboardsDir = join(
  root,
  'infra',
  'observability',
  'grafana',
  'dashboards',
);
const alertingDir = join(root, 'infra', 'observability', 'grafana', 'alerting');

type Query = {
  refId: string;
  datasourceUid: string;
  relativeTimeRange: { from: number; to: number };
  model: {
    expr?: string;
    conditions?: { evaluator: { type: string; params: number[] } }[];
  };
};
type Rule = {
  uid: string;
  title: string;
  condition: string;
  for: string;
  noDataState: string;
  execErrState: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  notification_settings?: { receiver: string };
  data: Query[];
};
type Group = {
  orgId: number;
  name: string;
  folder: string;
  interval: string;
  rules: Rule[];
};
type AlertFile = { apiVersion: number; groups: Group[] };
type Files = Record<string, AlertFile>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function alertFiles(dir = alertsDir): Files {
  const files: Files = {};
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    files[name] = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  }
  return files;
}

const SERVICES = {
  api: { dashboard: 'motorfix-api', title: 'API' },
  postgres: { dashboard: 'motorfix-postgres', title: 'PostgreSQL' },
  redis: { dashboard: 'motorfix-redis', title: 'Redis' },
  web: { dashboard: 'motorfix-web', title: 'Web' },
  worker: { dashboard: 'motorfix-worker', title: 'Worker' },
} as const;
type Service = keyof typeof SERVICES;
const OWN = Object.keys(SERVICES).map((s) => `${s}.json`);

// The process's resident memory over its container's limit, per environment.
const memory = (service: string) =>
  `max by (deployment_environment) (process_memory_usage_bytes{service_name="${service}"} / on (deployment_environment, instance) motorfix_process_memory_limit_bytes{service_name="${service}"})`;
const MEMORY = (service: string) => ({
  expr: [memory(service)],
  for: '10m',
  from: 300,
  type: 'gt' as const,
  value: 0.85,
});

// The only rules that fire with no wait: each query's own window already
// holds it (an absence over 5 minutes, a rate or an increase over its window),
// or a single event is the alert.
const ZERO_WAIT = new Set([
  'api-down',
  'web-down',
  'worker-down',
  'mcp-down',
  'api-error-rate',
  'web-error-rate',
  'mcp-tool-errors',
  'worker-jobs-failed',
  'verification-result-failed',
  'profile-views-job-failed',
  'profile-views-lost',
  'mcp-auth-failures',
  'mcp-key-fetch-failures',
  'decline-window-sweep-late',
  'verification-rejection-burst',
  'verification-more-request-burst',
  'outage',
]);

// What each rule watches: its threshold, how long it pends, the window its
// query reads, and the fragments of PromQL that make it that signal.
const EXPECTED: Record<
  string,
  {
    type: 'gt' | 'lt';
    value: number;
    for: string;
    from: number;
    expr: string[];
  }
> = {
  'api-cache-fallback-rate': {
    expr: [
      'motorfix_cache_total{service_name="api", outcome="fallback"}[10m]',
      'motorfix_cache_total{service_name="api", outcome=~"hit|miss|stale|coalesced|negative|fallback"}[10m]',
      '>= 20',
    ],
    for: '10m',
    from: 600,
    type: 'gt',
    value: 0.05,
  },
  'api-down': {
    expr: [
      'target_info{service_name="api"}[24h]',
      'unless',
      'target_info{service_name="api"}[5m]',
    ],
    for: '0s',
    from: 86400,
    type: 'gt',
    value: 0,
  },
  'api-error-rate': {
    expr: [
      'http_server_request_duration_seconds_count{service_name="api", http_response_status_code=~"5.."}[10m]',
      'http_server_request_duration_seconds_count{service_name="api"}[10m]',
      '>= 20',
    ],
    for: '0s',
    from: 600,
    type: 'gt',
    value: 0.05,
  },
  'api-latency': {
    expr: [
      'histogram_quantile(0.95',
      'http_server_request_duration_seconds_bucket{service_name="api"}[10m]',
    ],
    for: '5m',
    from: 600,
    type: 'gt',
    value: 1.5,
  },
  'api-memory': MEMORY('api'),
  'api-prefetch-hit-rate': {
    expr: [
      'motorfix_cache_total{service_name="api", kind=~"driver-home|garage-home", outcome="hit"}[1h]',
      'motorfix_cache_total{service_name="api", kind=~"driver-home|garage-home", outcome="warm"}[1h]',
      '>= 50',
    ],
    for: '60m',
    from: 3600,
    type: 'lt',
    value: 0.3,
  },
  'api-search-cache-fallback-rate': {
    expr: [
      'motorfix_search_cache_total{service_name="api", outcome="fallback"}[10m]',
      'motorfix_search_cache_total{service_name="api"}[10m]',
      '>= 20',
    ],
    for: '10m',
    from: 600,
    type: 'gt',
    value: 0.05,
  },
  'api-search-latency': {
    expr: [
      'histogram_quantile(0.95, sum by (deployment_environment, le) (rate(http_server_request_duration_seconds_bucket{service_name="api", http_route="/api/v1/search/garages"}[5m])))',
    ],
    for: '10m',
    from: 300,
    type: 'gt',
    value: 0.3,
  },
  'api-search-log-failure-rate': {
    expr: [
      'motorfix_search_log_total{service_name="api", outcome="failed"}[10m]',
      'motorfix_search_log_total{service_name="api"}[10m]',
      '>= 20',
    ],
    for: '10m',
    from: 600,
    type: 'gt',
    value: 0.05,
  },
  'postgres-connections': {
    expr: [
      'sum by (deployment_environment) (motorfix_pg_connections)',
      'motorfix_pg_connections_max',
    ],
    for: '5m',
    from: 300,
    type: 'gt',
    value: 0.8,
  },
  'postgres-outbox-stuck': {
    expr: [
      'max by (deployment_environment) (motorfix_outbox_oldest_pending_seconds)',
    ],
    for: '5m',
    from: 300,
    type: 'gt',
    value: 60,
  },
  'postgres-size': {
    expr: ['motorfix_pg_database_size_bytes'],
    for: '5m',
    from: 300,
    type: 'gt',
    value: 4294967296,
  },
  'postgres-unreachable': {
    expr: ['motorfix_datastore_up{store="postgres"}'],
    for: '5m',
    from: 300,
    type: 'lt',
    value: 1,
  },
  'redis-connections': {
    expr: ['motorfix_redis_clients_connected'],
    for: '5m',
    from: 300,
    type: 'gt',
    value: 100,
  },
  'redis-memory': {
    expr: [
      'motorfix_redis_memory_used_bytes',
      'clamp_min(max by (deployment_environment) (motorfix_redis_memory_max_bytes), 335544320)',
    ],
    for: '5m',
    from: 300,
    type: 'gt',
    value: 0.7,
  },
  'redis-unreachable': {
    expr: ['motorfix_datastore_up{store="redis"}'],
    for: '5m',
    from: 300,
    type: 'lt',
    value: 1,
  },
  'web-down': {
    expr: [
      'target_info{service_name="web"}[24h]',
      'unless',
      'target_info{service_name="web"}[5m]',
    ],
    for: '0s',
    from: 86400,
    type: 'gt',
    value: 0,
  },
  'web-error-rate': {
    expr: [
      'http_server_request_duration_seconds_count{service_name="web", http_response_status_code=~"5.."}[10m]',
      'http_server_request_duration_seconds_count{service_name="web"}[10m]',
      '>= 20',
    ],
    for: '0s',
    from: 600,
    type: 'gt',
    value: 0.05,
  },
  'web-latency': {
    expr: [
      'histogram_quantile(0.95',
      'http_server_request_duration_seconds_bucket{service_name="web"}[10m]',
    ],
    for: '5m',
    from: 600,
    type: 'gt',
    value: 3,
  },
  'web-memory': MEMORY('web'),
  'worker-cdn-purge-failed': {
    expr: [
      'by (deployment_environment)',
      'increase(motorfix_cdn_purges_total{outcome="failed"}[5m])',
    ],
    for: '15m',
    from: 300,
    type: 'gt',
    value: 0,
  },
  'worker-down': {
    expr: [
      'target_info{service_name="worker"}[24h]',
      'unless',
      'target_info{service_name="worker"}[5m]',
    ],
    for: '0s',
    from: 86400,
    type: 'gt',
    value: 0,
  },
  'worker-jobs-failed': {
    expr: [
      'by (deployment_environment, queue)',
      'increase(motorfix_jobs_total{outcome="failed", queue!="verification-result"}[15m])',
    ],
    for: '0s',
    from: 900,
    type: 'gt',
    value: 0,
  },
  'worker-memory': MEMORY('worker'),
  'worker-queue-backlog': {
    expr: [
      'by (deployment_environment, queue)',
      'motorfix_queue_oldest_waiting_seconds',
    ],
    for: '5m',
    from: 300,
    type: 'gt',
    value: 600,
  },
  'worker-queue-growing': {
    expr: [
      'max by (deployment_environment, queue) (delta(motorfix_queue_waiting[5m]))',
    ],
    for: '15m',
    from: 300,
    type: 'gt',
    value: 0,
  },
  'worker-saturation': {
    expr: ['nodejs_eventloop_delay_p99_seconds{service_name="worker"}'],
    for: '5m',
    from: 300,
    type: 'gt',
    value: 0.5,
  },
};
const QUEUE_RULES = [
  'worker-queue-backlog',
  'worker-jobs-failed',
  'worker-queue-growing',
];

const PROMQL_WORDS = new Set([
  'and',
  'or',
  'unless',
  'bool',
  'offset',
  'ignoring',
  'group_left',
  'group_right',
  'inf',
  'nan',
]);

/** The metric names a PromQL expression reads. */
function metrics(expr: string): string[] {
  const bare = expr
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\{[^}]*\}/g, '')
    .replace(
      /\b(?:by|on|without|ignoring|group_left|group_right)\s*\([^)]*\)/g,
      '',
    )
    .replace(/\[[^\]]*\]/g, '');
  const names = new Set<string>();
  for (const m of bare.matchAll(/\b([a-zA-Z_:][a-zA-Z0-9_:]*)\b(?!\s*\()/g)) {
    const name = m[1] as string;
    if (!PROMQL_WORDS.has(name.toLowerCase())) names.add(name);
  }
  return [...names];
}

/** Every `expr` string anywhere in a dashboard's JSON. */
function exprs(json: string): string[] {
  const out: string[] = [];
  JSON.parse(json, (key, value) => {
    if (key === 'expr' && typeof value === 'string') out.push(value);
    return value;
  });
  return out;
}

function dashboardMetrics(): Set<string> {
  const json = readdirSync(dashboardsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readFileSync(join(dashboardsDir, f), 'utf8'));
  return new Set(json.flatMap(exprs).flatMap(metrics));
}

const rulesOf = (file: AlertFile) => file.groups.flatMap((g) => g.rules);
const query = (rule: Rule) => rule.data.find((d) => d.refId === 'A');
const threshold = (rule: Rule) =>
  rule.data.find((d) => d.refId === 'B')?.model.conditions?.[0]?.evaluator;

type Rows = [string, string, Group, Rule][];
const rows = (files: Files): Rows =>
  Object.entries(files).flatMap(([name, file]) =>
    (file.groups ?? []).flatMap((group) =>
      (group.rules ?? []).map(
        (rule) => [name, `${name} ${rule.uid}`, group, rule] as Rows[number],
      ),
    ),
  );

const groupProblems = (files: Files) =>
  Object.entries(files).flatMap(([name, file]) => [
    ...(file.apiVersion === 1 ? [] : [`${name}: apiVersion must be 1`]),
    ...(file.groups ?? [])
      .filter((g) => g.folder !== 'MotorFix' || g.interval !== '1m')
      .map((g) => `${name}: group ${g.name} must be in MotorFix every 1m`),
  ]);

const contactNames = (): Set<string> =>
  new Set(
    (
      JSON.parse(
        readFileSync(join(alertingDir, 'contact-points.json'), 'utf8'),
      ) as { name: string }[]
    ).map((p) => p.name),
  );

/** Every way the alert files break the rules this repository holds them to. */
function problems(files: Files, known = dashboardMetrics()): string[] {
  const receivers = contactNames();
  const found = groupProblems(files);
  const all = rows(files);
  const seen = new Map<string, string>();
  for (const [name, at, group, rule] of all) {
    const other = seen.get(rule.uid);
    if (other) found.push(`${at}: uid also in ${other}`);
    seen.set(rule.uid, name);
    const receiver = rule.notification_settings?.receiver;
    if (receiver !== undefined && !receivers.has(receiver))
      found.push(`${at}: receiver ${receiver} is no contact point`);
    found.push(...waitProblems(at, rule));
    if (OWN.includes(name))
      found.push(...ruleProblems(at, group.name as Service, rule, known));
  }
  if (all.length > 50) found.push(`${all.length} rules in all; at most 50`);
  return found;
}

/** A rule in any file without a runbook, or without a wait of its own. */
function waitProblems(at: string, rule: Rule): string[] {
  const found: string[] = [];
  if (!(rule.annotations?.['runbook'] ?? '').trim())
    found.push(`${at}: no runbook`);
  if (typeof rule.for !== 'string' || !/^\d+[smh]$/.test(rule.for))
    found.push(`${at}: no explicit for`);
  else if (/^0[smh]$/.test(rule.for) && !ZERO_WAIT.has(rule.uid))
    found.push(`${at}: waits 0s outside the table`);
  return found;
}

// The token as the script spells it.
const TOKEN = '$' + '{GRAFANA_SA_TOKEN}';
const ENVIRONMENT = '{{ $labels.deployment_environment }}';

// The rules whose signal disappears when what they watch is down: a store
// that answers nothing, or a worker that stopped reporting its queues.
const ALERTS_ON_NO_DATA = [
  'postgres-unreachable',
  'redis-unreachable',
  'worker-queue-backlog',
];

/** Each check a rule of the five files must pass, and what failing it means. */
const RULE_CHECKS: [
  string,
  (rule: Rule, service: Service, expr: string) => boolean,
][] = [
  ['uid must start with its service', (r, s) => r.uid.startsWith(`${s}-`)],
  [
    'title must start with its service',
    (r, s) => r.title.startsWith(SERVICES[s].title),
  ],
  ['condition must be B', (r) => r.condition === 'B'],
  [
    'noDataState must be Alerting for an absence rule, OK for any other',
    (r) =>
      r.noDataState === (ALERTS_ON_NO_DATA.includes(r.uid) ? 'Alerting' : 'OK'),
  ],
  ['execErrState must be Error', (r) => r.execErrState === 'Error'],
  ['label service must be its service', (r, s) => r.labels?.['service'] === s],
  ['carries the outage label', (r) => !('outage' in (r.labels ?? {}))],
  [
    'summary must name the environment',
    (r) => (r.annotations?.['summary'] ?? '').includes(ENVIRONMENT),
  ],
  [
    "dashboard_uid must be its service's",
    (r, s) => r.annotations?.['dashboard_uid'] === SERVICES[s].dashboard,
  ],
  [
    'names a receiver; the policy routes it',
    (r) => r.notification_settings === undefined,
  ],
  [
    'query A must read grafanacloud-prom',
    (r) => query(r)?.datasourceUid === 'grafanacloud-prom',
  ],
  [
    'every aggregation must group by deployment_environment',
    (_r, _s, e) => {
      const by = [...e.matchAll(/\bby \(([^)]*)\)/g)].map((m) => m[1] ?? '');
      return (
        by.length > 0 && by.every((g) => g.includes('deployment_environment'))
      );
    },
  ],
  [
    'names an environment',
    (_r, _s, e) => !/deployment_environment\s*[=!]~?\s*"/.test(e),
  ],
  ['reads probe_success', (_r, _s, e) => !e.includes('probe_success')],
];

function ruleProblems(
  at: string,
  service: Service,
  rule: Rule,
  known: Set<string>,
): string[] {
  if (!SERVICES[service]) return [`${at}: no service ${service}`];
  const expr = query(rule)?.model.expr ?? '';
  return [
    ...RULE_CHECKS.filter(([, ok]) => !ok(rule, service, expr)).map(
      ([m]) => `${at}: ${m}`,
    ),
    ...metrics(expr)
      .filter((m) => !known.has(m))
      .map((m) => `${at}: ${m} is on no dashboard`),
  ];
}

function expectRule(rule: Rule, want: (typeof EXPECTED)[string] | undefined) {
  expect([rule.uid, threshold(rule)]).toEqual([
    rule.uid,
    { params: [want?.value], type: want?.type },
  ]);
  expect([rule.uid, rule.for, query(rule)?.relativeTimeRange.from]).toEqual([
    rule.uid,
    want?.for,
    want?.from,
  ]);
  for (const fragment of want?.expr ?? []) {
    expect([rule.uid, query(rule)?.model.expr]).toEqual([
      rule.uid,
      expect.stringContaining(fragment),
    ]);
  }
}

// @traces 267-FR-023
describe('alert rules', () => {
  const files = alertFiles();
  const own = (service: Service) => files[`${service}.json`];

  // @traces 1024-FR-001
  it('each of the five services has its own file with one group named after it', () => {
    for (const service of Object.keys(SERVICES) as Service[]) {
      const file = own(service);
      expect(file).toBeDefined();
      expect(file?.groups.map((g) => g.name)).toEqual([service]);
    }
  });

  // @traces 1024-FR-001
  // @traces 1024-FR-010
  // @traces 880-FR-001
  // @traces 880-FR-002
  // @traces 880-FR-013
  // @traces 880-FR-017
  // @traces 1347-FR-003
  it('every file breaks none of the rules', () => {
    expect(problems(files)).toEqual([]);
  });

  // @traces 1024-FR-002
  // @traces 1024-FR-003
  // @traces 1024-FR-004
  // @traces 1024-FR-005
  // @traces 1024-FR-006
  // @traces 1024-FR-007
  // @traces 267-FR-023
  // @traces 1182-FR-014
  // @traces 1169-FR-012
  // @traces 880-FR-003
  // @traces 880-FR-004
  // @traces 880-FR-005
  // @traces 880-FR-007
  // @traces 880-FR-009
  it('holds exactly the twenty-seven rules, each with its threshold, window and wait', () => {
    const rules = OWN.flatMap((name) =>
      files[name] ? rulesOf(files[name]) : [],
    );
    expect(rules.map((r) => r.uid).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
    for (const rule of rules) expectRule(rule, EXPECTED[rule.uid]);
  });

  // @traces 880-FR-007
  it('the MCP server has its own memory rule on its dashboard', () => {
    const rule = rulesOf(files['mcp.json'] as AlertFile).find(
      (r) => r.uid === 'mcp-memory',
    );
    expect(rule).toBeDefined();
    expectRule(rule as Rule, MEMORY('mcp'));
    expect(rule?.annotations['dashboard_uid']).toBe('motorfix-mcp');
    expect(rule?.annotations['summary']).toContain(ENVIRONMENT);
  });

  // @traces 880-FR-002
  it('fires with no wait only the rules whose query already holds one', () => {
    const zero = rows(files)
      .map(([, , , r]) => r)
      .filter((r) => /^0[smh]$/.test(r.for))
      .map((r) => r.uid);
    expect(zero.sort()).toEqual([...ZERO_WAIT].sort());
  });

  // @traces 880-FR-001
  it('every rule says what to check first', () => {
    for (const [, at, , rule] of rows(files))
      expect([at, (rule.annotations['runbook'] ?? '').length > 20]).toEqual([
        at,
        true,
      ]);
  });

  // @traces 880-FR-008
  it.each([
    ['api', 'API'],
    ['web', 'Web'],
    ['worker', 'Worker'],
    ['mcp', 'MCP'],
  ])('tells the owner when %s stops reporting, naming it', (s, title) => {
    const rule = rows(files)
      .map(([, , , r]) => r)
      .find((r) => r.uid === `${s}-down`);
    expect(rule?.title).toContain(title);
    expect(rule?.annotations['summary']).toMatch(new RegExp(`\\b${s}\\b`, 'i'));
    expect(rule?.noDataState).toBe('OK');
  });

  // @traces 880-FR-010
  it('tells the owner a job failed for good, naming the queue', () => {
    const rule = rulesOf(own('worker') as AlertFile).find(
      (r) => r.uid === 'worker-jobs-failed',
    );
    expect(query(rule as Rule)?.model.expr).toContain('outcome="failed"');
    expect(rule?.annotations['summary']).toContain('{{ $labels.queue }}');
  });

  // @traces 880-FR-017
  // @traces 305-FR-009
  // @traces 304-request-garage-details-FR-012
  it('holds forty-one rules in all, under the free tier cap', () => {
    expect(rows(files)).toHaveLength(41);
  });

  // @traces 1345-FR-004
  it('alerts on missing data for the absence rules only', () => {
    const all = Object.values(files).flatMap(rulesOf);
    const alerting = all
      .filter((r) => r.noDataState === 'Alerting')
      .map((r) => r.uid)
      .sort();

    expect(alerting).toEqual([...ALERTS_ON_NO_DATA].sort());
  });

  // @traces 1175-FR-006
  it('warns at 70 % of the store memory, the floor being 70 % of 320 MiB', () => {
    const rule = rulesOf(own('redis') as AlertFile).find(
      (r) => r.uid === 'redis-memory',
    );
    expect(rule?.annotations['summary']).toContain('more than 70%');
    expect(rule?.annotations['summary']).toContain('224 MiB');
  });

  // @traces 1024-FR-005
  // @traces 880-FR-009
  it('names the queue in the summary of the per-queue rules', () => {
    for (const uid of QUEUE_RULES) {
      const rule = rulesOf(own('worker') as AlertFile).find(
        (r) => r.uid === uid,
      );
      expect(rule?.annotations['summary']).toContain('{{ $labels.queue }}');
    }
  });

  // @traces 1024-FR-010
  // @traces 880-FR-016
  describe('refuses a file that breaks a rule', () => {
    const base = () => clone(files);
    const first = (f: Files) =>
      (f['api.json'] as AlertFile).groups[0]?.rules[0] as Rule;

    it.each<[string, (f: Files) => void, RegExp]>([
      [
        'a uid used twice',
        (f) => {
          first(f).uid = 'web-down';
        },
        /web\.json web-down: uid also in api\.json|api\.json web-down: uid also in web\.json/,
      ],
      [
        'the outage label',
        (f) => {
          first(f).labels['outage'] = 'true';
        },
        /api\.json api-\S+: carries the outage label/,
      ],
      [
        'a metric no dashboard reads',
        (f) => {
          const a = query(first(f));
          if (a)
            a.model.expr =
              'max by (deployment_environment) (motorfix_made_up_total)';
        },
        /api\.json api-\S+: motorfix_made_up_total is on no dashboard/,
      ],
      [
        'a receiver on an owner rule',
        (f) => {
          first(f).notification_settings = { receiver: 'MotorFix owner' };
        },
        /api\.json api-\S+: names a receiver; the policy routes it/,
      ],
      // @traces 1347-FR-003
      [
        'a receiver no contact point declares',
        (f) => {
          const rule = rulesOf(f['outage.json'] as AlertFile)[0] as Rule;
          rule.notification_settings = { receiver: 'motorfix-outage-2' };
        },
        /outage\.json outage: receiver motorfix-outage-2 is no contact point/,
      ],
      [
        'no runbook',
        (f) => {
          const rule = (f['mcp.json'] as AlertFile).groups[0]?.rules[0] as Rule;
          delete rule.annotations['runbook'];
        },
        /mcp\.json mcp-\S+: no runbook/,
      ],
      [
        'no wait',
        (f) => {
          (first(f) as Partial<Rule>).for = undefined;
        },
        /api\.json api-\S+: no explicit for/,
      ],
      [
        'no wait on a rule outside the table',
        (f) => {
          const rule = rulesOf(f['postgres.json'] as AlertFile).find(
            (r) => r.uid === 'postgres-outbox-stuck',
          ) as Rule;
          rule.for = '0s';
        },
        /postgres\.json postgres-outbox-stuck: waits 0s outside the table/,
      ],
      [
        'an environment named in the query',
        (f) => {
          const a = query(first(f));
          if (a)
            a.model.expr = `${a.model.expr} and on () vector(1) and deployment_environment="staging"`;
        },
        /api\.json api-\S+: names an environment/,
      ],
      [
        'probe_success',
        (f) => {
          const a = query(first(f));
          if (a)
            a.model.expr = 'max by (deployment_environment) (probe_success)';
        },
        /api\.json api-\S+: reads probe_success/,
      ],
      [
        'more than 50 rules',
        (f) => {
          const group = (f['redis.json'] as AlertFile).groups[0] as Group;
          const rule = group.rules[0] as Rule;
          for (let i = 0; i < 50; i++)
            group.rules.push({ ...clone(rule), uid: `redis-copy-${i}` });
        },
        /\d+ rules in all; at most 50/,
      ],
    ])('%s', (_, breakIt, message) => {
      const broken = base();
      breakIt(broken);
      expect(problems(broken).join('\n')).toMatch(message);
    });
  });
});

describe('the inventory lists the rules', () => {
  type Entry = {
    kind: string;
    name: string;
    dashboard: string;
    alerts: string[] | 'none';
    reason?: string;
  };
  const inventory: { entries: Entry[] } = JSON.parse(
    readFileSync(
      join(root, 'infra', 'observability', 'inventory.json'),
      'utf8',
    ),
  );
  const files = alertFiles();
  const uids = (service: Service) =>
    files[`${service}.json`]
      ? rulesOf(files[`${service}.json`] as AlertFile).map((r) => r.uid)
      : [];
  const entry = (kind: string, name: string) =>
    inventory.entries.find((e) => e.kind === kind && e.name === name);

  // @traces 1024-FR-008
  it.each(['api', 'worker', 'web'] as const)(
    '%s lists its rules as an app and as a Railway service',
    (s) => {
      expect(uids(s).length).toBeGreaterThan(0);
      expect(entry('app', s)?.alerts).toEqual(uids(s));
      expect(entry('railway-service', s)?.alerts).toEqual(uids(s));
    },
  );

  // @traces 1024-FR-008
  it.each([
    ['postgresql', 'postgres'],
    ['redis', 'redis'],
  ] as const)('the %s data store lists its rules', (name, s) => {
    expect(uids(s).length).toBeGreaterThan(0);
    expect(entry('outside-service', name)?.alerts).toEqual(uids(s));
  });

  // @traces 1024-FR-008
  it('every queue without a rule of its own lists the backlog and failed-job rules', () => {
    const queues = inventory.entries.filter(
      (e) =>
        e.kind === 'queue' &&
        !['verification-result', 'quote-timers'].includes(e.name),
    );
    expect(queues.length).toBeGreaterThan(0);
    for (const q of queues)
      expect([q.name, q.alerts]).toEqual([
        q.name,
        expect.arrayContaining(QUEUE_RULES),
      ]);
  });

  // @traces 1024-FR-008
  it("an outside service or endpoint lists its caller's error and latency rules", () => {
    const caller: Record<string, string[]> = {
      'motorfix-api': ['api-error-rate', 'api-latency'],
      'motorfix-web': ['web-error-rate', 'web-latency'],
      'motorfix-web-vitals': ['web-error-rate', 'web-latency'],
      'motorfix-worker': ['worker-jobs-failed', 'worker-saturation'],
    };
    const covered = inventory.entries.filter(
      (e) =>
        ['outside-service', 'endpoint'].includes(e.kind) &&
        caller[e.dashboard] &&
        e.name !== 'keycloak',
    );
    expect(covered.length).toBeGreaterThan(0);
    for (const e of covered) {
      expect([e.name, e.alerts]).toEqual([
        e.name,
        expect.arrayContaining(caller[e.dashboard] as string[]),
      ]);
    }
  });

  // @traces 880-FR-015
  it('lists the search, MCP memory and queue growth rules where they watch', () => {
    expect(entry('endpoint', 'search-garages')?.alerts).toContain(
      'api-search-latency',
    );
    expect(entry('app', 'mcp')?.alerts).toContain('mcp-memory');
    expect(entry('railway-service', 'mcp')?.alerts).toContain('mcp-memory');
    expect(entry('outside-service', 'postgresql')?.alerts).toContain(
      'postgres-outbox-stuck',
    );
    for (const q of inventory.entries.filter(
      (e) =>
        Array.isArray(e.alerts) && e.alerts.includes('worker-queue-backlog'),
    ))
      expect([q.name, q.alerts]).toEqual([
        q.name,
        expect.arrayContaining(['worker-queue-growing']),
      ]);
  });

  // @traces 1024-FR-008
  // @traces 880-FR-015
  it('every rule of the five files is listed, and no reason still waits for a later story', () => {
    const listed = new Set(
      inventory.entries.flatMap((e) =>
        Array.isArray(e.alerts) ? e.alerts : [],
      ),
    );
    for (const uid of [...Object.keys(EXPECTED), 'mcp-memory'])
      expect([uid, listed.has(uid)]).toEqual([uid, true]);
    const waiting = inventory.entries.filter((e) =>
      /ST-\d+ adds the (?:queue )?alert/.test(e.reason ?? ''),
    );
    expect(waiting.map((e) => `${e.kind} ${e.name}`)).toEqual([]);
  });
});

type ContactPoint = {
  uid: string;
  name: string;
  type: string;
  settings: Record<string, unknown>;
  disableResolveMessage?: boolean;
};
type Route = {
  receiver?: string;
  group_by?: string[];
  group_wait?: string;
  group_interval?: string;
  repeat_interval?: string;
  object_matchers?: string[][];
  mute_time_intervals?: string[];
  active_time_intervals?: string[];
  routes?: Route[];
};
const alerting = <T>(name: string): T =>
  JSON.parse(readFileSync(join(alertingDir, name), 'utf8'));

/** Every way a policy tree breaks what this repository holds it to. */
function routeProblems(policy: Route, points: ContactPoint[]): string[] {
  const names = new Set(points.map((p) => p.name));
  const found: string[] = policy.receiver ? [] : ['root: no receiver'];
  const walk = (route: Route, at: string) => {
    for (const key of ['mute_time_intervals', 'active_time_intervals'])
      if (key in route) found.push(`${at}: holds ${key}`);
    if (route.receiver !== undefined && !names.has(route.receiver))
      found.push(`${at}: receiver ${route.receiver} is no contact point`);
    route.routes?.forEach((child, i) => {
      walk(child, `${at}.routes[${i}]`);
    });
  };
  walk(policy, 'root');
  return found;
}

/** Holds the contact points to what the repository declares; throws on any other. */
function expectDeclared(points: ContactPoint[]) {
  const owner = 'hutanugeorge40@gmail.com';
  const [mine, email, webhook, ...rest] = points;
  expect(rest).toEqual([]);
  expect(mine).toEqual({
    name: 'MotorFix owner',
    settings: { addresses: owner },
    type: 'email',
    uid: 'motorfix-owner',
  });
  expect(email).toEqual({
    name: 'motorfix-outage',
    settings: { addresses: expect.any(String) },
    type: 'email',
    uid: 'motorfix-outage-email',
  });
  const addresses = String(email?.settings['addresses']).split(';');
  expect(addresses).toContain(owner);
  for (const address of addresses)
    expect(address).toMatch(/^[^\s;@/:]+@[^\s;@/:]+\.[^\s;@/:]+$/);
  expect(webhook).toEqual({
    name: 'motorfix-outage',
    settings: {
      authorization_scheme: 'Bearer',
      httpMethod: 'POST',
      url: '{PUBLIC_WEB_URL}/api/v1/monitoring/outage-alerts',
    },
    type: 'webhook',
    uid: 'motorfix-outage-webhook',
  });
}

describe('the contact point and the notification policy', () => {
  const points = () => alerting<ContactPoint[]>('contact-points.json');
  const policy = () => alerting<Route>('policies.json');
  const intervals = (wait: string, group: string, repeat: string) => ({
    group_interval: group,
    group_wait: wait,
    repeat_interval: repeat,
  });

  // @traces 880-FR-011
  // @traces 1347-FR-001
  it('declares the owner e-mail and the outage e-mail and webhook, with no host or credential', () => {
    expectDeclared(points());
  });

  // @traces 1347-FR-001
  it.each<[string, (p: ContactPoint[]) => void]>([
    [
      'a credential in the webhook',
      (p) => {
        (p[2] as ContactPoint).settings['authorization_credentials'] = 'x';
      },
    ],
    [
      "a host in the webhook's url",
      (p) => {
        (p[2] as ContactPoint).settings['url'] =
          'https://staging.example.test/api/v1/monitoring/outage-alerts';
      },
    ],
    [
      'an unknown key',
      (p) => {
        (p[1] as ContactPoint).disableResolveMessage = true;
      },
    ],
    [
      'a list in place of the addresses',
      (p) => {
        (p[1] as ContactPoint).settings['addresses'] = ['a@example.test'];
      },
    ],
    [
      'a second address that is no address',
      (p) => {
        (p[1] as ContactPoint).settings['addresses'] =
          'hutanugeorge40@gmail.com;oops';
      },
    ],
    [
      'a fourth entry',
      (p) => {
        p.push({ ...clone(p[1] as ContactPoint), uid: 'motorfix-outage-sms' });
      },
    ],
    [
      'a second integration type under the owner name',
      (p) => {
        (p[2] as ContactPoint).name = 'MotorFix owner';
      },
    ],
  ])('refuses %s', (_, breakIt) => {
    const broken = clone(points());
    breakIt(broken);
    expect(() => expectDeclared(broken)).toThrow();
  });

  // @traces 880-FR-012
  it('routes production at once and staging more quietly, both to the owner', () => {
    expect(policy()).toEqual({
      group_by: ['alertname', 'deployment_environment'],
      receiver: 'MotorFix owner',
      ...intervals('30s', '5m', '4h'),
      routes: [
        {
          object_matchers: [['deployment_environment', '=', 'production']],
          receiver: 'MotorFix owner',
          ...intervals('30s', '5m', '4h'),
        },
        {
          object_matchers: [['deployment_environment', '=', 'staging']],
          receiver: 'MotorFix owner',
          ...intervals('5m', '30m', '24h'),
        },
      ],
    });
    expect(routeProblems(policy(), points())).toEqual([]);
  });

  // @traces 880-FR-012
  // @traces 880-FR-016
  it.each<[string, (p: Route) => void, RegExp]>([
    [
      'a mute on a route',
      (p) => {
        (p.routes?.[1] as Route).mute_time_intervals = ['working-hours'];
      },
      /root\.routes\[1\]: holds mute_time_intervals/,
    ],
    [
      'an empty mute list on the root',
      (p) => {
        p.mute_time_intervals = [];
      },
      /root: holds mute_time_intervals/,
    ],
    [
      'an active interval',
      (p) => {
        (p.routes?.[0] as Route).active_time_intervals = ['nights'];
      },
      /root\.routes\[0\]: holds active_time_intervals/,
    ],
    [
      'a receiver no contact point declares',
      (p) => {
        (p.routes?.[0] as Route).receiver = 'Slack';
      },
      /root\.routes\[0\]: receiver Slack is no contact point/,
    ],
  ])('refuses %s', (_, breakIt, message) => {
    const broken = clone(policy());
    breakIt(broken);
    expect(routeProblems(broken, points()).join('\n')).toMatch(message);
  });
});

describe('Grafana alerts workflow', () => {
  const name = 'grafana-alerts.yml';
  const text = () => read(name);
  const step = (title: string) => {
    const lines = text().split('\n');
    const start = lines.findIndex((l) => l.trim() === `- name: ${title}`);
    if (start < 0) throw new Error(`${name} has no step ${title}`);
    const indent = (lines[start] as string).search(/\S/);
    const end = lines.findIndex(
      (l, i) => i > start && l.trim() !== '' && l.search(/\S/) <= indent,
    );
    return lines.slice(start, end < 0 ? undefined : end).join('\n');
  };

  // @traces 1024-FR-009
  // @traces 880-FR-014
  it('runs on a push to main that changes the alerts or itself, and by hand', () => {
    expect(text()).toMatch(/^name: Grafana alerts$/m);
    const on = block(text(), 'on', 0);
    expect(on).toMatch(/branches: \[main\]/);
    expect(on).toContain("'infra/observability/alerts/**'");
    expect(on).toContain("'infra/observability/grafana/alerting/**'");
    expect(on).toContain("'.github/workflows/grafana-alerts.yml'");
    expect(on).toMatch(/^ {2}workflow_dispatch:/m);
    expect(text()).toMatch(/permissions:\n\s+contents: read/);
  });

  // @traces 1024-FR-009
  it('skips with a notice naming what is missing when the token or the URL is unset', () => {
    expect(text()).toContain(
      `GRAFANA: \${{ secrets.GRAFANA_SA_TOKEN != '' && vars.GRAFANA_URL != '' }}`,
    );
    const skip = step('Skip the alerts');
    expect(skip).toContain("if: env.GRAFANA != 'true'");
    expect(skip).toContain('::notice');
    expect(skip).toContain('GRAFANA_SA_TOKEN');
    expect(skip).toContain('GRAFANA_URL');
    expect(step('Apply the alerts')).toContain("if: env.GRAFANA == 'true'");
  });

  // @traces 1024-FR-009
  // @traces 1024-FR-012
  it('sends the token once, in the Authorization header, and prints no answer', () => {
    const run = script(step('Apply the alerts')).replace(/\\\n\s*/g, ' ');
    expect(run.match(/\$\{?GRAFANA_SA_TOKEN\}?/g)).toEqual([TOKEN]);
    expect(run).toContain(`Authorization: Bearer ${TOKEN}`);
    expect(run).not.toMatch(/set -x|echo[^\n]*GRAFANA_URL/);
    for (const call of run.split('\n').filter((l) => /\bcurl\b/.test(l))) {
      expect(call).toContain('--max-time 60');
      expect(call).toMatch(/> \/dev\/null/);
    }
  });

  describe('applies every file, one group per call', () => {
    let dir: string;
    const token = 'token-value-never-printed';
    const url = 'https://grafana.example.test';

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'grafana-alerts-'));
      mkdirSync(join(dir, 'bin'));
      mkdirSync(join(dir, 'infra', 'observability', 'alerts'), {
        recursive: true,
      });
      for (const f of ['api.json', 'redis.json', 'mcp.json']) {
        cpSync(
          join(alertsDir, f),
          join(dir, 'infra', 'observability', 'alerts', f),
        );
      }
      cpSync(
        alertingDir,
        join(dir, 'infra', 'observability', 'grafana', 'alerting'),
        { recursive: true },
      );
      // Logs each call's arguments and request body; refuses a group named in
      // FAIL_GROUP and answers 404 for the folder unless FOLDER_EXISTS is
      // set. The contact point answers an HTTP status through -w: the one in
      // FAIL_CONTACT for its PUT and POST, the one in CONTACT_PUT for its PUT,
      // 404 for its PUT when CONTACT_MISSING is set, else 200. A list of
      // contact points answers into the file -o names: CONTACTS for the
      // owner's name, OUTAGE_CONTACTS for the outage one, nothing for others.
      const curl = join(dir, 'bin', 'curl');
      writeFileSync(
        curl,
        [
          '#!/usr/bin/env bash',
          'n=$(ls "$CALLS" | wc -l | tr -d " ")',
          'printf "%s\\n" "$@" > "$CALLS/$n.args"',
          'case " $* " in *" @- "*|*" --data-binary @- "*) cat > "$CALLS/$n.body";; esac',
          'case "$*" in',
          '  *"rule-groups/$FAIL_GROUP"*) [ -n "$FAIL_GROUP" ] && { echo "{\\"message\\":\\"refused\\"}"; exit 22; };;',
          'esac',
          'out=""; prev=""; w=""; fail=""',
          'for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; case "$a" in -w) w=1;; --fail|-f) fail=1;; esac; prev="$a"; done',
          'answer() { [ -n "$w" ] && printf "%s" "$1"; case "$1" in 2??) exit 0;; esac; [ -n "$fail" ] && exit 22; exit 0; }',
          'case "$*" in',
          '  *"contact-points?name=MotorFix%20owner"*) [ -n "$out" ] && printf "%s" "$CONTACTS" > "$out"; exit 0;;',
          '  *"contact-points?name=motorfix-outage"*) [ -n "$out" ] && printf "%s" "$OUTAGE_CONTACTS" > "$out"; exit 0;;',
          '  *"contact-points?name="*) [ -n "$out" ] && printf "[]" > "$out"; exit 0;;',
          '  *"-X DELETE"*) exit 0;;',
          '  *"/contact-points"*) [ -n "$FAIL_CONTACT" ] && answer "$FAIL_CONTACT"; case "$*" in *"-X PUT"*) [ -n "$CONTACT_PUT" ] && answer "$CONTACT_PUT"; [ -n "$CONTACT_MISSING" ] && answer 404;; esac; answer 200;;',
          '  *"-X POST"*) exit 0;;',
          '  *"/api/folders/motorfix"*) [ -n "$FOLDER_EXISTS" ] && exit 0; exit 22;;',
          'esac',
          'exit 0',
        ].join('\n'),
      );
      chmodSync(curl, 0o755);
      mkdirSync(join(dir, 'calls'));
    });
    afterEach(() => rmSync(dir, { force: true, recursive: true }));

    const apply = (env: Record<string, string> = {}) => {
      const run = spawnSync(
        'bash',
        [
          '--noprofile',
          '--norc',
          '-eo',
          'pipefail',
          '-c',
          script(step('Apply the alerts')),
        ],
        {
          cwd: dir,
          encoding: 'utf8',
          env: {
            CALLS: join(dir, 'calls'),
            CONTACT_MISSING: '',
            CONTACT_PUT: '',
            CONTACTS: JSON.stringify([
              { name: 'MotorFix owner', uid: 'motorfix-owner' },
              { name: 'MotorFix owner', uid: 'hand-made' },
            ]),
            FAIL_CONTACT: '',
            FAIL_GROUP: '',
            FOLDER_EXISTS: '',
            GRAFANA_SA_TOKEN: token,
            GRAFANA_URL: url,
            OUTAGE_CONTACTS: '[]',
            OUTAGE_WEBHOOK_TOKEN: '',
            PATH: `${join(dir, 'bin')}:${process.env['PATH']}`,
            STAGING_WEB_URL: '',
            ...env,
          },
        },
      );
      const calls = readdirSync(join(dir, 'calls'))
        .filter((f) => f.endsWith('.args'))
        .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
        .map((f) => {
          const n = f.replace('.args', '');
          const args = readFileSync(join(dir, 'calls', f), 'utf8');
          let body: unknown;
          try {
            body = JSON.parse(
              readFileSync(join(dir, 'calls', `${n}.body`), 'utf8'),
            );
          } catch {
            body = undefined;
          }
          return {
            args,
            body: body as {
              title: string;
              interval: number;
              rules: Record<string, unknown>[];
            },
          };
        });
      return { calls, code: run.status, out: `${run.stdout}${run.stderr}` };
    };
    const puts = (calls: ReturnType<typeof apply>['calls']) =>
      calls.filter((c) => c.args.includes('rule-groups/'));

    // @traces 1024-FR-009
    it('creates the folder when it is missing, then puts each group with its rules', () => {
      const { code, out, calls } = apply();
      expect(code).toBe(0);
      expect(
        calls.some(
          (c) => c.args.includes('POST') && c.args.includes('"uid":"motorfix"'),
        ),
      ).toBe(true);
      const groups = puts(calls);
      expect(groups.map((c) => c.body.title).sort()).toEqual([
        'api',
        'mcp',
        'redis',
      ]);
      for (const call of groups) {
        expect(call.args).toContain(
          `${url}/api/v1/provisioning/folder/motorfix/rule-groups/${call.body.title}`,
        );
        expect(call.args).toContain('X-Disable-Provenance: true');
        expect(call.args).toContain('PUT');
        expect(call.body.interval).toBe(60);
        const source = alertFiles(
          join(dir, 'infra', 'observability', 'alerts'),
        )[`${call.body.title}.json`];
        expect(call.body.rules.map((r) => r['uid'])).toEqual(
          rulesOf(source as AlertFile).map((r) => r.uid),
        );
        for (const rule of call.body.rules) {
          expect(rule).toMatchObject({
            folderUID: 'motorfix',
            orgID: 1,
            ruleGroup: call.body.title,
          });
        }
      }
      expect(out.match(/applied infra\/observability\/alerts/g)).toHaveLength(
        3,
      );
      expect(out).not.toContain(token);
      expect(out).not.toContain(url);
    });

    // @traces 1024-FR-009
    it('leaves an existing folder alone', () => {
      const { code, calls } = apply({ FOLDER_EXISTS: '1' });
      expect(code).toBe(0);
      expect(calls.some((c) => c.args.includes('POST'))).toBe(false);
      expect(puts(calls)).toHaveLength(3);
    });

    const index = (
      calls: ReturnType<typeof apply>['calls'],
      test: (args: string) => boolean,
    ) => calls.findIndex((c) => test(c.args));

    const OUTAGE_LISTED = [
      { name: 'motorfix-outage', uid: 'motorfix-outage-email' },
      { name: 'motorfix-outage', uid: 'motorfix-outage-webhook' },
    ];
    const hook = 'hook-token-never-printed';
    const web = 'https://staging.example.test';
    const point = (uid: string) => {
      const found = alerting<ContactPoint[]>('contact-points.json').find(
        (p) => p.uid === uid,
      );
      if (!found) throw new Error(`contact-points.json declares no ${uid}`);
      return found;
    };
    const contactPuts = (calls: ReturnType<typeof apply>['calls']) =>
      calls.filter(
        (c) => c.args.includes('PUT') && c.args.includes('/contact-points/'),
      );
    const deleted = (calls: ReturnType<typeof apply>['calls']) =>
      calls
        .filter((c) => c.args.includes('DELETE'))
        .map((c) => c.args.match(/contact-points\/([^\n]+)/)?.[1]);
    const withOutage = () =>
      cpSync(
        join(alertsDir, 'outage.json'),
        join(dir, 'infra', 'observability', 'alerts', 'outage.json'),
      );

    // @traces 880-FR-014
    // @traces 1347-FR-002
    it('applies the contact points, then the policy, then the rules, then drops the hand-made ones', () => {
      const { code, out, calls } = apply({
        FOLDER_EXISTS: '1',
        OUTAGE_CONTACTS: JSON.stringify([
          ...OUTAGE_LISTED,
          { name: 'motorfix-outage', uid: 'outage-by-hand' },
        ]),
      });
      expect(code).toBe(0);
      const contacts = contactPuts(calls);
      const contact = calls.indexOf(contacts.at(-1) as (typeof calls)[number]);
      const policy = index(calls, (a) =>
        a.includes(`${url}/api/v1/provisioning/policies`),
      );
      const rules = index(calls, (a) => a.includes('rule-groups/'));
      const list = index(calls, (a) => a.includes('contact-points?name='));
      expect(contact).toBeGreaterThanOrEqual(0);
      expect([contact < policy, policy < rules, rules < list]).toEqual([
        true,
        true,
        true,
      ]);
      expect(contacts.map((c) => c.body)).toEqual([
        point('motorfix-owner'),
        point('motorfix-outage-email'),
      ]);
      for (const c of contacts)
        expect(c.args).toContain(
          `${url}/api/v1/provisioning/contact-points/${(c.body as unknown as ContactPoint).uid}`,
        );
      expect(calls[policy]?.body).toEqual(alerting<Route>('policies.json'));
      for (const c of [...contacts, calls[policy]])
        expect(c?.args).toContain('X-Disable-Provenance: true');
      expect(deleted(calls)).toEqual(['hand-made', 'outage-by-hand']);
      expect(out).toContain(
        'applied infra/observability/grafana/alerting/contact-points.json (motorfix-outage-email)',
      );
      expect(out).toContain(
        'applied infra/observability/grafana/alerting/policies.json',
      );
      expect(out).not.toContain(token);
    });

    // @traces 880-FR-014
    // @traces 1347-FR-002
    it('creates the contact points when Grafana has none with their uids', () => {
      const { code, calls } = apply({
        CONTACT_MISSING: '1',
        FOLDER_EXISTS: '1',
      });
      expect(code).toBe(0);
      const created = calls.filter(
        (c) =>
          c.args.includes('POST') &&
          c.args.includes(`${url}/api/v1/provisioning/contact-points\n`),
      );
      expect(created.map((c) => c.body)).toEqual([
        point('motorfix-owner'),
        point('motorfix-outage-email'),
      ]);
    });

    // @traces 880-FR-014
    it('posts the contact point only after a PUT that answered 404, and before the policy', () => {
      const { code, calls } = apply({
        CONTACT_MISSING: '1',
        FOLDER_EXISTS: '1',
      });
      expect(code).toBe(0);
      const put = index(
        calls,
        (a) => a.includes('PUT') && a.includes('contact-points/motorfix-owner'),
      );
      const post = index(
        calls,
        (a) =>
          a.includes('POST') &&
          a.includes(`${url}/api/v1/provisioning/contact-points\n`),
      );
      const policy = index(calls, (a) =>
        a.includes(`${url}/api/v1/provisioning/policies`),
      );
      expect([put >= 0, put < post, post < policy]).toEqual([true, true, true]);
    });

    // @traces 880-FR-014
    it('sends no POST when the PUT is refused with anything but 404, names the code and fails', () => {
      const { code, out, calls } = apply({
        CONTACT_PUT: '500',
        FOLDER_EXISTS: '1',
      });
      expect(code).not.toBe(0);
      expect(
        calls.some(
          (c) =>
            c.args.includes('POST') &&
            c.args.includes(`${url}/api/v1/provisioning/contact-points\n`),
        ),
      ).toBe(false);
      expect(out).toMatch(
        /::error::.*contact-points\.json.*motorfix-owner.*HTTP 500/,
      );
      expect(calls.some((c) => c.args.includes('DELETE'))).toBe(false);
      expect(out).not.toContain(token);
    });

    // @traces 880-FR-014
    it('keeps the hand-made contact point when its own is refused, and fails at the end', () => {
      const { code, out, calls } = apply({
        FAIL_CONTACT: '500',
        FOLDER_EXISTS: '1',
      });
      expect(code).not.toBe(0);
      expect(out).toMatch(/::error::.*contact-points\.json/);
      expect(calls.some((c) => c.args.includes('DELETE'))).toBe(false);
      expect(puts(calls)).toHaveLength(3);
      expect(out).toContain(
        'applied infra/observability/grafana/alerting/policies.json',
      );
    });

    // @traces 1347-FR-002
    it.each([web, `${web}/`, `${web}//`])(
      'applies the outage webhook with the staging address %s and the token, printing neither',
      (address) => {
        withOutage();
        const { code, out, calls } = apply({
          FOLDER_EXISTS: '1',
          OUTAGE_WEBHOOK_TOKEN: hook,
          STAGING_WEB_URL: address,
        });
        expect(code).toBe(0);
        const declared = point('motorfix-outage-webhook');
        const sent = contactPuts(calls).filter((c) =>
          c.args.includes(
            `${url}/api/v1/provisioning/contact-points/motorfix-outage-webhook\n`,
          ),
        );
        expect(sent.map((c) => c.body)).toEqual([
          {
            ...declared,
            settings: {
              ...declared.settings,
              authorization_credentials: hook,
              url: `${web}/api/v1/monitoring/outage-alerts`,
            },
          },
        ]);
        expect(puts(calls).map((c) => c.body.title)).toContain('outage');
        expect(out).not.toMatch(/::notice::/);
        expect(out).toContain(
          'applied infra/observability/grafana/alerting/contact-points.json (motorfix-outage-webhook)',
        );
        for (const value of [hook, 'staging.example.test', token])
          expect(out).not.toContain(value);
      },
    );

    // @traces 1347-FR-002
    it.each<[string, Record<string, string>, string[], string[]]>([
      [
        'the variable',
        { OUTAGE_WEBHOOK_TOKEN: hook },
        ['STAGING_WEB_URL'],
        ['OUTAGE_WEBHOOK_TOKEN'],
      ],
      [
        'the secret',
        { STAGING_WEB_URL: web },
        ['OUTAGE_WEBHOOK_TOKEN'],
        ['STAGING_WEB_URL'],
      ],
      ['both', {}, ['OUTAGE_WEBHOOK_TOKEN', 'STAGING_WEB_URL'], []],
    ])(
      'skips the outage webhook with one notice when %s is missing, and applies the rest',
      (_, env, named, unnamed) => {
        withOutage();
        const { code, out, calls } = apply({ FOLDER_EXISTS: '1', ...env });
        expect(code).toBe(0);
        const notices = out.match(/::notice::.*/g) ?? [];
        expect(notices).toHaveLength(1);
        for (const n of named) expect(notices[0]).toContain(n);
        for (const n of unnamed) expect(notices[0]).not.toContain(n);
        expect(
          calls.some((c) => c.args.includes('motorfix-outage-webhook')),
        ).toBe(false);
        expect(contactPuts(calls).map((c) => c.body)).toEqual([
          point('motorfix-owner'),
          point('motorfix-outage-email'),
        ]);
        expect(puts(calls).map((c) => c.body.title)).toContain('outage');
        expect(out).toContain(
          'skipped infra/observability/grafana/alerting/contact-points.json (motorfix-outage-webhook)',
        );
        for (const value of [hook, 'staging.example.test'])
          expect(out).not.toContain(value);
      },
    );

    // @traces 1347-FR-002
    it.each<[string, Record<string, string>]>([
      ['applied', { OUTAGE_WEBHOOK_TOKEN: hook, STAGING_WEB_URL: web }],
      ['skipped', {}],
    ])(
      'drops only the hand-made outage contact point and keeps both declared ones when the webhook is %s',
      (_, env) => {
        const { code, calls } = apply({
          CONTACTS: JSON.stringify([
            { name: 'MotorFix owner', uid: 'motorfix-owner' },
          ]),
          FOLDER_EXISTS: '1',
          OUTAGE_CONTACTS: JSON.stringify([
            ...OUTAGE_LISTED,
            { name: 'motorfix-outage', uid: 'outage-by-hand' },
          ]),
          ...env,
        });
        expect(code).toBe(0);
        expect(deleted(calls)).toEqual(['outage-by-hand']);
      },
    );

    // @traces 1024-FR-009
    it('goes on past a refused group, names its file and fails at the end', () => {
      const { code, out, calls } = apply({
        FAIL_GROUP: 'api',
        FOLDER_EXISTS: '1',
      });
      expect(code).not.toBe(0);
      expect(puts(calls)).toHaveLength(3);
      expect(out).toMatch(/::error::.*api\.json/);
      expect(out.match(/applied infra\/observability\/alerts/g)).toHaveLength(
        2,
      );
      expect(out).not.toContain(token);
    });
  });

  // @traces 1024-FR-012
  // @traces 880-FR-014
  it('the new files hold no address or token, only the names', () => {
    for (const body of [
      ...OWN.map((f) => readFileSync(join(alertsDir, f), 'utf8')),
      ...['contact-points.json', 'policies.json'].map((f) =>
        readFileSync(join(alertingDir, f), 'utf8'),
      ),
      text(),
    ]) {
      expect(body).not.toMatch(/https?:\/\/(?!github\.com)|glsa_|glc_/);
    }
  });
});

describe('the observability README', () => {
  const readme = readFileSync(
    join(root, 'infra', 'observability', 'README.md'),
    'utf8',
  );

  // @traces 1024-FR-011
  // @traces 880-FR-015
  // @traces 1347-FR-004
  it('says where the rules live, whom they notify and how they reach Grafana', () => {
    const section = readme.slice(
      readme.indexOf('## Alert rules'),
      readme.indexOf('\n## ', readme.indexOf('## Alert rules') + 1),
    );
    for (const fact of [
      'infra/observability/alerts/',
      ...OWN,
      'folder `MotorFix`',
      '`MotorFix owner`',
      'Grafana alerts',
      'workflow_dispatch',
      'GRAFANA_SA_TOKEN',
      'GRAFANA_URL',
      'overwritten by the next run',
      'infra/observability/grafana/alerting/',
      'contact-points.json',
      'policies.json',
      '`runbook`',
      'postgres-outbox-stuck',
      'api-search-latency',
      'worker-queue-growing',
      'mcp-memory',
      'staging',
      'mute',
      '`motorfix-outage`',
      'motorfix-outage-email',
      'motorfix-outage-webhook',
      'keeps every uid',
    ]) {
      expect([fact, section.includes(fact)]).toEqual([fact, true]);
    }
    expect(readme).not.toMatch(/ST-\d+ adds them/);
  });
});
