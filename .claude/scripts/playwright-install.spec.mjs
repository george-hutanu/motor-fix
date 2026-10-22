import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// apt hangs at random inside `playwright install`, and a hung step used to hold its
// job to the job's own limit (30 to 60 minutes). Every Playwright install step now
// runs 180 s an attempt, three attempts, inside a 10-minute step limit. apt runs
// under sudo, where `timeout` cannot kill it, so a failed attempt kills it as root
// and repairs dpkg: otherwise the next attempt dies on the dpkg lock it left held.
// When all three stall (a slow mirror, not a hang), an apt step still goes on if every
// library the cached chromium loads resolves: the runner image carries them, and what
// apt was still fetching were extra fonts and upgrades (QA runs 39784692110, 39794595292).
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

/** `--with-deps` and `install-deps` run apt under sudo; a browser-only install does not. */
const usesApt = (run) => /--with-deps|install-deps/.test(run);

/** What an apt step runs after its third failed attempt, the same in every workflow. */
const FALLBACK = [
  'bins=$(find "$HOME/.cache/ms-playwright" -type f \\( -name chrome -o -name headless_shell -o -name chrome-headless-shell \\) 2>/dev/null || true)',
  "if [ -n \"$bins\" ] && ! ldd $bins 2>&1 | grep -q 'not found'; then",
  '  echo "::warning::playwright: apt never finished, but every library chromium loads resolves; going on"',
  '  exit 0',
  'fi',
  'exit 1',
].join('\n');

const installs = WORKFLOWS.flatMap((name) => steps(read(name)).filter((s) => /playwright install/.test(s.text)).map((s) => ({ ...s, name })));

describe('Playwright install steps: bounded, retried', () => {
  it('finds the six install steps: three in ci.yml (the harness browser, two for E2E), two in pr-qa.yml, one in release.yml', () => {
    assert.deepEqual(
      installs.map((s) => s.name),
      ['ci.yml', 'ci.yml', 'ci.yml', 'pr-qa.yml', 'pr-qa.yml', 'release.yml'],
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
        assert.ok(run.endsWith(usesApt(run) ? `done\n${FALLBACK}` : 'done\nexit 1'), run);
        const bare = run.split('\n').filter((l) => /npx playwright install/.test(l) && !/timeout -k 10 180 npx/.test(l));
        assert.deepEqual(bare, [], 'an install outside the bound');
      });

      it('logs each failed attempt', () => {
        assert.match(run, /^ {2}echo ".*attempt \$attempt of 3.*"$/m);
      });

      if (usesApt(run)) {
        it('kills a leftover apt and dpkg as root after a failed attempt, and repairs dpkg', () => {
          assert.match(run, /^ {2}echo .*\n {2}sudo sh -c 'pkill -9 -x apt-get; pkill -9 -x dpkg; dpkg --configure -a' \|\| true\ndone$/m);
        });
      } else {
        it('runs no apt, so it kills nothing as root between attempts', () => {
          assert.doesNotMatch(run, /sudo/);
        });
      }
    });
  }
});

describe('the retry loop, run', () => {
  // A fake `npx` that fails until its `n`th call, a `timeout` that drops its options
  // and runs the command, and a `sudo` that only counts the cleanups: the loop's own
  // logic, on any machine.
  const apt = installs.find((s) => usesApt(script(s)));
  const loop = apt ? script(apt) : '';
  const runLoop = (succeedOn, { browser = false, missing = false } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-retry-'));
    const home = join(dir, 'home');
    try {
      if (browser) {
        mkdirSync(join(home, '.cache/ms-playwright/chromium-1/chrome-linux'), { recursive: true });
        writeFileSync(join(home, '.cache/ms-playwright/chromium-1/chrome-linux/chrome'), '');
      }
      writeFileSync(join(dir, 'ldd'), `#!/bin/sh\necho "libnss3.so => ${missing ? 'not found' : '/usr/lib/libnss3.so'}"\n`);
      writeFileSync(join(dir, 'npx'), `#!/bin/sh\nn=$(cat "${dir}/count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/count"\n[ "$n" -ge ${succeedOn} ]\n`);
      writeFileSync(join(dir, 'timeout'), '#!/bin/sh\nshift 3\nexec "$@"\n');
      writeFileSync(join(dir, 'sudo'), `#!/bin/sh\necho x >> "${dir}/cleanups"\n`);
      for (const bin of ['npx', 'timeout', 'sudo', 'ldd']) chmodSync(join(dir, bin), 0o755);
      const env = { ...process.env, HOME: home, PATH: `${dir}:${process.env.PATH}` };
      const r = spawnSync('bash', ['-e', '-c', loop], { encoding: 'utf8', env });
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

  it('goes on after three stalled attempts when every library the cached chromium loads resolves', () => {
    const r = runLoop(99, { browser: true });
    assert.equal(r.code, 0);
    assert.equal(r.calls, 3);
    assert.match(r.out, /every library chromium loads resolves; going on/);
  });

  it('fails after three stalled attempts when a library chromium loads is missing', () => {
    const r = runLoop(99, { browser: true, missing: true });
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.out, /going on/);
  });

  it('fails after three stalled attempts when no browser is cached to check', () => {
    assert.equal(runLoop(99, { browser: false }).code, 1);
  });
});
