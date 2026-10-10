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
      'clamp_min(max by (deployment_environment) (motorfix_redis_memory_max_bytes), 268435456)',
    ],
    for: '5m',
    from: 300,
    type: 'gt',
    value: 0.8,
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
  'worker-saturation': {
    expr: ['nodejs_eventloop_delay_p99_seconds{service_name="worker"}'],
    for: '5m',
    from: 300,
    type: 'gt',
    value: 0.5,
  },
};
const QUEUE_RULES = ['worker-queue-backlog', 'worker-jobs-failed'];

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

/** Every way the alert files break the rules this repository holds them to. */
function problems(files: Files, known = dashboardMetrics()): string[] {
  const found = groupProblems(files);
  const all = rows(files);
  const seen = new Map<string, string>();
  for (const [name, at, group, rule] of all) {
    const other = seen.get(rule.uid);
    if (other) found.push(`${at}: uid also in ${other}`);
    seen.set(rule.uid, name);
    if (OWN.includes(name))
      found.push(...ruleProblems(at, group.name as Service, rule, known));
  }
  if (all.length > 50) found.push(`${all.length} rules in all; at most 50`);
  return found;
}

// The token as the script spells it.
const TOKEN = '$' + '{GRAFANA_SA_TOKEN}';
const ENVIRONMENT = '{{ $labels.deployment_environment }}';

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
  ['noDataState must be OK', (r) => r.noDataState === 'OK'],
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
    'receiver must be MotorFix owner',
    (r) => r.notification_settings?.receiver === 'MotorFix owner',
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
  it('every file breaks none of the rules', () => {
    expect(problems(files)).toEqual([]);
  });

  // @traces 1024-FR-002
  // @traces 1024-FR-003
  // @traces 1024-FR-004
  // @traces 1024-FR-005
  // @traces 1024-FR-006
  // @traces 1024-FR-007
  it('holds exactly the sixteen rules, each with its threshold, window and wait', () => {
    const rules = OWN.flatMap((name) =>
      files[name] ? rulesOf(files[name]) : [],
    );
    expect(rules.map((r) => r.uid).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );

    for (const rule of rules) {
      const want = EXPECTED[rule.uid];
      expect([rule.uid, threshold(rule)]).toEqual([
        rule.uid,
        { params: [want?.value], type: want?.type },
      ]);
      expect([rule.uid, rule.for, query(rule)?.relativeTimeRange.from]).toEqual(
        [rule.uid, want?.for, want?.from],
      );
      for (const fragment of want?.expr ?? []) {
        expect([rule.uid, query(rule)?.model.expr]).toEqual([
          rule.uid,
          expect.stringContaining(fragment),
        ]);
      }
    }
  });

  // @traces 1024-FR-005
  it('names the queue in the summary of the per-queue rules', () => {
    for (const uid of QUEUE_RULES) {
      const rule = rulesOf(own('worker') as AlertFile).find(
        (r) => r.uid === uid,
      );
      expect(rule?.annotations['summary']).toContain('{{ $labels.queue }}');
    }
  });

  // @traces 1024-FR-010
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
        'no receiver',
        (f) => {
          delete first(f).notification_settings;
        },
        /api\.json api-\S+: receiver must be MotorFix owner/,
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

  // @traces 1024-FR-008
  it('every rule of the five files is listed, and no reason still waits for a later story', () => {
    const listed = new Set(
      inventory.entries.flatMap((e) =>
        Array.isArray(e.alerts) ? e.alerts : [],
      ),
    );
    for (const uid of Object.keys(EXPECTED))
      expect([uid, listed.has(uid)]).toEqual([uid, true]);
    const waiting = inventory.entries.filter((e) =>
      /ST-\d+ adds the (?:queue )?alert/.test(e.reason ?? ''),
    );
    expect(waiting.map((e) => `${e.kind} ${e.name}`)).toEqual([]);
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
  it('runs on a push to main that changes the alerts or itself, and by hand', () => {
    expect(text()).toMatch(/^name: Grafana alerts$/m);
    const on = block(text(), 'on', 0);
    expect(on).toMatch(/branches: \[main\]/);
    expect(on).toContain("'infra/observability/alerts/**'");
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
      // Logs each call's arguments and request body; refuses a group named in
      // FAIL_GROUP and answers 404 for the folder unless FOLDER_EXISTS is set.
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
          'case "$*" in',
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
            FAIL_GROUP: '',
            FOLDER_EXISTS: '',
            GRAFANA_SA_TOKEN: token,
            GRAFANA_URL: url,
            PATH: `${join(dir, 'bin')}:${process.env['PATH']}`,
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
      expect(out.match(/applied/g)).toHaveLength(3);
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

    // @traces 1024-FR-009
    it('goes on past a refused group, names its file and fails at the end', () => {
      const { code, out, calls } = apply({
        FAIL_GROUP: 'api',
        FOLDER_EXISTS: '1',
      });
      expect(code).not.toBe(0);
      expect(puts(calls)).toHaveLength(3);
      expect(out).toMatch(/::error::.*api\.json/);
      expect(out.match(/applied/g)).toHaveLength(2);
      expect(out).not.toContain(token);
    });
  });

  // @traces 1024-FR-012
  it('the new files hold no address or token, only the names', () => {
    for (const body of [
      ...OWN.map((f) => readFileSync(join(alertsDir, f), 'utf8')),
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
    ]) {
      expect([fact, section.includes(fact)]).toEqual([fact, true]);
    }
    expect(readme).not.toMatch(/ST-\d+ adds them/);
  });
});
