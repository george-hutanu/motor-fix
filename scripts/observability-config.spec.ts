// @traces 875-FR-004 875-FR-007 875-FR-008
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (...path: string[]) => readFileSync(join(root, ...path), 'utf8');
const NAMES = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
];

describe('observability configuration', () => {
  const example = read('.env.example');

  it.each(NAMES)('.env.example names %s with no value', (name) => {
    expect(example).toMatch(new RegExp(`^${name}=$`, 'm'));
  });

  it('.env.example points at Grafana Cloud and the local profile', () => {
    expect(example).toContain('otlp-gateway-prod-eu-west-2.grafana.net/otlp');
    expect(example).toContain('http://localhost:4318');
  });

  it('commits no Grafana Cloud credential', () => {
    for (const text of [example, read('infra', 'observability', 'README.md')]) {
      expect(text).not.toMatch(/Basic(%20| )[A-Za-z0-9+/=]{8,}/);
      expect(text).not.toMatch(/glc_\w/);
    }
  });

  it('deploys only the apps to Railway, nothing for observability', () => {
    expect(read('scripts', 'railway-deploy.ts')).toContain(
      "services: ['api', 'worker', 'web']",
    );
  });

  // @traces 879-FR-016
  it('the README fixes where dashboards and alerts live and the free-tier budget', () => {
    const readme = read('infra', 'observability', 'README.md');

    for (const fact of [
      'infra/observability/grafana/dashboards/',
      'infra/observability/alerts/',
      '10k active series',
      '50 GB a month',
      '14 days',
      '20% of traces',
      'Low-cardinality labels',
      '$0 a month',
    ]) {
      expect(readme).toContain(fact);
    }
  });
});

describe('the MCP server and its identity server', () => {
  it('alerts on failed signing-key fetches and lists that alert for the identity server', () => {
    const rules = JSON.parse(
      read('infra', 'observability', 'alerts', 'mcp.json'),
    ).groups.flatMap((g: { rules: unknown[] }) => g.rules) as {
      uid: string;
      data: { model: { expr?: string } }[];
    }[];
    const rule = rules.find((r) =>
      r.data.some((d) =>
        /mcp_key_fetches_total\{[^}]*outcome="error"/.test(d.model.expr ?? ''),
      ),
    );
    expect(rule).toBeDefined();
    const keycloak = JSON.parse(
      read('infra', 'observability', 'inventory.json'),
    ).entries.find(
      (e: { kind: string; name: string }) =>
        e.kind === 'outside-service' && e.name === 'keycloak',
    );
    expect(keycloak.alerts).toEqual([rule?.uid, 'mcp-issuer-unreachable']);
  });
});

describe('the identity server itself', () => {
  // @traces 1178-FR-010
  it('lists its memory alert and the overview dashboard on its Railway service, and the worker reading', () => {
    const service = JSON.parse(
      read('infra', 'observability', 'inventory.json'),
    ).entries.find(
      (e: { kind: string; name: string }) =>
        e.kind === 'railway-service' && e.name === 'keycloak',
    );
    expect(service).toMatchObject({
      alerts: ['mcp-issuer-unreachable', 'keycloak-memory'],
      dashboard: 'motorfix-overview',
    });
    expect(service.reason).toContain('KEYCLOAK_METRICS_URL');
  });
});

describe('the verification result queue', () => {
  // @traces 209-FR-014
  it('alerts on its final job failures, shows its counter on the queues dashboard and lists both', () => {
    const rules = JSON.parse(
      read('infra', 'observability', 'alerts', 'notifications.json'),
    ).groups.flatMap((g: { rules: unknown[] }) => g.rules) as {
      uid: string;
      annotations: { dashboard_uid: string };
      data: { model: { expr?: string } }[];
    }[];
    const rule = rules.find((r) =>
      r.data.some((d) =>
        /motorfix_jobs_total\{[^}]*queue="verification-result"[^}]*outcome="failed"/.test(
          d.model.expr ?? '',
        ),
      ),
    );
    expect(rule?.annotations.dashboard_uid).toBe('motorfix-queues');

    const dashboard = read(
      'infra',
      'observability',
      'grafana',
      'dashboards',
      'motorfix-queues.json',
    );
    expect(dashboard).toContain('motorfix_verification_result_total');

    const queue = JSON.parse(
      read('infra', 'observability', 'inventory.json'),
    ).entries.find(
      (e: { kind: string; name: string }) =>
        e.kind === 'queue' && e.name === 'verification-result',
    );
    expect(queue).toMatchObject({
      alerts: [rule?.uid],
      dashboard: 'motorfix-queues',
    });
  });
});

// @traces 305-FR-009
describe('the garage rejections', () => {
  it('alert on a burst of more than five in an hour, show on the product dashboard and are listed', () => {
    const rules = JSON.parse(
      read('infra', 'observability', 'alerts', 'verification.json'),
    ).groups.flatMap((g: { rules: unknown[] }) => g.rules) as {
      uid: string;
      for: string;
      annotations: { dashboard_uid: string };
      data: {
        model: { expr?: string; conditions?: { evaluator: unknown }[] };
      }[];
    }[];
    const rule = rules.find((r) => r.uid === 'verification-rejection-burst');
    expect(rule?.annotations.dashboard_uid).toBe('motorfix-product');
    expect(rule?.data[0]?.model.expr).toMatch(
      /^sum by \(deployment_environment\) \(increase\(motorfix_verification_rejections_total\{[^}]*\}\[1h\]\)\)$/,
    );
    expect(rule?.data[1]?.model.conditions?.[0]?.evaluator).toEqual({
      params: [5],
      type: 'gt',
    });

    const dashboard = JSON.parse(
      read(
        'infra',
        'observability',
        'grafana',
        'dashboards',
        'motorfix-product.json',
      ),
    ) as { panels: { title?: string; targets?: { expr: string }[] }[] };
    const titles = dashboard.panels.map((p) => p.title);
    expect(titles).toContain('Garage rejections');
    expect(
      dashboard.panels.filter((p) =>
        (p.targets ?? []).some((t) =>
          t.expr.includes('motorfix_verification_rejections_total'),
        ),
      ).length,
    ).toBeGreaterThanOrEqual(3);

    const counter = JSON.parse(
      read('infra', 'observability', 'inventory.json'),
    ).entries.find(
      (e: { kind: string; name: string }) =>
        e.kind === 'product-counter' &&
        e.name === 'motorfix_verification_rejections_total',
    );
    expect(counter).toMatchObject({
      alerts: ['verification-rejection-burst'],
      dashboard: 'motorfix-product',
    });
  });
});

// @traces 304-FR-012
describe('the requests for more and the files returned', () => {
  it('alert on a burst of more than five requests in an hour, show on the product dashboard and are listed', () => {
    const rules = JSON.parse(
      read('infra', 'observability', 'alerts', 'verification.json'),
    ).groups.flatMap((g: { rules: unknown[] }) => g.rules) as {
      uid: string;
      for: string;
      annotations: { dashboard_uid: string; runbook?: string };
      data: {
        model: { expr?: string; conditions?: { evaluator: unknown }[] };
      }[];
    }[];
    const rule = rules.find((r) => r.uid === 'verification-more-request-burst');
    expect(rule?.for).toBe('0s');
    expect(rule?.annotations.dashboard_uid).toBe('motorfix-product');
    expect(rule?.annotations.runbook).toContain(
      'Requests for more and files returned',
    );
    expect(rule?.data[0]?.model.expr).toMatch(
      /^sum by \(deployment_environment\) \(increase\(motorfix_verification_more_requests_total\{[^}]*\}\[1h\]\)\)$/,
    );
    expect(rule?.data[1]?.model.conditions?.[0]?.evaluator).toEqual({
      params: [5],
      type: 'gt',
    });

    const dashboard = JSON.parse(
      read(
        'infra',
        'observability',
        'grafana',
        'dashboards',
        'motorfix-product.json',
      ),
    ) as { panels: { title?: string; targets?: { expr: string }[] }[] };
    expect(dashboard.panels.map((p) => p.title)).toContain(
      'Requests for more and files returned',
    );
    for (const counter of [
      'motorfix_verification_more_requests_total',
      'motorfix_verification_resubmissions_total',
    ]) {
      expect(
        dashboard.panels.filter((p) =>
          (p.targets ?? []).some((t) => t.expr.includes(counter)),
        ).length,
      ).toBeGreaterThanOrEqual(3);
    }

    const entries = JSON.parse(read('infra', 'observability', 'inventory.json'))
      .entries as { kind: string; name: string }[];
    expect(
      entries.find(
        (e) =>
          e.kind === 'product-counter' &&
          e.name === 'motorfix_verification_more_requests_total',
      ),
    ).toMatchObject({
      alerts: ['verification-more-request-burst'],
      dashboard: 'motorfix-product',
    });
    expect(
      entries.find(
        (e) =>
          e.kind === 'product-counter' &&
          e.name === 'motorfix_verification_resubmissions_total',
      ),
    ).toMatchObject({ dashboard: 'motorfix-product' });
  });
});

// @traces 1183-FR-006
describe('the garage profile latency', () => {
  const ROUTE = 'http_route="/api/v1/garages/:slug"';

  it('has a p95 panel and an alert above 300 ms for 10 minutes, both listed', () => {
    const panels = JSON.parse(
      read(
        'infra',
        'observability',
        'grafana',
        'dashboards',
        'motorfix-api.json',
      ),
    ).panels as { title?: string; targets?: { expr?: string }[] }[];
    const panel = panels.find(
      (p) => p.title === 'Profile p95 (alert above 300 ms)',
    );
    expect(panel?.targets?.some((t) => t.expr?.includes(ROUTE))).toBe(true);

    const rule = (
      JSON.parse(
        read('infra', 'observability', 'alerts', 'api.json'),
      ).groups.flatMap((g: { rules: unknown[] }) => g.rules) as {
        uid: string;
        for: string;
        data: {
          model: {
            expr?: string;
            conditions?: { evaluator: { type: string; params: number[] } }[];
          };
        }[];
      }[]
    ).find((r) => r.uid === 'api-profile-latency');
    expect(rule?.for).toBe('10m');
    expect(rule?.data.some((d) => d.model.expr?.includes(ROUTE))).toBe(true);
    expect(
      rule?.data.flatMap((d) => d.model.conditions ?? [])[0]?.evaluator,
    ).toEqual({ params: [0.3], type: 'gt' });

    const entries = JSON.parse(read('infra', 'observability', 'inventory.json'))
      .entries as { kind: string; name: string; alerts?: string[] }[];
    const alertsOf = (kind: string, name: string) =>
      entries.find((e) => e.kind === kind && e.name === name)?.alerts;
    expect(alertsOf('app', 'api')).toContain('api-profile-latency');
    expect(alertsOf('railway-service', 'api')).toContain('api-profile-latency');
    expect(alertsOf('endpoint', 'public-garage-profile')).toContain(
      'api-profile-latency',
    );
  });
});

// @traces 1345-FR-015
describe('the Error % panels', () => {
  type Panel = {
    title?: string;
    panels?: Panel[];
    targets?: { expr: string; legendFormat?: string }[];
  };
  const flatten = (panels: Panel[]): Panel[] =>
    panels.flatMap((panel) => [panel, ...flatten(panel.panels ?? [])]);
  const targets = ['api', 'web', 'worker', 'mcp', 'overview'].flatMap((name) =>
    flatten(
      JSON.parse(
        read(
          'infra',
          'observability',
          'grafana',
          'dashboards',
          `motorfix-${name}.json`,
        ),
      ).panels,
    )
      .filter((panel) => panel.title === 'Error %')
      .flatMap((panel) => panel.targets ?? []),
  );
  const exprs = targets.map((target) => target.expr.replace(/\s+/g, ' '));

  it('label a failed-job share "failed %" and only an HTTP share "5xx %"', () => {
    expect(targets).toHaveLength(8);
    for (const target of targets) {
      const jobs = target.expr.includes('motorfix_jobs_total');
      expect([target.expr.slice(0, 60), target.legendFormat]).toEqual([
        target.expr.slice(0, 60),
        jobs ? 'failed %' : '5xx %',
      ]);
    }
  });

  it('show 0 rather than no value when nothing failed', () => {
    expect(exprs).toHaveLength(8);
    for (const expr of exprs) {
      expect(expr).toMatch(
        /^100 \* \(sum\(rate\(.+\)\) or vector\(0\)\) \/ sum\(rate\(.+\)\)$/,
      );
    }
  });
});

// @traces 1345-FR-020
describe('the observability README after the staging review', () => {
  const readme = read('infra', 'observability', 'README.md');
  const section = (title: string) => {
    const start = readme.indexOf(`\n## ${title}\n`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = readme.indexOf('\n## ', start + 1);
    return readme.slice(start, end === -1 ? undefined : end);
  };

  it('names the two start-up warnings and the variable each one wants', () => {
    const configuration = section('Configuration');

    for (const fact of [
      'datastore metrics: MONITOR_DATABASE_URL unset, PostgreSQL readings off',
      'browser telemetry off: FARO_URL unset',
    ]) {
      expect(configuration).toContain(fact);
    }
  });

  it('says which alert rules fire on missing data', () => {
    const alerts = section('Alert rules');

    expect(alerts).toMatch(/\|\s*No data\s*\|/);
    for (const uid of [
      'postgres-unreachable',
      'redis-unreachable',
      'worker-queue-backlog',
    ]) {
      expect(alerts).toContain(uid);
    }
  });

  it('records the product counters at 0 and the three that cannot fire on staging', () => {
    const counters = section('Product counters');

    for (const fact of [
      'at 0',
      'motorfix_garage_approvals_total',
      'motorfix_verification_result_total',
      'motorfix_documents_opened_total',
      'motorfix_decline_windows_closed_total',
    ]) {
      expect(counters).toContain(fact);
    }
  });

  // @traces 1345-FR-016 1345-FR-017
  it('records why the failed-job counter keeps its version and why one failed job stays', () => {
    for (const fact of [
      'motorfix_queue_failed_total',
      'service_version',
      'target_info',
      'max by (queue)',
      'removeOnFail: 1000',
    ]) {
      expect(readme).toContain(fact);
    }
  });

  // @traces 1345-FR-003 1345-FR-019
  it('lists the owner steps with the variables to set', () => {
    const steps = section('Owner steps');

    for (const fact of [
      'MONITOR_DATABASE_URL',
      'FARO_URL',
      'GEOAPIFY_API_KEY',
      'notifications',
    ]) {
      expect(steps).toContain(fact);
    }
  });

  it('notes in the inventory the counters that cannot fire on staging', () => {
    const entries = JSON.parse(read('infra', 'observability', 'inventory.json'))
      .entries as { kind: string; name: string; reason: string }[];

    for (const name of ['motorfix_documents_opened_total']) {
      expect(
        entries.find(
          (entry) => entry.kind === 'product-counter' && entry.name === name,
        )?.reason,
      ).toContain('cannot fire on staging');
    }
  });
});
