import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const heavy = fileURLToPath(new URL('../../scripts/heavy.sh', import.meta.url));
const dirs = [];
const holders = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'heavy-'));
  dirs.push(dir);
  return dir;
};
/** Stop a heavy.sh child and wait for it; SIGKILL if TERM did not end it, so no test leaves a waiter behind. */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  await gone;
  clearTimeout(timer);
}
afterEach(async () => {
  await Promise.all(holders.splice(0).map(stop));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const env = (dir, extra = {}) => {
  const { HEAVY_HELD, HEAVY_WAIT, HEAVY_SLOTS, HEAVY_MIN_FREE, ...inherited } = process.env;
  return { ...inherited, HEAVY_LOCK: join(dir, 'heavy.lock'), HEAVY_MIN_FREE: '0', HEAVY_POLL: '1', ...extra };
};
const run = (dir, args, extra) => spawnSync('sh', [heavy, ...args], { encoding: 'utf8', env: env(dir, extra) });

/** Start a heavy command that holds its slot for a few seconds; resolves once it is running. */
async function hold(dir, name, extra) {
  const marker = join(dir, name);
  const holder = spawn('sh', [heavy, 'sh', '-c', `touch ${marker}; sleep 6`], { env: env(dir, extra), stdio: 'ignore' });
  holders.push(holder);
  for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(existsSync(marker), `${name} never got a slot`);
}

describe('heavy.sh', () => {
  it('runs the command and passes its exit code through, 75 included', () => {
    const dir = scratch();
    assert.equal(run(dir, ['sh', '-c', 'exit 7']).status, 7);
    assert.equal(run(dir, ['sh', '-c', 'exit 75']).status, 75);
    assert.equal(run(dir, ['true']).status, 0);
  });

  it('runs commands with two Jest workers, the daemon off, modest Nx parallelism and the slot marked as held', () => {
    const dir = scratch();
    const out = run(dir, ['sh', '-c', 'echo "$JEST_MAX_WORKERS $NX_DAEMON $NX_PARALLEL $HEAVY_HELD"']);
    assert.equal(out.stdout.trim(), '2 false 2 1');
  });

  it('lets two commands hold two slots, and makes a third wait when every slot is taken', async () => {
    const dir = scratch();
    await hold(dir, 'one', { HEAVY_SLOTS: '2' });
    await hold(dir, 'two', { HEAVY_SLOTS: '2' });
    const third = join(dir, 'third');
    const out = run(dir, ['sh', '-c', `touch ${third}`], { HEAVY_SLOTS: '2', HEAVY_WAIT: '1' });
    assert.equal(out.status, 124);
    assert.equal(existsSync(third), false);
    assert.match(out.stderr, /slots busy/);
  }, 20000);

  it('runs a third command at once when a third slot is free', async () => {
    const dir = scratch();
    await hold(dir, 'one', { HEAVY_SLOTS: '3' });
    await hold(dir, 'two', { HEAVY_SLOTS: '3' });
    const out = run(dir, ['sh', '-c', 'exit 0'], { HEAVY_SLOTS: '3', HEAVY_WAIT: '1' });
    assert.equal(out.status, 0);
  }, 20000);

  it('has four slots by default, so four QA runs hold one each and a fifth command waits', async () => {
    const dir = scratch();
    for (const name of ['one', 'two', 'three', 'four']) await hold(dir, name);
    const fifth = join(dir, 'fifth');
    const out = run(dir, ['sh', '-c', `touch ${fifth}`], { HEAVY_WAIT: '1' });
    assert.equal(out.status, 124);
    assert.equal(existsSync(fifth), false);
  }, 30000);

  it('keeps one slot to one command: slot 1 is the configured lock file', async () => {
    const dir = scratch();
    await hold(dir, 'one', { HEAVY_SLOTS: '1' });
    const out = run(dir, ['true'], { HEAVY_SLOTS: '1', HEAVY_WAIT: '1' });
    assert.equal(out.status, 124);
    assert.match(out.stderr, new RegExp(join(dir, 'heavy.lock')));
  }, 20000);

  it('does not take a second slot for a nested call', async () => {
    const dir = scratch();
    await hold(dir, 'one', { HEAVY_SLOTS: '1' });
    const out = run(dir, ['true'], { HEAVY_SLOTS: '1', HEAVY_WAIT: '1', HEAVY_HELD: '1' });
    assert.equal(out.status, 0);
  }, 20000);

  it('on SIGTERM stops its command, frees the slot and exits, without running the command again', async () => {
    const dir = scratch();
    const log = join(dir, 'log');
    const started = join(dir, 'one');
    const child = spawn('sh', [heavy, 'sh', '-c', `touch ${started}; echo start >> ${log}; sleep 3; echo done >> ${log}`], {
      env: env(dir, { HEAVY_SLOTS: '1' }),
      stdio: 'ignore',
    });
    holders.push(child);
    for (let i = 0; i < 100 && !existsSync(started); i++) await new Promise((r) => setTimeout(r, 50));
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    child.kill('SIGTERM');
    assert.equal(await exited, 143);
    await new Promise((r) => setTimeout(r, 3500));
    assert.equal(readFileSync(log, 'utf8'), 'start\n');
    assert.equal(run(dir, ['true'], { HEAVY_SLOTS: '1', HEAVY_WAIT: '1' }).status, 0);
  }, 20000);

  it('on SIGTERM ends a heavy.sh that is still waiting for a slot', async () => {
    const dir = scratch();
    await hold(dir, 'one', { HEAVY_SLOTS: '1' });
    const ran = join(dir, 'ran');
    const waiter = spawn('sh', [heavy, 'sh', '-c', `touch ${ran}`], { env: env(dir, { HEAVY_SLOTS: '1', HEAVY_POLL: '5' }), stdio: 'ignore' });
    holders.push(waiter);
    await new Promise((r) => setTimeout(r, 500));
    const exited = new Promise((resolve) => waiter.on('exit', (code) => resolve(code)));
    const sent = Date.now();
    waiter.kill('SIGTERM');
    assert.equal(await exited, 143);
    assert.ok(Date.now() - sent < 2000, 'the waiter finished its sleep before handling TERM');
    assert.equal(existsSync(ran), false);
  }, 20000);

  it('gives up with 124 when free memory stays under the floor past the wait', () => {
    const dir = scratch();
    const ran = join(dir, 'ran');
    const out = run(dir, ['sh', '-c', `touch ${ran}`], { HEAVY_MIN_FREE: '101', HEAVY_WAIT: '1' });
    assert.equal(out.status, 124);
    assert.equal(existsSync(ran), false);
    assert.match(out.stderr, /memory/i);
  }, 20000);
});

describe('heavy.sh environment', () => {
  // Nx 23 already shares one cache per user across worktrees (~/.nx/<hash>);
  // setting NX_CACHE_DIRECTORY turns that sharing off (share: 'none').
  it('leaves the Nx cache location to Nx, which shares it across worktrees', () => {
    const sh = readFileSync(fileURLToPath(new URL('../../scripts/heavy.sh', import.meta.url)), 'utf8');
    assert.doesNotMatch(sh, /NX_CACHE_DIRECTORY/);
  });
});

describe('the pre-commit hook', () => {
  // The worktree guard refuses a wrapper around the commit command, so the
  // slot is taken inside the hook, around the checks themselves.
  it('runs typecheck, lint and test inside one heavy.sh slot', () => {
    const hook = readFileSync(fileURLToPath(new URL('../../.husky/pre-commit', import.meta.url)), 'utf8');
    const line = hook.split('\n').find((l) => l.includes('scripts/heavy.sh'));
    assert.ok(line, 'pre-commit does not call scripts/heavy.sh');
    assert.match(line, /nx affected -t typecheck test --base=\$base\b/);
    assert.match(line, /npm run lint\b/);
  });

  // Same scope as PR CI: the projects the branch affects since its merge base
  // with origin/main, uncommitted changes included (no --head).
  it('takes the affected base from the merge base with origin/main', () => {
    const hook = readFileSync(fileURLToPath(new URL('../../.husky/pre-commit', import.meta.url)), 'utf8');
    assert.match(hook, /^base=\$\(git merge-base origin\/main HEAD/m);
    assert.doesNotMatch(hook, /--head=/);
  });

  // JEST_SUITE=unit was how commits slipped past a missing database.
  it('refuses a commit with JEST_SUITE set, before anything else runs', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    // No node or npx on this PATH, and no slot to wait for: if the refusal
    // were missing, the hook would fail fast on the missing tools instead.
    const run = spawnSync('sh', ['.husky/pre-commit'], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', JEST_SUITE: 'unit', HEAVY_WAIT: '0', HEAVY_LOCK: join(scratch(), 'slot.lock') },
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /JEST_SUITE/);
    assert.doesNotMatch(run.stdout + run.stderr, /identity|heavy/i);
  });

  it('starts the worktree services in the slot, chained so their failure skips the checks', () => {
    const hook = readFileSync(fileURLToPath(new URL('../../.husky/pre-commit', import.meta.url)), 'utf8');
    const line = hook.split('\n').find((l) => l.includes('scripts/heavy.sh'));
    assert.match(line, /services=\\\$\(node scripts\/test-services\.ts \$base\) && eval \\"\\\$services\\" && TZ=UTC npx nx affected/);
  });

  it('turns the Nx daemon off before anything runs, slot or not', () => {
    const hook = readFileSync(fileURLToPath(new URL('../../.husky/pre-commit', import.meta.url)), 'utf8');
    const lines = hook.split('\n');
    const off = lines.findIndex((l) => /^export NX_DAEMON=false\b/.test(l));
    assert.ok(off !== -1, 'pre-commit does not export NX_DAEMON=false');
    assert.ok(off < lines.findIndex((l) => l.includes('scripts/heavy.sh')));
  });
});
