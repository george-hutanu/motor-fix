import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
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
const OWN = 'motorfix-owner';

const CURL = [
  '#!/usr/bin/env bash',
  'n=$(ls "$CALLS" | wc -l | tr -d " ")',
  'printf "%s\\n" "$@" > "$CALLS/$n.args"',
  'case " $* " in *" @- "*) cat > "$CALLS/$n.body";; esac',
  'method=GET; out=; url=; prev=; w=; fail=; http=',
  'for a in "$@"; do',
  '  [ "$prev" = -X ] && method=$a',
  '  [ "$prev" = -o ] && out=$a',
  '  case "$a" in http*) url=$a;; -w) w=1;; --fail|-f) fail=1;; esac',
  '  prev=$a',
  'done',
  'code=0',
  'case "$method $url" in',
  '  "PUT "*contact-points/*) http="$CP_PUT";;',
  '  "POST "*contact-points) http="$CP_POST";;',
  '  "PUT "*policies) code="$POLICY";;',
  '  "PUT "*rule-groups/*) code="$GROUP";;',
  '  "GET "*contact-points?*) code="$LIST"; if [ -n "$out" ]; then printf "%s" "$LIST_BODY" > "$out"; fi;;',
  '  "DELETE "*) code="$DELETE";;',
  'esac',
  '# The contact point answers an HTTP status: 000 is a dead connection',
  '# (curl exit 28), and --fail turns a 4xx or 5xx into exit 22.',
  'if [ -n "$http" ]; then',
  '  [ -n "$w" ] && printf "%s" "$http"',
  '  case "$http" in 000) code=28;; 2??) ;; *) [ -n "$fail" ] && code=22;; esac',
  'fi',
  'if [ "$code" != 0 ]; then echo "$ERR_TEXT" >&2; exit "$code"; fi',
  'exit 0',
].join('\n');

describe('the alerting apply step under hostile Grafana answers', () => {
  const text = read('grafana-alerts.yml');
  const step = (title: string) => {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.trim() === `- name: ${title}`);
    const indent = (lines[start] as string).search(/\S/);
    const end = lines.findIndex(
      (l, i) => i > start && l.trim() !== '' && l.search(/\S/) <= indent,
    );
    return lines.slice(start, end < 0 ? undefined : end).join('\n');
  };

  let dir: string;
  const token = 'tok-secret-value';
  const url = 'https://grafana.example.test';
  const alerting = () =>
    join(dir, 'infra', 'observability', 'grafana', 'alerting');
  const temp = () => join(dir, 'runner-temp');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'grafana-alerting-'));
    for (const d of ['bin', 'calls', 'runner-temp']) mkdirSync(join(dir, d));
    mkdirSync(join(dir, 'infra', 'observability', 'alerts'), {
      recursive: true,
    });
    cpSync(
      join(root, 'infra', 'observability', 'grafana', 'alerting'),
      alerting(),
      { recursive: true },
    );
    writeFileSync(
      join(dir, 'infra', 'observability', 'alerts', 'a.json'),
      JSON.stringify({
        groups: [
          { interval: '1m', name: 'a', rules: [{ title: 'a', uid: 'a-r' }] },
        ],
      }),
    );
    const curl = join(dir, 'bin', 'curl');
    writeFileSync(curl, CURL);
    chmodSync(curl, 0o755);
  });
  afterEach(() => rmSync(dir, { force: true, recursive: true }));

  const apply = (env: Record<string, string> = {}) => {
    const r = spawnSync(
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
          CP_POST: '201',
          CP_PUT: '200',
          DELETE: '0',
          ERR_TEXT: `curl: (22) refused ${url} ${token}`,
          GRAFANA_SA_TOKEN: token,
          GRAFANA_URL: url,
          GROUP: '0',
          LIST: '0',
          PATH: `${join(dir, 'bin')}:${process.env['PATH']}`,
          POLICY: '0',
          RUNNER_TEMP: temp(),
          ...env,
        },
      },
    );
    const calls = readdirSync(join(dir, 'calls'))
      .filter((f) => f.endsWith('.args'))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
      .map((f) => readFileSync(join(dir, 'calls', f), 'utf8'));
    return { calls, code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const kind = (args: string) => {
    const lines = args.split('\n');
    const m = lines[lines.indexOf('-X') + 1] ?? 'GET';
    const target = lines.find((l) => l.startsWith('http')) ?? '';
    return `${lines.includes('-X') ? m : 'GET'} ${target.replace(url, '')}`;
  };
  const sequence = (calls: string[]) => calls.map(kind);
  const deletes = (calls: string[]) =>
    sequence(calls).filter((c) => c.startsWith('DELETE'));

  // @traces 880-FR-014
  it('deletes nothing when Grafana lists no contact point of that name', () => {
    const { code, calls } = apply({ LIST_BODY: '[]' });
    expect(code).toBe(0);
    expect(deletes(calls)).toEqual([]);
  });

  // @traces 880-FR-014
  it('deletes nothing when the list holds only the repository uid', () => {
    const { code, calls } = apply({
      LIST_BODY: JSON.stringify([{ name: 'MotorFix owner', uid: OWN }]),
    });
    expect(code).toBe(0);
    expect(deletes(calls)).toEqual([]);
  });

  // @traces 880-FR-014
  it('deletes every other uid and keeps the repository one', () => {
    const { code, calls } = apply({
      LIST_BODY: JSON.stringify([
        { uid: 'old-1' },
        { uid: OWN },
        { uid: 'old-2' },
      ]),
    });
    expect(code).toBe(0);
    expect(deletes(calls)).toEqual([
      'DELETE /api/v1/provisioning/contact-points/old-1',
      'DELETE /api/v1/provisioning/contact-points/old-2',
    ]);
  });

  // @traces 880-FR-014
  it('treats a uid holding a space as one contact point, not two', () => {
    const { calls } = apply({
      LIST_BODY: JSON.stringify([{ uid: 'hand made' }]),
    });
    expect(deletes(calls)).toHaveLength(1);
  });

  // @traces 880-FR-014
  it('does not expand a glob character in a uid against the working directory', () => {
    const { calls } = apply({ LIST_BODY: JSON.stringify([{ uid: '*' }]) });
    const found = deletes(calls);
    expect(found).toHaveLength(1);
    expect(found[0]).not.toContain('infra');
  });

  // @traces 880-FR-014
  it('fails the step when the list answer is not JSON', () => {
    const { code, calls } = apply({ LIST_BODY: '<html>502</html>' });
    expect(deletes(calls)).toEqual([]);
    expect(code).not.toBe(0);
  });

  // @traces 880-FR-014
  it('fails the step when the list answer is an object instead of an array', () => {
    const { code, calls } = apply({
      LIST_BODY: JSON.stringify({ message: 'not found' }),
    });
    expect(deletes(calls)).toEqual([]);
    expect(code).not.toBe(0);
  });

  // @traces 880-FR-014
  it('applies the policy and the groups, then fails, when the policy is refused', () => {
    const { code, calls, out } = apply({
      LIST_BODY: JSON.stringify([{ uid: 'old' }]),
      POLICY: '22',
    });
    expect(code).toBe(1);
    expect(sequence(calls)).toContain(
      'PUT /api/v1/provisioning/folder/motorfix/rule-groups/a',
    );
    expect(out).toContain('::error::');
    expect(out).toContain('policies.json');
  });

  // @traces 880-FR-014
  it('still removes the hand-made contact point when only the policy was refused', () => {
    const { calls } = apply({
      LIST_BODY: JSON.stringify([{ uid: 'old' }]),
      POLICY: '22',
    });
    expect(deletes(calls)).toEqual([
      'DELETE /api/v1/provisioning/contact-points/old',
    ]);
  });

  // @traces 880-FR-014
  it('creates the contact point with a POST when the PUT answers 404, then goes on to the policy', () => {
    const { code, calls, out } = apply({ CP_PUT: '404', LIST_BODY: '[]' });
    expect(code).toBe(0);
    expect(sequence(calls).slice(1, 4)).toEqual([
      `PUT /api/v1/provisioning/contact-points/${OWN}`,
      'POST /api/v1/provisioning/contact-points',
      'PUT /api/v1/provisioning/policies',
    ]);
    expect(out).toContain(
      `applied infra/observability/grafana/alerting/contact-points.json (${OWN})`,
    );
  });

  // @traces 880-FR-014
  it.each(['500', '400', '401', '403', '409', '000'])(
    'sends no POST, names HTTP %s, deletes nothing and fails the step when the PUT answers it',
    (answer) => {
      const { code, calls, out } = apply({
        CP_PUT: answer,
        LIST_BODY: JSON.stringify([{ uid: 'old' }]),
      });
      expect(code).toBe(1);
      expect(sequence(calls)).not.toContain(
        'POST /api/v1/provisioning/contact-points',
      );
      expect(out).toMatch(
        new RegExp(`::error::.*contact-points\\.json.*${OWN}.*HTTP ${answer}`),
      );
      expect(sequence(calls).filter((c) => c.includes('?name='))).toEqual([]);
      expect(deletes(calls)).toEqual([]);
      expect(sequence(calls)).toContain('PUT /api/v1/provisioning/policies');
    },
  );

  // @traces 880-FR-014
  it('lists and deletes nothing, naming the POST answer, when the PUT answers 404 and the POST is refused', () => {
    const { code, calls, out } = apply({
      CP_POST: '500',
      CP_PUT: '404',
      LIST_BODY: JSON.stringify([{ uid: 'old' }]),
    });
    expect(code).toBe(1);
    expect(sequence(calls).filter((c) => c.includes('?name='))).toEqual([]);
    expect(deletes(calls)).toEqual([]);
    expect(out).toMatch(/::error::.*contact-points\.json.*HTTP 500/);
    expect(sequence(calls)).toContain('PUT /api/v1/provisioning/policies');
  });

  // @traces 880-FR-014
  it('fails the step but tries every delete when one delete is refused', () => {
    const { code, calls } = apply({
      DELETE: '22',
      LIST_BODY: JSON.stringify([{ uid: 'o1' }, { uid: 'o2' }]),
    });
    expect(code).toBe(1);
    expect(deletes(calls)).toHaveLength(2);
  });

  // @traces 880-FR-014
  it('fails the step when the list read itself is refused', () => {
    const { code, calls, out } = apply({ LIST: '22' });
    expect(code).toBe(1);
    expect(deletes(calls)).toEqual([]);
    expect(out).toContain('::error::');
  });

  // @traces 880-FR-014
  it('puts every delete after the last rule group and the list read between', () => {
    const { calls } = apply({
      LIST_BODY: JSON.stringify([{ uid: 'old' }]),
    });
    const seq = sequence(calls);
    const lastGroup = seq
      .map((c) => c.includes('rule-groups/'))
      .lastIndexOf(true);
    const list = seq.findIndex((c) => c.includes('?name='));
    const del = seq.findIndex((c) => c.startsWith('DELETE'));
    expect(lastGroup).toBeLessThan(list);
    expect(list).toBeLessThan(del);
  });

  // @traces 880-FR-014
  it('asks for the name percent-encoded', () => {
    const { calls } = apply({ LIST_BODY: '[]' });
    expect(sequence(calls)).toContain(
      'GET /api/v1/provisioning/contact-points?name=MotorFix%20owner',
    );
  });

  // @traces 880-FR-014
  it('encodes a contact point name holding reserved characters in the query', () => {
    const file = join(alerting(), 'contact-points.json');
    const [point] = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify([{ ...point, name: 'Own&er #1?=x ü' }]));
    const { calls } = apply({ LIST_BODY: '[]' });
    const query = sequence(calls).find((c) => c.includes('?name='));
    expect(query).toBe(
      'GET /api/v1/provisioning/contact-points?name=Own%26er%20%231%3F%3Dx%20%C3%BC',
    );
  });

  // @traces 880-FR-014
  it('leaves no list file behind after a run that deleted something', () => {
    apply({ LIST_BODY: JSON.stringify([{ uid: 'old' }]) });
    expect(readdirSync(temp())).toEqual([]);
  });

  // @traces 880-FR-014
  it('leaves no list file behind when a delete was refused', () => {
    apply({ DELETE: '22', LIST_BODY: JSON.stringify([{ uid: 'old' }]) });
    expect(readdirSync(temp())).toEqual([]);
  });

  // @traces 880-FR-014
  it('leaves no list file behind when the list read was refused', () => {
    apply({ LIST: '22', LIST_BODY: '[{"uid":"x"}]' });
    expect(readdirSync(temp())).toEqual([]);
  });

  // @traces 880-FR-014
  it('does not trust a stale list file left by an earlier run', () => {
    writeFileSync(
      join(temp(), 'grafana-contact-points.json'),
      JSON.stringify([{ uid: 'stale' }]),
    );
    const { calls } = apply({ LIST_BODY: '[]' });
    expect(deletes(calls)).toEqual([]);
  });

  // @traces 880-FR-014
  it('works with no runner temp directory set', () => {
    const { code, calls } = apply({ LIST_BODY: '[]', RUNNER_TEMP: '' });
    expect(code).toBe(0);
    expect(sequence(calls).some((c) => c.includes('?name='))).toBe(true);
  });

  // @traces 880-FR-014
  it('never prints the token or the URL, even when curl echoes them', () => {
    const { out } = apply({
      CP_POST: '500',
      CP_PUT: '404',
      DELETE: '22',
      LIST_BODY: JSON.stringify([{ uid: 'old' }]),
      POLICY: '22',
    });
    expect(out).not.toContain(token);
    expect(out).not.toContain('grafana.example.test');
  });

  // @traces 880-FR-014
  it('carries the token only in the Authorization header of each call', () => {
    const { calls } = apply({ LIST_BODY: JSON.stringify([{ uid: 'old' }]) });
    expect(calls.length).toBeGreaterThan(5);
    for (const args of calls) {
      const lines = args.split('\n');
      const holding = lines.filter((l) => l.includes(token));
      expect(holding).toEqual([`Authorization: Bearer ${token}`]);
    }
  });

  // @traces 880-FR-014
  it('gives every call a 60 second limit and every write the provenance header', () => {
    const { calls } = apply({ LIST_BODY: JSON.stringify([{ uid: 'old' }]) });
    for (const args of calls) {
      const lines = args.split('\n');
      expect(lines[lines.indexOf('--max-time') + 1]).toBe('60');
      if (/^-X (PUT|POST|DELETE)$/m.test(args)) {
        expect(lines).toContain('X-Disable-Provenance: true');
      }
    }
  });

  // @traces 880-FR-014
  it('sends the contact point and the policy files verbatim', () => {
    apply({ LIST_BODY: '[]' });
    const bodies = readdirSync(join(dir, 'calls')).filter((f) =>
      f.endsWith('.body'),
    );
    const sent = bodies.map((f) =>
      JSON.parse(readFileSync(join(dir, 'calls', f), 'utf8')),
    );
    const point = JSON.parse(
      readFileSync(join(alerting(), 'contact-points.json'), 'utf8'),
    )[0];
    const policy = JSON.parse(
      readFileSync(join(alerting(), 'policies.json'), 'utf8'),
    );
    expect(sent).toContainEqual(point);
    expect(sent).toContainEqual(policy);
  });

  // @traces 880-FR-014
  it('fails the step when the contact point file is missing', () => {
    rmSync(join(alerting(), 'contact-points.json'));
    const { code, calls } = apply({ LIST_BODY: '[]' });
    expect(code).not.toBe(0);
    expect(deletes(calls)).toEqual([]);
  });

  // @traces 880-FR-014
  it('fails the step when the contact point file is not JSON', () => {
    writeFileSync(join(alerting(), 'contact-points.json'), '{ not json');
    const { code } = apply({ LIST_BODY: '[]' });
    expect(code).not.toBe(0);
  });

  // @traces 880-FR-014
  it('fails the step when the policy file is missing and still applies the groups', () => {
    rmSync(join(alerting(), 'policies.json'));
    const { code, calls } = apply({ LIST_BODY: '[]' });
    expect(code).toBe(1);
    expect(sequence(calls).some((c) => c.includes('rule-groups/'))).toBe(true);
  });

  // @traces 880-FR-014
  it('applies nothing and deletes nothing from an empty contact point list file', () => {
    writeFileSync(join(alerting(), 'contact-points.json'), '[]');
    const { calls } = apply({ LIST_BODY: JSON.stringify([{ uid: 'old' }]) });
    expect(deletes(calls)).toEqual([]);
  });

  // @traces 880-FR-014
  it('leaves the temporary directory without any file of the run', () => {
    apply({ LIST_BODY: '[]' });
    expect(existsSync(join(temp(), 'grafana-contact-points.json'))).toBe(false);
  });
});
