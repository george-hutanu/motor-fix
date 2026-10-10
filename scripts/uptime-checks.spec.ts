import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, '..', 'infra', 'observability');
const json = (...path: string[]) =>
  JSON.parse(readFileSync(join(dir, ...path), 'utf8'));

interface Check {
  job: string;
  target: string;
  frequency: number;
  timeout: number;
  probes: string[];
  labels: { name: string; value: string }[];
  settings: { http: { method: string; validStatusCodes: number[] } };
}

// Grafana Cloud's free tier allows 100,000 check runs a month; one probe
// every minute is 43,200 runs a month per check.
const FREE_RUNS = 100_000;
const RUNS_PER_CHECK = 43_200;

// @traces 251-FR-002
describe('the uptime checks', () => {
  const { checks } = json('uptime', 'checks.json') as { checks: Check[] };
  const byService = (service: string) =>
    checks.find((c) =>
      c.labels.some((l) => l.name === 'service' && l.value === service),
    );

  it('checks Home and the readiness of the API behind it', () => {
    expect(checks).toHaveLength(2);
    expect(byService('web')?.job).toBe('motorfix-web');
    expect(byService('web')?.target).toMatch(/^\{PUBLIC_WEB_URL\}\/$/);
    expect(byService('api')?.job).toBe('motorfix-api');
    expect(byService('api')?.target).toMatch(
      /^\{PUBLIC_WEB_URL\}\/health\/ready$/,
    );
  });

  it.each(['web', 'api'])(
    'runs the %s check every minute from one probe, failing after 10 seconds or on anything but 200',
    (service) => {
      const check = byService(service);
      expect(check).toMatchObject({ frequency: 60_000, timeout: 10_000 });
      expect(check?.probes).toHaveLength(1);
      expect(check?.settings.http).toMatchObject({
        method: 'GET',
        validStatusCodes: [200],
      });
    },
  );

  it('stays inside the free tier', () => {
    const runs = checks.reduce(
      (sum, c) =>
        sum + c.probes.length * RUNS_PER_CHECK * (60_000 / c.frequency),
      0,
    );
    expect(runs).toBe(86_400);
    expect(runs).toBeLessThan(FREE_RUNS);
  });
});

// @traces 251-FR-003
describe('the outage rule', () => {
  const file = json('alerts', 'outage.json');
  const [group] = file.groups;
  const [rule] = group.rules;
  const query = rule.data.find((d: { refId: string }) => d.refId === 'A').model
    .expr as string;

  it('is evaluated every minute and fires on the first failing evaluation', () => {
    expect(group).toMatchObject({
      folder: 'MotorFix',
      interval: '1m',
      name: 'outage',
    });
    expect(group.rules).toHaveLength(1);
    expect(rule).toMatchObject({ for: '0s', noDataState: 'OK', uid: 'outage' });
  });

  it('marks its alerts as outages, one per service, sent to the outage webhook', () => {
    expect(rule.labels).toEqual({
      outage: 'true',
      service: '{{ $labels.service }}',
    });
    expect(rule.notification_settings.receiver).toBe('motorfix-outage');
  });

  it('reads only the two uptime checks', () => {
    expect(query).toContain('probe_success');
    // Synthetic Monitoring writes a check's own label as label_service, so
    // the rule groups by job and names the service from it.
    expect(query).toContain('by (job)');
    expect(query).toContain('label_replace(');
    expect(query).toContain('"service", "$1", "job", "motorfix-(.+)"');
    const jobs = query.match(/job=~"([^"]+)"/)?.[1];
    expect(jobs).toBe('motorfix-(web|api)');
  });

  it('is the only rule that marks an outage', () => {
    expect(readFileSync(join(dir, 'alerts', 'mcp.json'), 'utf8')).not.toMatch(
      /"outage"/,
    );
  });
});

// @traces 251-FR-004
describe('the outage setup steps', () => {
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  const section = readme.slice(
    readme.indexOf('## Uptime checks and the outage alert'),
  );

  it('name the checks, the rule, the contact point and the token by name, and the by-hand admin list', () => {
    const [group] = json('alerts', 'outage.json').groups;
    const receiver = group.rules[0].notification_settings.receiver;

    expect(section).toContain('uptime/checks.json');
    expect(section).toContain('alerts/outage.json');
    expect(section).toContain(receiver);
    expect(section).toContain('OUTAGE_WEBHOOK_TOKEN');
    expect(section).toMatch(/by hand when an admin joins or leaves/);
  });
});

// @traces 251-FR-009
describe('the outage webhook in the inventory', () => {
  it('lists the endpoint with its panel and the outage alert', () => {
    const { entries } = json('inventory.json') as {
      entries: { source?: string; dashboard?: string; alerts?: string[] }[];
    };
    const entry = entries.find((e) =>
      e.source?.endsWith('notifications/outage/outage.controller.ts'),
    );
    const [group] = json('alerts', 'outage.json').groups;

    expect(entry?.dashboard).toBe('motorfix-api');
    expect(entry?.alerts).toContain(group.rules[0].uid);
  });
});
