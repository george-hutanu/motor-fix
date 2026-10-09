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
    ).entries.find((e: { name: string }) => e.name === 'keycloak');
    expect(keycloak.alerts).toEqual([rule?.uid]);
  });
});
