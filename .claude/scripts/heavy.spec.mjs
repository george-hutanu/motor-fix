import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
afterEach(() => {
  for (const h of holders.splice(0)) h.kill();
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

  it('gives up with 124 when free memory stays under the floor past the wait', () => {
    const dir = scratch();
    const ran = join(dir, 'ran');
    const out = run(dir, ['sh', '-c', `touch ${ran}`], { HEAVY_MIN_FREE: '101', HEAVY_WAIT: '1' });
    assert.equal(out.status, 124);
    assert.equal(existsSync(ran), false);
    assert.match(out.stderr, /memory/i);
  }, 20000);
});
