import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { read, script } from './workflow-text.ts';

const root = join(__dirname, '..');
const alertsDir = join(root, 'infra', 'observability', 'alerts');
const dashboardsDir = join(
  root,
  'infra',
  'observability',
  'grafana',
  'dashboards',
);

type Rule = {
  uid: string;
  title: string;
  annotations: Record<string, string>;
  data: {
    refId: string;
    relativeTimeRange: { from: number; to: number };
    model: { expr?: string };
  }[];
};
type Group = { name: string; interval: string; rules: Rule[] };
type AlertFile = { groups: Group[] };

const files = readdirSync(alertsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({
    json: JSON.parse(readFileSync(join(alertsDir, f), 'utf8')) as AlertFile,
    name: f,
  }));
const OWN = ['api', 'worker', 'web', 'postgres', 'redis'].map(
  (s) => `${s}.json`,
);
const ownRules = files
  .filter((f) => OWN.includes(f.name))
  .flatMap((f) => f.json.groups.flatMap((g) => g.rules));
const exprOf = (r: Rule) =>
  r.data.find((q) => q.refId === 'A')?.model.expr ?? '';
const dashboardText = readdirSync(dashboardsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => readFileSync(join(dashboardsDir, f), 'utf8'))
  .join('\n');

const SECONDS: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
const longestWindow = (expr: string) =>
  Math.max(
    0,
    ...[...expr.matchAll(/\[(\d+)([smhd])\]/g)].map(
      (m) => Number(m[1]) * (SECONDS[m[2] as string] as number),
    ),
  );

const byLabels = (expr: string) =>
  [...expr.matchAll(/\bby \(([^)]*)\)/g)].flatMap((m) =>
    (m[1] as string).split(',').map((l) => l.trim()),
  );
const matcherLabels = (expr: string) =>
  [...expr.matchAll(/\{([^}]*)\}/g)].flatMap((sel) =>
    [...(sel[1] as string).matchAll(/(\w+)\s*(?:=~|!=|!~|=)/g)].map(
      (m) => m[1] as string,
    ),
  );
const summaryLabels = (rule: Rule) =>
  [
    ...(rule.annotations['summary'] ?? '').matchAll(
      /\{\{\s*\$labels\.(\w+)\s*\}\}/g,
    ),
  ].map((m) => m[1] as string);

describe('alert rule queries', () => {
  // @traces 1024-FR-001
  it('only match labels that the dashboards query, so no selector silently matches nothing', () => {
    const used = new Set(
      ownRules.flatMap((r) => [
        ...matcherLabels(exprOf(r)),
        ...byLabels(exprOf(r)),
      ]),
    );
    const unknown = [...used].filter(
      (l) => l !== 'le' && !dashboardText.includes(l),
    );
    expect(unknown).toEqual([]);
  });

  // @traces 1024-FR-001
  it('only match label values that the dashboards use for the same selector', () => {
    const wanted = [
      'outcome=\\"failed\\"',
      'store=\\"postgres\\"',
      'store=\\"redis\\"',
    ];
    for (const rule of ownRules) {
      const expr = exprOf(rule);
      for (const m of expr.matchAll(/(outcome|store)="([^"]*)"/g)) {
        const asJson = `${m[1]}=\\"${m[2]}\\"`;
        expect(wanted).toContain(asJson);
        expect(dashboardText).toContain(asJson);
      }
    }
  });

  // @traces 1024-FR-001
  it('has balanced brackets and quotes in every expression', () => {
    for (const rule of ownRules) {
      const expr = exprOf(rule);
      expect(expr.length).toBeGreaterThan(0);
      for (const [open, close] of [
        ['(', ')'],
        ['{', '}'],
        ['[', ']'],
      ] as const) {
        expect([rule.uid, expr.split(open).length]).toEqual([
          rule.uid,
          expr.split(close).length,
        ]);
      }
      expect([rule.uid, (expr.match(/"/g) ?? []).length % 2]).toEqual([
        rule.uid,
        0,
      ]);
    }
  });

  // @traces 1024-FR-001
  it('reads a time range at least as long as the longest window in its query', () => {
    for (const rule of ownRules) {
      const q = rule.data.find((d) => d.refId === 'A');
      expect([
        rule.uid,
        (q?.relativeTimeRange.from ?? 0) >= longestWindow(exprOf(rule)),
      ]).toEqual([rule.uid, true]);
    }
  });

  // @traces 1024-FR-001
  it('names in each summary only labels that the query keeps', () => {
    for (const rule of ownRules) {
      const kept = byLabels(exprOf(rule));
      const missing = summaryLabels(rule).filter((l) => !kept.includes(l));
      expect([rule.uid, missing]).toEqual([rule.uid, []]);
    }
  });

  // @traces 1024-FR-001
  it('uses uids and titles Grafana accepts and keeps titles unique', () => {
    const all = files.flatMap((f) => f.json.groups.flatMap((g) => g.rules));
    for (const rule of all) {
      expect(rule.uid).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.title.length).toBeLessThanOrEqual(190);
    }
    const titles = all.map((r) => r.title);
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([]);
  });

  // @traces 1024-FR-009
  it('gives every group a name no other file uses, since a group is replaced whole', () => {
    const names = files.flatMap((f) => f.json.groups.map((g) => g.name));
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  // @traces 1024-FR-009
  it('gives every group an interval the workflow turns into whole seconds', () => {
    for (const f of files) {
      for (const g of f.json.groups) {
        expect([f.name, g.interval]).toEqual([
          f.name,
          expect.stringMatching(/^\d+m$/),
        ]);
      }
    }
  });
});

describe('Grafana alerts workflow under hostile input', () => {
  const text = read('grafana-alerts.yml');
  const step = (title: string) => {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.trim() === `- name: ${title}`);
    if (start < 0) throw new Error(`no step ${title}`);
    const indent = (lines[start] as string).search(/\S/);
    const end = lines.findIndex(
      (l, i) => i > start && l.trim() !== '' && l.search(/\S/) <= indent,
    );
    return lines.slice(start, end < 0 ? undefined : end).join('\n');
  };

  let dir: string;
  const token = 'tok-secret-value';
  const url = 'https://grafana.example.test';
  const alerts = () => join(dir, 'infra', 'observability', 'alerts');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'grafana-adv-'));
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'calls'));
    mkdirSync(alerts(), { recursive: true });
    const curl = join(dir, 'bin', 'curl');
    writeFileSync(
      curl,
      [
        '#!/usr/bin/env bash',
        'n=$(ls "$CALLS" | wc -l | tr -d " ")',
        'printf "%s\\n" "$@" > "$CALLS/$n.args"',
        'case " $* " in *" @- "*) cat > "$CALLS/$n.body";; esac',
        'case "$*" in',
        '  *"-X POST"*) [ -n "$POST_CODE" ] && { echo "$ERR_TEXT" >&2; exit "$POST_CODE"; }; exit 0;;',
        '  *"-X PUT"*) if [ -n "$PUT_CODE" ] && case "$*" in *"$PUT_MATCH"*) true;; *) false;; esac; then echo "$ERR_TEXT" >&2; exit "$PUT_CODE"; fi; exit 0;;',
        '  *) [ -n "$FOLDER_EXISTS" ] && exit 0; exit 22;;',
        'esac',
      ].join('\n'),
    );
    chmodSync(curl, 0o755);
  });
  afterEach(() => rmSync(dir, { force: true, recursive: true }));

  const put = (name: string, body: unknown) =>
    writeFileSync(
      join(alerts(), name),
      typeof body === 'string' ? body : JSON.stringify(body),
    );
  const group = (name: string, interval = '1m') => ({
    interval,
    name,
    rules: [{ title: name, uid: `${name}-r` }],
  });

  const run = (title: string, env: Record<string, string> = {}) => {
    const r = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script(step(title))],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          CALLS: join(dir, 'calls'),
          ERR_TEXT: '',
          FOLDER_EXISTS: '1',
          GRAFANA_SA_TOKEN: token,
          GRAFANA_URL: url,
          PATH: `${join(dir, 'bin')}:${process.env['PATH']}`,
          POST_CODE: '',
          PUT_CODE: '',
          PUT_MATCH: '',
          ...env,
        },
      },
    );
    const calls = readdirSync(join(dir, 'calls'))
      .filter((f) => f.endsWith('.args'))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
      .map((f) => {
        const body = join(dir, 'calls', f.replace('.args', '.body'));
        return {
          args: readFileSync(join(dir, 'calls', f), 'utf8'),
          body: existsSync(body)
            ? (JSON.parse(readFileSync(body, 'utf8')) as {
                title: string;
                interval: number;
              })
            : undefined,
        };
      });
    return { calls, code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const apply = (env?: Record<string, string>) => run('Apply the alerts', env);
  const puts = <T extends { args: string }>(calls: T[]) =>
    calls.filter((c) => c.args.includes('rule-groups/'));

  // @traces 1024-FR-009
  it('builds no double slash when the URL ends in a slash', () => {
    put('a.json', { groups: [group('a')] });
    const { code, calls } = apply({ GRAFANA_URL: `${url}/` });
    expect(code).toBe(0);
    for (const c of calls) {
      expect(c.args).not.toMatch(/example\.test\/\/api/);
    }
    expect(puts(calls)).toHaveLength(1);
  });

  // @traces 1024-FR-009
  it('builds no double slash when the URL ends in several slashes', () => {
    put('a.json', { groups: [group('a')] });
    const { calls } = apply({ GRAFANA_URL: `${url}///` });
    for (const c of calls) {
      expect(c.args).not.toMatch(/example\.test\/\/+api/);
    }
  });

  // @traces 1024-FR-009
  it('applies both groups of a file that holds two', () => {
    put('two.json', { groups: [group('one'), group('two', '5m')] });
    const { code, calls, out } = apply();
    expect(code).toBe(0);
    expect(puts(calls).map((c) => c.body?.title)).toEqual(['one', 'two']);
    expect(puts(calls).map((c) => c.body?.interval)).toEqual([60, 300]);
    expect(out.match(/applied/g)).toHaveLength(2);
  });

  // @traces 1024-FR-009
  it('percent-encodes a group name with a space or a slash in the request path', () => {
    put('odd.json', { groups: [group('my group'), group('a/b')] });
    const { calls } = apply();
    const urls = puts(calls).map(
      (c) => c.args.split('\n').find((l) => l.includes('rule-groups/')) ?? '',
    );
    expect(urls).toEqual([
      `${url}/api/v1/provisioning/folder/motorfix/rule-groups/my%20group`,
      `${url}/api/v1/provisioning/folder/motorfix/rule-groups/a%2Fb`,
    ]);
  });

  // @traces 1024-FR-009
  it('does not run a command hidden in a group name', () => {
    put('evil.json', { groups: [group('$(touch pwned)')] });
    apply();
    expect(existsSync(join(dir, 'pwned'))).toBe(false);
  });

  // @traces 1024-FR-012
  it('sends a token holding shell metacharacters verbatim and runs nothing', () => {
    put('a.json', { groups: [group('a')] });
    const odd = 'x $(touch pwned) `touch pwned2` "q"';
    const { calls } = apply({ GRAFANA_SA_TOKEN: odd });
    expect(calls[0]?.args).toContain(`Authorization: Bearer ${odd}`);
    expect(existsSync(join(dir, 'pwned'))).toBe(false);
    expect(existsSync(join(dir, 'pwned2'))).toBe(false);
  });

  // @traces 1024-FR-009
  it('fails the step when the folder cannot be created and applies no group', () => {
    put('a.json', { groups: [group('a')] });
    const { code, calls, out } = apply({
      ERR_TEXT: 'curl: (22) The requested URL returned error: 403',
      FOLDER_EXISTS: '',
      POST_CODE: '22',
    });
    expect(code).not.toBe(0);
    expect(puts(calls)).toHaveLength(0);
    expect(out).not.toMatch(/applied/);
  });

  // @traces 1024-FR-009
  it('fails the step and names the file when a call times out', () => {
    put('slow.json', { groups: [group('slow')] });
    put('fast.json', { groups: [group('fast')] });
    const { code, out, calls } = apply({
      ERR_TEXT: 'curl: (28) Operation timed out after 60001 milliseconds',
      PUT_CODE: '28',
      PUT_MATCH: 'rule-groups/slow',
    });
    expect(code).not.toBe(0);
    expect(out).toMatch(/::error::.*slow\.json/);
    expect(out).toMatch(
      /slow\.json: Grafana refused group slow \(exit code 28\)/,
    );
    expect(puts(calls)).toHaveLength(2);
  });

  // @traces 1024-FR-012
  it('prints neither the URL nor the token when curl reports a failure that names the host', () => {
    put('a.json', { groups: [group('a')] });
    const { out } = apply({
      ERR_TEXT: `curl: (6) Could not resolve host: grafana.example.test`,
      PUT_CODE: '6',
      PUT_MATCH: 'rule-groups',
    });
    expect(out).not.toContain('grafana.example.test');
    expect(out).not.toContain(token);
  });

  // @traces 1024-FR-009
  it('fails the step on a file that is not valid JSON and still applies the others', () => {
    put('broken.json', '{ "groups": [ ');
    put('good.json', { groups: [group('good')] });
    const { code, out, calls } = apply();
    expect(code).not.toBe(0);
    expect(out).toMatch(/broken\.json/);
    expect(puts(calls).map((c) => c.body?.title)).toEqual(['good']);
  });

  // @traces 1024-FR-009
  it('fails the step on a file without a groups list', () => {
    put('nogroups.json', { apiVersion: 1 });
    const { code, out } = apply();
    expect([code !== 0, /nogroups\.json/.test(out)]).toEqual([true, true]);
  });

  // @traces 1024-FR-009
  it('says so, or fails, when the alerts directory holds no file', () => {
    const { code, out, calls } = apply();
    expect(puts(calls)).toHaveLength(0);
    expect([code !== 0 || /no .*(alert|file|rule)|nothing/i.test(out)]).toEqual(
      [true],
    );
  });

  // @traces 1024-FR-009
  it('converts an interval in hours or fails, never sends a non-number', () => {
    put('h.json', { groups: [group('h', '1h')] });
    const { code, calls } = apply();
    const sent = puts(calls)[0]?.body?.interval;
    expect(code !== 0 || sent === 3600).toBe(true);
  });

  // @traces 1024-FR-009
  it('refuses two files that declare the same group, since the second would wipe the first', () => {
    put('a.json', { groups: [group('same')] });
    put('b.json', { groups: [group('same')] });
    const { code } = apply();
    expect(code).not.toBe(0);
  });

  // @traces 1024-FR-009
  it('sends the same calls on a second run', () => {
    put('a.json', { groups: [group('a'), group('b')] });
    const first = apply().calls.map((c) => c.args);
    rmSync(join(dir, 'calls'), { recursive: true });
    mkdirSync(join(dir, 'calls'));
    const second = apply().calls.map((c) => c.args);
    expect(second).toEqual(first);
  });

  // @traces 1024-FR-009
  it('ignores a file that is not .json', () => {
    put('notes.md', '# not json');
    put('a.json', { groups: [group('a')] });
    const { code, calls } = apply();
    expect(code).toBe(0);
    expect(puts(calls)).toHaveLength(1);
  });

  describe('the skip step', () => {
    const skip = (env: Record<string, string>) => run('Skip the alerts', env);

    // @traces 1024-FR-009
    it('names only the token when only the token is missing, and calls nothing', () => {
      const { code, out, calls } = skip({ NO_TOKEN: 'true', NO_URL: 'false' });
      expect(code).toBe(0);
      expect(calls).toHaveLength(0);
      expect(out).toMatch(/::notice::.*GRAFANA_SA_TOKEN/);
      expect(out).not.toContain('GRAFANA_URL');
    });

    // @traces 1024-FR-009
    it('names only the URL when only the URL is missing', () => {
      const { out } = skip({ NO_TOKEN: 'false', NO_URL: 'true' });
      expect(out).toMatch(/::notice::.*GRAFANA_URL/);
      expect(out).not.toContain('GRAFANA_SA_TOKEN');
    });

    // @traces 1024-FR-009
    it('names both when both are missing, in one notice', () => {
      const { code, out } = skip({ NO_TOKEN: 'true', NO_URL: 'true' });
      expect(code).toBe(0);
      expect(out.match(/::notice::/g)).toHaveLength(1);
      expect(out).toContain('GRAFANA_SA_TOKEN');
      expect(out).toContain('GRAFANA_URL');
    });
  });
});
