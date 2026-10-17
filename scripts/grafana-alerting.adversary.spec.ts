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
const OUTAGE = ['motorfix-outage-email', 'motorfix-outage-webhook'];

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
  '  "PUT "*contact-points/*) http="$CP_PUT"; if [ -n "$CP_REFUSE" ]; then case "$url" in */"$CP_REFUSE") http=500;; esac; fi;;',
  '  "POST "*contact-points) http="$CP_POST";;',
  '  "PUT "*policies) code="$POLICY";;',
  '  "PUT "*rule-groups/*) code="$GROUP";;',
  '  "GET "*contact-points?*) code="$LIST"; case "$url" in *"?name=motorfix-outage") list="$OUTAGE_LIST_BODY";; *) list="$LIST_BODY";; esac; if [ -n "$out" ]; then printf "%s" "$list" > "$out"; fi;;',
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
          CP_REFUSE: '',
          DELETE: '0',
          ERR_TEXT: `curl: (22) refused ${url} ${token}`,
          GRAFANA_SA_TOKEN: token,
          GRAFANA_URL: url,
          GROUP: '0',
          LIST: '0',
          LIST_BODY: '[]',
          OUTAGE_LIST_BODY: '[]',
          OUTAGE_WEBHOOK_TOKEN: '',
          PATH: `${join(dir, 'bin')}:${process.env['PATH']}`,
          POLICY: '0',
          RUNNER_TEMP: temp(),
          STAGING_WEB_URL: '',
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
  const hook = 'hook-secret-value';
  const web = 'https://staging.example.test';
  const written = (ext: string) =>
    readdirSync(join(dir, 'calls'))
      .filter((f) => f.endsWith(ext))
      .map((f) => readFileSync(join(dir, 'calls', f), 'utf8'));
  const declared = () =>
    JSON.parse(
      readFileSync(join(alerting(), 'contact-points.json'), 'utf8'),
    ) as { uid: string; type: string; settings: Record<string, string> }[];

  // @traces 880-FR-014
  // @traces 1347-FR-002
  it('deletes nothing when Grafana lists no contact point of either name', () => {
    const { code, calls } = apply({ LIST_BODY: '[]', OUTAGE_LIST_BODY: '[]' });
    expect(code).toBe(0);
    expect(deletes(calls)).toEqual([]);
  });

  // @traces 880-FR-014
  // @traces 1347-FR-002
  it('deletes nothing when the lists hold only the repository uids', () => {
    const { code, calls } = apply({
      LIST_BODY: JSON.stringify([{ name: 'MotorFix owner', uid: OWN }]),
      OUTAGE_LIST_BODY: JSON.stringify(
        OUTAGE.map((uid) => ({ name: 'motorfix-outage', uid })),
      ),
    });
    expect(code).toBe(0);
    expect(deletes(calls)).toEqual([]);
  });

  // @traces 880-FR-014
  // @traces 1347-FR-002
  it('deletes every other uid under either name and keeps every repository one', () => {
    const { code, calls } = apply({
      LIST_BODY: JSON.stringify([
        { uid: 'old-1' },
        { uid: OWN },
        { uid: 'old-2' },
      ]),
      OUTAGE_LIST_BODY: JSON.stringify([
        { uid: 'old-3' },
        { uid: OUTAGE[0] },
        { uid: OUTAGE[1] },
        { uid: 'old-4' },
      ]),
    });
    expect(code).toBe(0);
    expect(deletes(calls)).toEqual(
      ['old-1', 'old-2', 'old-3', 'old-4'].map(
        (uid) => `DELETE /api/v1/provisioning/contact-points/${uid}`,
      ),
    );
  });

  // @traces 1347-FR-002
  it.each<[string, string, Record<string, string>]>(
    OUTAGE.flatMap((uid) => [
      [uid, 'applied', { OUTAGE_WEBHOOK_TOKEN: hook, STAGING_WEB_URL: web }],
      [uid, 'skipped', {}],
    ]),
  )('keeps %s listed alone while the webhook is %s', (uid, _, env) => {
    const { code, calls } = apply({
      OUTAGE_LIST_BODY: JSON.stringify([{ name: 'motorfix-outage', uid }]),
      ...env,
    });
    expect(code).toBe(0);
    expect(deletes(calls)).toEqual([]);
  });

  // @traces 1347-FR-002
  it('deletes a hand-made uid that only resembles a declared one, and keeps the declared', () => {
    const near = [
      'motorfix-outage',
      'motorfix-outage-email-old',
      'motorfix-outage-webhoo',
      'Motorfix-Outage-Email',
    ];
    const { code, calls } = apply({
      OUTAGE_LIST_BODY: JSON.stringify(
        [...near, ...OUTAGE].map((uid) => ({ uid })),
      ),
    });
    expect(code).toBe(0);
    expect(deletes(calls)).toEqual(
      near.map((uid) => `DELETE /api/v1/provisioning/contact-points/${uid}`),
    );
  });

  // @traces 1347-FR-002
  it('sends no delete for a listed entry without a uid', () => {
    const { code, calls } = apply({
      OUTAGE_LIST_BODY: JSON.stringify([
        { name: 'motorfix-outage' },
        { uid: null },
        { uid: '' },
        { uid: 'hand' },
      ]),
    });
    expect(code).toBe(0);
    expect(deletes(calls)).toEqual([
      'DELETE /api/v1/provisioning/contact-points/hand',
    ]);
  });

  // @traces 1347-FR-002
  it.each(['../policies', 'a?x=1', 'a#frag'])(
    'deletes the hand-made uid %s as one path segment of the contact points',
    (uid) => {
      const { calls } = apply({ OUTAGE_LIST_BODY: JSON.stringify([{ uid }]) });
      const [target] = deletes(calls).map(
        (c) => new URL(c.replace(/^DELETE /, url)),
      );
      const prefix = '/api/v1/provisioning/contact-points/';
      expect(target?.search).toBe('');
      expect(target?.hash).toBe('');
      expect(target?.pathname.startsWith(prefix)).toBe(true);
      expect(
        decodeURIComponent(String(target?.pathname.slice(prefix.length))),
      ).toBe(uid);
    },
  );

  // @traces 1347-FR-002
  it('fails the step on an empty list answer for one name and still handles the other', () => {
    const { code, calls, out } = apply({
      LIST_BODY: JSON.stringify([{ uid: 'old-1' }]),
      OUTAGE_LIST_BODY: '',
    });
    expect(code).toBe(1);
    expect(out).toMatch(/::error::.*motorfix-outage is not a list/);
    expect(deletes(calls)).toEqual([
      'DELETE /api/v1/provisioning/contact-points/old-1',
    ]);
  });

  // @traces 1347-FR-002
  it('fails the step, still applies the policy and removes nothing, when the webhook has no url to fill in', () => {
    const file = join(alerting(), 'contact-points.json');
    const points = declared();
    const webhook = points.find((p) => p.uid === OUTAGE[1]);
    if (webhook) delete webhook.settings['url'];
    writeFileSync(file, JSON.stringify(points));
    const { code, calls, out } = apply({
      LIST_BODY: JSON.stringify([{ uid: 'old-1' }]),
      OUTAGE_WEBHOOK_TOKEN: hook,
      STAGING_WEB_URL: web,
    });
    expect(code).toBe(1);
    expect(out).toMatch(
      /::error::.*motorfix-outage-webhook has no settings\.url/,
    );
    expect(sequence(calls)).toContain('PUT /api/v1/provisioning/policies');
    expect(sequence(calls).filter((c) => c.includes('?name='))).toEqual([]);
    expect(deletes(calls)).toEqual([]);
    expect(written('.body').filter((b) => b.includes(hook))).toEqual([]);
  });

  // @traces 1347-FR-002
  it('lists and deletes nothing under either name when one outage entry is refused', () => {
    const { code, calls, out } = apply({
      CP_REFUSE: OUTAGE[0] as string,
      LIST_BODY: JSON.stringify([{ uid: 'old-1' }]),
      OUTAGE_LIST_BODY: JSON.stringify([{ uid: 'old-2' }]),
    });
    expect(code).toBe(1);
    expect(sequence(calls).filter((c) => c.includes('?name='))).toEqual([]);
    expect(deletes(calls)).toEqual([]);
    expect(out).toMatch(
      /::error::.*contact-points\.json.*motorfix-outage-email.*HTTP 500/,
    );
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
  // @traces 1347-FR-002
  it('creates each contact point with a POST when its PUT answers 404, then goes on to the policy', () => {
    const { code, calls, out } = apply({ CP_PUT: '404', LIST_BODY: '[]' });
    expect(code).toBe(0);
    expect(sequence(calls).slice(1, 6)).toEqual([
      `PUT /api/v1/provisioning/contact-points/${OWN}`,
      'POST /api/v1/provisioning/contact-points',
      `PUT /api/v1/provisioning/contact-points/${OUTAGE[0]}`,
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
  // @traces 1347-FR-002
  it('asks once for each declared name, percent-encoded', () => {
    const { calls } = apply({ LIST_BODY: '[]' });
    expect(sequence(calls).filter((c) => c.includes('?name='))).toEqual([
      'GET /api/v1/provisioning/contact-points?name=MotorFix%20owner',
      'GET /api/v1/provisioning/contact-points?name=motorfix-outage',
    ]);
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

  // @traces 1347-FR-002
  it('carries the webhook token in the webhook body alone and prints neither token nor address', () => {
    const { code, out } = apply({
      ERR_TEXT: `curl: (22) refused ${url} ${web} ${token} ${hook}`,
      LIST_BODY: JSON.stringify([{ uid: 'old' }]),
      OUTAGE_WEBHOOK_TOKEN: hook,
      POLICY: '22',
      STAGING_WEB_URL: web,
    });
    expect(code).toBe(1);
    expect(written('.args').filter((a) => a.includes(hook))).toEqual([]);
    expect(written('.body').filter((b) => b.includes(hook))).toHaveLength(1);
    for (const value of [
      'grafana.example.test',
      'staging.example.test',
      token,
      hook,
    ])
      expect(out).not.toContain(value);
  });

  // @traces 1347-FR-002
  it.each<[string, Record<string, string>]>([
    ['the secret', { STAGING_WEB_URL: web }],
    ['the variable', { OUTAGE_WEBHOOK_TOKEN: hook }],
  ])('sends the webhook token in no body when %s is missing', (_, env) => {
    const { code } = apply({ LIST_BODY: '[]', ...env });
    expect(code).toBe(0);
    expect(written('.body').filter((b) => b.includes(hook))).toEqual([]);
    expect(
      written('.args').filter((a) => a.includes(OUTAGE[1] as string)),
    ).toEqual([]);
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
  // @traces 1347-FR-002
  it('sends the e-mail contact points and the policy verbatim, and no webhook without its values', () => {
    apply({ LIST_BODY: '[]' });
    const sent = written('.body').map((b) => JSON.parse(b));
    const policy = JSON.parse(
      readFileSync(join(alerting(), 'policies.json'), 'utf8'),
    );
    expect(sent.filter((b) => 'type' in b)).toEqual(
      declared().filter((p) => p.type === 'email'),
    );
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
