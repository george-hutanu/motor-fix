import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const { HEAVY_HELD, HEAVY_WAIT, HEAVY_SLOTS, HEAVY_MIN_FREE, CLAUDE_CODE_REMOTE, ...inherited } = process.env;
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

  // @traces 749-FR-004
  it('has two slots by default in a cloud session, so a third command waits', async () => {
    const dir = scratch();
    const cloud = { CLAUDE_CODE_REMOTE: 'true' };
    await hold(dir, 'one', cloud);
    await hold(dir, 'two', cloud);
    const third = join(dir, 'third');
    const out = run(dir, ['sh', '-c', `touch ${third}`], { ...cloud, HEAVY_WAIT: '1' });
    assert.equal(out.status, 124);
    assert.equal(existsSync(third), false);
    assert.match(out.stderr, /all 2 slots busy/);
  }, 20000);

  it('lets HEAVY_SLOTS override the cloud default', async () => {
    const dir = scratch();
    const cloud = { CLAUDE_CODE_REMOTE: 'true', HEAVY_SLOTS: '3' };
    await hold(dir, 'one', cloud);
    await hold(dir, 'two', cloud);
    assert.equal(run(dir, ['true'], { ...cloud, HEAVY_WAIT: '1' }).status, 0);
  }, 20000);

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

  // ST-1350: a shell whose child is stopped before it runs its next step, so
  // the tree is listed first and signalled parent first, in one kill.
  it('stops a command tree parent first: lists the whole tree root first, then signals it in one kill', async () => {
    const dir = scratch();
    const sh = readFileSync(heavy, 'utf8');
    const fns = join(dir, 'fns.sh');
    writeFileSync(fns, sh.match(/^tree\(\) \{[\s\S]*?^\}\nkilltree\(\) \{[\s\S]*?^\}$/m)[0]);
    assert.match(readFileSync(fns, 'utf8'), /^\s*kill -TERM \$\(tree "\$1"\)/m, 'killtree does not signal the listed tree in one kill');
    const root = spawn('sh', ['-c', 'sh -c "sleep 30; :" & sleep 30 & wait'], { stdio: 'ignore' });
    holders.push(root);
    await new Promise((r) => setTimeout(r, 500));
    const out = spawnSync('sh', ['-c', `. ${fns}; tree ${root.pid}`], { encoding: 'utf8' });
    const pids = out.stdout.trim().split('\n').map(Number);
    assert.equal(pids[0], root.pid, 'the root is not listed first');
    assert.equal(pids.length, 4, `expected root, two children and a grandchild, got ${pids}`);
    for (const [i, pid] of pids.entries()) {
      if (i === 0) continue;
      const ppid = Number(spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
      assert.ok(pids.indexOf(ppid) > -1 && pids.indexOf(ppid) < i, `pid ${pid} is listed before its parent ${ppid}`);
    }
    const exited = new Promise((resolve) => root.once('exit', (code, signal) => resolve(signal)));
    spawnSync('sh', ['-c', `. ${fns}; killtree ${root.pid}`]);
    assert.equal(await exited, 'SIGTERM');
    for (const pid of pids) assert.notEqual(spawnSync('kill', ['-0', String(pid)]).status, 0, `pid ${pid} still runs`);
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

// @traces 1363-throughput-fixes-FR-005
describe('heavy.sh and the worktree port set', () => {
  // A copy of heavy.sh in a scratch checkout: the set it reads is its own checkout's.
  const checkout = (portsEnv) => {
    const dir = scratch();
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'scripts', 'heavy.sh'), readFileSync(heavy));
    if (portsEnv) {
      mkdirSync(join(dir, '.specify', '.cache'), { recursive: true });
      writeFileSync(join(dir, '.specify', '.cache', 'ports.env'), portsEnv);
    }
    return dir;
  };
  const ports = (dir) => {
    const { API_PORT, WEB_PORT, ...rest } = env(dir);
    return spawnSync('sh', [join(dir, 'scripts', 'heavy.sh'), 'sh', '-c', 'echo "$API_PORT|$WEB_PORT"'], { encoding: 'utf8', env: rest }).stdout.trim();
  };

  it('runs the command with the checkout ports.env when there is one', () => {
    assert.equal(ports(checkout("export API_PORT='54002'\nexport WEB_PORT='54004'\n")), '54002|54004');
  });

  it('adds no port variable when the checkout has no set', () => {
    assert.equal(ports(checkout()), '|');
  });
});

describe('the pre-commit hook', () => {
  const hook = () => readFileSync(fileURLToPath(new URL('../../.husky/pre-commit', import.meta.url)), 'utf8');
  const code = () => hook().split('\n').filter((l) => !l.startsWith('#')).join('\n');

  // @traces 1355-FR-002
  // @traces 1358-FR-015
  it('keeps the fast checks only: identity, the folder rules and Biome on the staged files', () => {
    const lines = code().split('\n');
    assert.ok(lines.includes('sh .husky/identity.sh check'));
    assert.ok(lines.includes('node scripts/structure-check.ts --base origin/main'));
    assert.ok(lines.includes('npx biome check --staged --no-errors-on-unmatched'));
  });

  // @traces 1355-FR-002
  // @traces 1358-FR-015
  it('takes no heavy slot and runs no typecheck, test or full lint: lifecycle.mjs check does, per slice and at ready', () => {
    assert.doesNotMatch(code(), /scripts\/heavy\.sh|nx affected|npm run lint|npm test|jest/);
    assert.match(hook(), /lifecycle\.mjs\s*(#\s*)?check/);
  });

  // Without origin/main the folder rules cannot compare their baseline: the
  // hook stops first and says how to fix it.
  it('stops with a clear message when origin/main is missing, before the folder rules', () => {
    const repo = scratch();
    spawnSync('git', ['init', '-q'], { cwd: repo });
    for (const dir of ['.husky', 'scripts']) mkdirSync(join(repo, dir), { recursive: true });
    writeFileSync(join(repo, '.husky/pre-commit'), hook());
    writeFileSync(join(repo, '.husky/identity.sh'), 'exit 0\n');
    writeFileSync(join(repo, 'scripts/structure-check.ts'), 'require("node:fs").writeFileSync("structure-ran", "")\n');
    const res = spawnSync('sh', ['.husky/pre-commit'], { cwd: repo, encoding: 'utf8' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /origin\/main is missing/);
    assert.match(res.stderr, /git fetch origin main/);
    assert.equal(existsSync(join(repo, 'structure-ran')), false);
  });

  it('starts no test services', () => {
    assert.doesNotMatch(code(), /test-services|docker/);
  });
});
