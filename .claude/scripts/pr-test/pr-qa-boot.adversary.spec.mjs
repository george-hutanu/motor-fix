import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkReport } from './dispatch.mjs';

const WF = (name) => readFileSync(fileURLToPath(new URL(`../../../.github/workflows/${name}`, import.meta.url)), 'utf8');
const indentOf = (l) => l.length - l.trimStart().length;
const dirs = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'boot-adv-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** Every step (list item) of a workflow as {text, lines}. */
function steps(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*- /.test(lines[i]) || indentOf(lines[i]) < 6) continue;
    const body = [lines[i]];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() && indentOf(next) <= indentOf(lines[i])) break;
      body.push(next);
    }
    out.push(body.join('\n'));
  }
  return out;
}
function runOf(step) {
  const lines = step.split('\n');
  const start = lines.findIndex((l) => /^\s*(- )?run: \|\s*$/.test(l));
  assert.notEqual(start, -1, 'no run block');
  const body = [];
  const base = indentOf(lines[start]);
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && indentOf(l) <= base) break;
    body.push(l);
  }
  const nonEmpty = body.filter((l) => l.trim());
  const pad = Math.min(...nonEmpty.map(indentOf));
  return body.map((l) => l.slice(pad)).join('\n');
}
const prQa = steps(WF('pr-qa.yml'));
const servicesStep = prQa.find((s) => /^\s*(- )?(name:.*\n\s*)?id: services/m.test(s) || /\n\s*id: services\s*\n/.test(s));
const bootStep = prQa.find((s) => /boot-report\.mjs/.test(s));

function fake(dir, name, body) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
}

/**
 * Runs the services step's script. `answers` is the string of pg_isready answers per exec call
 * (A accept, R reject); after it ends every call rejects. `clock` lists the successive `date +%s`
 * values; the last repeats +1 each call.
 */
function runServices({ answers, tcpOnly = true, clock = null, logsFail = false }) {
  const dir = tmp();
  const runnerTemp = join(dir, 'runner temp');
  mkdirSync(runnerTemp);
  writeFileSync(join(dir, 'answers'), answers);
  writeFileSync(join(dir, 'clock'), (clock ?? []).join('\n'));
  writeFileSync(join(dir, 'tick'), '1000');
  fake(dir, 'timeout', 'shift; exec "$@"');
  fake(dir, 'sleep', 'exit 0');
  fake(
    dir,
    'date',
    `if [ -s "${dir}/clock" ]; then l=$(head -n 1 "${dir}/clock"); tail -n +2 "${dir}/clock" > "${dir}/clock.n"; mv "${dir}/clock.n" "${dir}/clock"; echo "$l" > "${dir}/tick"; echo "$l";
else t=$(cat "${dir}/tick"); t=$((t + 1)); echo $t > "${dir}/tick"; echo $t; fi`,
  );
  fake(
    dir,
    'docker',
    `echo "$@" >> "${dir}/calls"
case "$*" in
  *"config --services"*) printf 'postgres\\nredis\\nstorage\\n'; exit 0;;
  *" up "*) exit 0;;
  *" logs "*) ${logsFail ? 'exit 1' : 'echo "pg log line"; exit 0'};;
  *" exec "*)
    ${tcpOnly ? 'case "$*" in *"-h 127.0.0.1"*) ;; *) exit 1;; esac' : ''}
    a=$(cat "${dir}/answers"); first=$(printf %s "$a" | cut -c1); printf %s "$a" | cut -c2- > "${dir}/answers"
    [ "$first" = A ] && exit 0; exit 1;;
esac
exit 0`,
  );
  const script = runOf(servicesStep);
  const r = spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: runnerTemp, HOME: dir },
    timeout: 20000,
  });
  const calls = existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '';
  const pgLog = join(runnerTemp, 'pr-qa', 'postgres.log');
  return { code: r.status, out: r.stdout + r.stderr, calls, pgLog: existsSync(pgLog) ? readFileSync(pgLog, 'utf8') : null, left: readFileSync(join(dir, 'answers'), 'utf8') };
}

describe('database step: readiness over TCP, three in a row, 60 s of wall clock', { timeout: 30_000 }, () => {
  // @traces 988-FR-001
  it('succeeds on three ready answers straight away', () => {
    const r = runServices({ answers: 'AAA' });
    assert.equal(r.code, 0, r.out);
  });

  // @traces 988-FR-001
  it('does not count accept, reject, accept, accept as three', () => {
    const r = runServices({ answers: 'ARAA' });
    assert.equal(r.code, 1, r.out);
  });

  // @traces 988-FR-001
  it('succeeds after accept, accept, reject, then three accepts and stops asking once it has them', () => {
    const r = runServices({ answers: 'AARAAAAAA' });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.left.trim(), 'AAA');
  });

  // @traces 988-FR-001
  it('asks the postgres container over 127.0.0.1 with a one-second try, never the bare socket', () => {
    const r = runServices({ answers: 'AAA' });
    const execs = r.calls.split('\n').filter((l) => / exec /.test(l));
    assert.equal(execs.length, 3, r.calls);
    for (const l of execs) {
      assert.match(l, /exec -T postgres pg_isready/);
      assert.match(l, /-t 1/);
      assert.match(l, /-h 127\.0\.0\.1/);
    }
  });

  // @traces 988-FR-001
  it('treats an answer that only the socket gives as not ready', () => {
    const r = runServices({ answers: 'A'.repeat(200), tcpOnly: true });
    assert.equal(r.code, 0, r.out);
  });

  // @traces 988-FR-001
  it('stops by the wall clock: a clock that jumps 70 s ends the wait on the next try', () => {
    const r = runServices({ answers: 'R'.repeat(500), clock: [5000, 5070] });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /70 s/);
    assert.match(r.out, /60 s/);
  });

  // @traces 988-FR-001
  it('still waits at 59 s elapsed and gives up at exactly 60 s', () => {
    const early = runServices({ answers: 'RRAAA', clock: [5000, 5059, 5059, 5059, 5059, 5059] });
    assert.equal(early.code, 0, early.out);
    const edge = runServices({ answers: 'R'.repeat(50), clock: [5000, 5060] });
    assert.equal(edge.code, 1, edge.out);
    assert.match(edge.out, /60 s elapsed|\(60 s/);
  });

  // @traces 988-FR-002
  it('on timeout saves the postgres log as postgres.log in the report folder and says the elapsed seconds', () => {
    const r = runServices({ answers: 'R'.repeat(500) });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.pgLog?.trim(), 'pg log line');
    assert.match(r.out, /::error::/);
    assert.match(r.out, /6\d s/);
  });

  // @traces 988-FR-002
  it('still fails with the error when the container log cannot be read', () => {
    const r = runServices({ answers: 'R'.repeat(500), logsFail: true });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /::error::/);
  });

  // @traces 988-FR-002
  it('a fast failure names the seconds really elapsed, not the bound', () => {
    const r = runServices({ answers: 'R'.repeat(50), clock: [7000, 7002, 7061] });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /61 s elapsed|\(61 s/);
  });
});

const bootRun = (env, args = ['--pr', '7', '--sha', 'b'.repeat(40), '--lap', '1']) => {
  const dir = tmp();
  const out = join(dir, 'a', 'b');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./boot-report.mjs', import.meta.url)), ...args, '--out', out], { encoding: 'utf8', env: { ...process.env, REASON: undefined, ...env } });
  const rd = (n) => (existsSync(join(out, n)) ? readFileSync(join(out, n), 'utf8') : null);
  return { code: r.status, err: r.stderr, json: rd('report.json'), md: rd('report.md'), out, dir };
};

describe('boot-report.mjs on hostile reasons', { timeout: 30_000 }, () => {
  // @traces 988-FR-003
  it('keeps a reason with quotes, backticks, dollar signs, pipes and unicode exactly', () => {
    const reason = 'it said "no" `x` $(id) | a\\b ‮ ȘȚ 日本';
    const r = bootRun({ REASON: reason });
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.json).findings[0].steps[0], reason);
    assert.equal(JSON.parse(r.json).markdown, r.md);
  });

  // @traces 988-FR-003
  it('keeps a very long multi-line reason whole', () => {
    const reason = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const r = bootRun({ REASON: reason });
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.json).findings[0].steps[0], reason);
  });

  // @traces 988-FR-003
  it('still leaves a failure report with a blocking finding when REASON is empty or unset', () => {
    for (const env of [{ REASON: '' }, {}]) {
      const r = bootRun(env);
      assert.equal(r.code, 0, r.err);
      const rep = JSON.parse(r.json);
      assert.equal(rep.verdict, 'failure');
      assert.equal(rep.findings[0].severity, 'blocker');
      assert.ok(String(rep.findings[0].steps[0]).length > 0);
    }
  });

  // @traces 988-FR-003
  it('replaces a report an earlier attempt left in the folder', () => {
    const first = bootRun({ REASON: 'first' });
    writeFileSync(join(first.out, 'report.json'), '{"stale":true}');
    const again = spawnSync(process.execPath, [fileURLToPath(new URL('./boot-report.mjs', import.meta.url)), '--pr', '7', '--sha', 'b'.repeat(40), '--lap', '1', '--out', first.out], { encoding: 'utf8', env: { ...process.env, REASON: 'second' } });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(readFileSync(join(first.out, 'report.json'), 'utf8')).findings[0].steps[0], 'second');
  });

  // @traces 988-FR-003
  it('is read by the dispatcher as a failure for its own head and not for another', () => {
    const r = bootRun({ REASON: 'x' });
    const rep = JSON.parse(r.json);
    assert.equal(checkReport(rep, 'b'.repeat(40), 'failure'), null);
    assert.notEqual(checkReport(rep, 'c'.repeat(40), 'failure'), null);
  });

  // @traces 988-FR-003
  it('fails loudly instead of writing a half report when no sha is given', () => {
    const r = bootRun({ REASON: 'x' }, ['--pr', '7', '--lap', '1']);
    assert.notEqual(r.code, 0);
  });
});

describe('the boot-report workflow step', () => {
  // @traces 988-FR-003
  it('runs only after a failure when the run step was skipped', () => {
    assert.ok(bootStep, 'step');
    assert.match(bootStep, /if: failure\(\) && steps\.run\.outcome == 'skipped'/);
  });

  // @traces 988-FR-003
  it('keeps the reason out of the script text', () => {
    assert.doesNotMatch(runOf(bootStep), /\$\{\{/);
    assert.match(bootStep, /env:\s*\n\s*REASON:/);
  });

  // @traces 988-FR-003
  it('names the services step and postgres.log for the database step and the run log for anything else', () => {
    const reason = /REASON: (.*)/.exec(bootStep)[1];
    const [, , yes, no] = /(steps\.services\.outcome == 'failure') && '([^']*)' \|\| '([^']*)'/.exec(reason) ?? [];
    assert.match(yes ?? '', /services/);
    assert.match(yes ?? '', /postgres\.log/);
    assert.match(no ?? '', /run log/);
  });

  // @traces 988-FR-003
  it('comes after the database step and before the upload', () => {
    const text = WF('pr-qa.yml');
    const s = text.indexOf('id: services');
    const b = text.indexOf('boot-report.mjs');
    const u = text.indexOf('actions/upload-artifact');
    assert.ok(s !== -1 && s < b && b < u);
  });

  // @traces 988-FR-003
  it('writes the report into the folder the upload reads', () => {
    assert.match(bootStep, /--out "\$RUNNER_TEMP\/pr-qa"/);
    assert.match(WF('pr-qa.yml'), /path: \$\{\{ runner\.temp \}\}\/pr-qa/);
  });
});

describe('install-deps on a browser cache hit', { timeout: 30_000 }, () => {
  const hits = [
    ['ci.yml', ...steps(WF('ci.yml')).filter((s) => /playwright install-deps/.test(s))],
    ['pr-qa.yml', ...steps(WF('pr-qa.yml')).filter((s) => /playwright install-deps/.test(s))],
  ].flatMap(([name, ...ss]) => ss.map((s, i) => ({ name: `${name} #${i + 1}`, run: runOf(s) })));

  // @traces 988-FR-008
  it('finds a cache-hit step in each workflow', () => {
    assert.ok(hits.some((h) => h.name.startsWith('ci.yml')));
    assert.ok(hits.some((h) => h.name.startsWith('pr-qa.yml')));
  });

  function go(run, { chrome = true, missing = false, npxFails = false }) {
    const dir = tmp();
    const chromeDir = join(dir, '.cache', 'ms-playwright', 'chromium-1');
    mkdirSync(chromeDir, { recursive: true });
    if (chrome) writeFileSync(join(chromeDir, 'chrome'), '');
    fake(dir, 'ldd', missing ? 'echo "libx.so => not found"' : 'echo "libc.so => /lib/libc.so"');
    fake(dir, 'npx', `echo "npx $*" >> "${dir}/calls"; ${npxFails ? 'exit 1' : 'exit 0'}`);
    fake(dir, 'timeout', 'shift 3; exec "$@"');
    fake(dir, 'sudo', 'exit 0');
    const r = spawnSync('bash', ['-eo', 'pipefail', '-c', run], { cwd: dir, encoding: 'utf8', env: { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, HOME: dir }, timeout: 20000 });
    return { code: r.status, out: r.stdout + r.stderr, calls: existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '' };
  }

  for (const h of hits) {
    // @traces 988-FR-008
    it(`${h.name}: skips install-deps with a notice when every library resolves`, () => {
      const r = go(h.run, {});
      assert.equal(r.code, 0, r.out);
      assert.equal(r.calls, '');
      assert.match(r.out, /::notice::.*install-deps.*skipped/);
    });

    // @traces 988-FR-008
    it(`${h.name}: runs install-deps when a library is missing`, () => {
      const r = go(h.run, { missing: true });
      assert.equal(r.code, 0, r.out);
      assert.match(r.calls, /install-deps chromium/);
      assert.doesNotMatch(r.out, /skipped/);
    });

    // @traces 988-FR-008
    it(`${h.name}: runs install-deps when no chromium binary is cached`, () => {
      const r = go(h.run, { chrome: false });
      assert.match(r.calls, /install-deps chromium/);
      assert.doesNotMatch(r.out, /skipped/);
    });

    // @traces 988-FR-008
    it(`${h.name}: three failed attempts with a missing library fail the step`, () => {
      const r = go(h.run, { missing: true, npxFails: true });
      assert.equal(r.code, 1, r.out);
      assert.equal(r.calls.trim().split('\n').length, 3);
    });
  }
});
