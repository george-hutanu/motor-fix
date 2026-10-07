import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// apt hangs at random inside `playwright install`, and a hung step used to hold its
// job to the job's own limit (30 to 60 minutes). Every Playwright install step now
// runs 180 s an attempt, three attempts, inside a 10-minute step limit. apt runs
// under sudo, where `timeout` cannot kill it, so a failed attempt kills it as root
// and repairs dpkg: otherwise the next attempt dies on the dpkg lock it left held.
// The workflows keep one key per line and two-space indentation, so the steps are
// read from the text, as pr-qa-workflow.spec.mjs does.
const WORKFLOWS = ['ci.yml', 'pr-qa.yml', 'release.yml'];
const STEP_LIMIT = 10;
const read = (name) => readFileSync(fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)), 'utf8');
const indentOf = (line) => line.length - line.trimStart().length;

/** Every step (`- ` list item under a `steps:` key) with its job's `timeout-minutes`. */
function steps(text) {
  const lines = text.split('\n');
  const out = [];
  let jobLimit = 360; // GitHub's default when a job sets none
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) jobLimit = 360;
    const job = /^ {4}timeout-minutes:\s*(\d+)/.exec(line);
    if (job) jobLimit = Number(job[1]);
    if (!/^\s*- /.test(line) || !/^\s*steps:\s*$/.test(lines.slice(0, i).reverse().find((l) => l.trim() && indentOf(l) < indentOf(line)) ?? '')) continue;
    const body = [line];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() && indentOf(next) <= indentOf(line)) break;
      body.push(next);
    }
    out.push({ text: body.join('\n'), jobLimit });
  }
  return out;
}

/** The step's `run: |` script, dedented. */
function script(step) {
  const lines = step.text.split('\n');
  const start = lines.findIndex((l) => /^\s*-?\s*run: \|\s*$/.test(l));
  if (start === -1) return lines.find((l) => /run:/.test(l))?.replace(/^.*run:\s*/, '') ?? '';
  const body = lines.slice(start + 1).filter((l) => l.trim());
  const pad = Math.min(...body.map(indentOf));
  return body.map((l) => l.slice(pad)).join('\n');
}

const installs = WORKFLOWS.flatMap((name) => steps(read(name)).filter((s) => /playwright install/.test(s.text)).map((s) => ({ ...s, name })));

describe('Playwright install steps: bounded, retried', () => {
  it('finds the five install steps: two in ci.yml, two in pr-qa.yml, one in release.yml', () => {
    assert.deepEqual(
      installs.map((s) => s.name),
      ['ci.yml', 'ci.yml', 'pr-qa.yml', 'pr-qa.yml', 'release.yml'],
    );
  });

  for (const [i, step] of installs.entries()) {
    describe(`${step.name}, install step ${i + 1}`, () => {
      const run = script(step);

      it(`carries a step limit of ${STEP_LIMIT} minutes, below its job's`, () => {
        const limit = Number(/timeout-minutes:\s*(\d+)/.exec(step.text)?.[1]);
        assert.equal(limit, STEP_LIMIT, step.text);
        assert.ok(limit < step.jobLimit, `step ${limit} min is not below the job's ${step.jobLimit}`);
      });

      it('runs each attempt under a 180 s limit, killed 10 s later, at most 3 attempts', () => {
        assert.match(run, /^for attempt in 1 2 3; do$/m);
        assert.match(run, /^ {2}timeout -k 10 180 npx playwright install\b.*&& exit 0$/m);
        assert.match(run, /^done\nexit 1$/m);
        const bare = run.split('\n').filter((l) => /npx playwright install/.test(l) && !/timeout -k 10 180 npx/.test(l));
        assert.deepEqual(bare, [], 'an install outside the bound');
      });

      it('logs each failed attempt', () => {
        assert.match(run, /^ {2}echo ".*attempt \$attempt of 3.*"$/m);
      });

      it('kills a leftover apt and dpkg as root after a failed attempt, and repairs dpkg', () => {
        assert.match(run, /^ {2}echo .*\n {2}sudo sh -c 'pkill -9 -x apt-get; pkill -9 -x dpkg; dpkg --configure -a' \|\| true\ndone$/m);
      });
    });
  }
});

describe('the retry loop, run', () => {
  // A fake `npx` that fails until its `n`th call, a `timeout` that drops its options
  // and runs the command, and a `sudo` that only counts the cleanups: the loop's own
  // logic, on any machine.
  const loop = installs[0] ? script(installs[0]) : '';
  const runLoop = (succeedOn) => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-retry-'));
    try {
      writeFileSync(join(dir, 'npx'), `#!/bin/sh\nn=$(cat "${dir}/count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/count"\n[ "$n" -ge ${succeedOn} ]\n`);
      writeFileSync(join(dir, 'timeout'), '#!/bin/sh\nshift 3\nexec "$@"\n');
      writeFileSync(join(dir, 'sudo'), `#!/bin/sh\necho x >> "${dir}/cleanups"\n`);
      for (const bin of ['npx', 'timeout', 'sudo']) chmodSync(join(dir, bin), 0o755);
      const r = spawnSync('bash', ['-e', '-c', loop], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
      const calls = Number(readFileSync(join(dir, 'count'), 'utf8'));
      const cleanups = existsSync(join(dir, 'cleanups')) ? readFileSync(join(dir, 'cleanups'), 'utf8').trim().split('\n').length : 0;
      return { code: r.status, calls, cleanups, out: r.stdout };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('installs once when the first attempt succeeds', () => {
    assert.deepEqual(runLoop(1), { code: 0, calls: 1, cleanups: 0, out: '' });
  });

  it('retries a failed attempt and stops at the first success', () => {
    const r = runLoop(3);
    assert.equal(r.code, 0);
    assert.equal(r.calls, 3);
    assert.equal(r.cleanups, 2);
    assert.equal(r.out.trim().split('\n').length, 2);
  });

  it('fails after three failed attempts, one log line each', () => {
    const r = runLoop(99);
    assert.equal(r.code, 1);
    assert.equal(r.calls, 3);
    assert.equal(r.cleanups, 3);
    assert.match(r.out, /attempt 3 of 3/);
  });
});
