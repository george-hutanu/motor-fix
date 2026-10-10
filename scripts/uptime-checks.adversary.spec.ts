import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', 'infra', 'observability');
const text = (file: string) => readFileSync(join(root, file), 'utf8');
const load = (file: string) => JSON.parse(text(file));

// @traces 251-FR-002
describe('the uptime checks file', () => {
  const file = load('uptime/checks.json');

  it('holds exactly the two checks with distinct jobs', () => {
    expect(file.checks.map((c: { job: string }) => c.job)).toEqual([
      'motorfix-web',
      'motorfix-api',
    ]);
  });

  it('keeps the budget of 100000 monthly executions', () => {
    expect(file.checks.length * 43200).toBeLessThanOrEqual(100000);
  });

  it('names no real address, only the placeholder', () => {
    expect(text('uptime/checks.json')).not.toMatch(/https?:\/\/(?!\{)/);
    for (const c of file.checks)
      expect(c.target).toMatch(/^\{PUBLIC_WEB_URL\}\//);
  });

  it('checks from a single EU probe over IPv4 for status 200 only', () => {
    for (const c of file.checks) {
      expect(c.probes).toEqual(['Frankfurt']);
      expect(c.enabled).toBe(true);
      expect(c.settings.http.validStatusCodes).toEqual([200]);
      expect(c.settings.http.method).toBe('GET');
    }
  });

  it('times out well inside the minute between runs', () => {
    for (const c of file.checks) {
      expect(c.timeout).toBeLessThan(c.frequency);
      expect(c.frequency).toBe(60000);
      expect(c.timeout).toBe(10000);
    }
  });

  it('labels each check with its service and nothing else', () => {
    expect(file.checks.map((c: { labels: unknown }) => c.labels)).toEqual([
      [{ name: 'service', value: 'web' }],
      [{ name: 'service', value: 'api' }],
    ]);
  });

  it('carries no token or password field', () => {
    expect(text('uptime/checks.json')).not.toMatch(
      /token|password|secret|authorization|basicAuth/i,
    );
  });
});

// @traces 251-FR-003
describe('the outage rule file', () => {
  const group = load('alerts/outage.json').groups[0];
  const rule = group.rules[0];

  it('holds one group with one rule', () => {
    expect(load('alerts/outage.json').groups).toHaveLength(1);
    expect(group.name).toBe('outage');
    expect(group.rules).toHaveLength(1);
    expect(rule.uid).toBe('outage');
  });

  it('fires on the first evaluation and says nothing about missing data', () => {
    expect(rule.for).toBe('0s');
    expect(rule.noDataState).toBe('OK');
    expect(rule.execErrState).toBe('Error');
    expect(group.interval).toBe('1m');
  });

  it('routes straight to the outage receiver', () => {
    expect(rule.notification_settings.receiver).toBe('motorfix-outage');
  });

  it('labels the alert for the webhook', () => {
    expect(rule.labels.outage).toBe('true');
    expect(rule.labels.service).toBe('{{ $labels.service }}');
    expect(rule.annotations.dashboard_uid).toBe('motorfix-overview');
  });

  it('queries only probe_success of the two jobs', () => {
    const a = rule.data.find((d: { refId: string }) => d.refId === 'A');
    expect(a.datasourceUid).toBe('grafanacloud-prom');
    expect(a.model.instant).toBe(true);
    expect(a.model.expr).toBe(
      'label_replace(min by (job) (max_over_time(probe_success{job=~"motorfix-(web|api)"}[3m])), "service", "$1", "job", "motorfix-(.+)")',
    );
  });

  it('alerts when the threshold is below 1', () => {
    const b = rule.data.find((d: { refId: string }) => d.refId === 'B');
    expect(rule.condition).toBe('B');
    expect(b.model.conditions[0].evaluator).toEqual({
      params: [1],
      type: 'lt',
    });
  });

  it('shares no rule uid with another alert file', () => {
    const others = load('alerts/mcp.json').groups.flatMap(
      (g: { rules: { uid: string }[] }) => g.rules.map((r) => r.uid),
    );
    expect(others).not.toContain('outage');
  });

  it('is not matched by the threshold rules: none of them carries the outage label', () => {
    for (const g of load('alerts/mcp.json').groups) {
      for (const r of g.rules) {
        expect(r.labels?.outage).toBeUndefined();
      }
    }
  });

  it('names no e-mail address or token', () => {
    expect(text('alerts/outage.json')).not.toMatch(
      /@[a-z0-9-]+\.[a-z]{2,}|Bearer/i,
    );
  });
});
