import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  disabledIds,
  fingerprint,
  hookById,
  isDryRun,
  isEnabled,
  loadRegistry,
  profileOf,
  scriptPath,
} from '../scripts/lib/hooks.mjs';

// These guard the hook registry, not the taskr CLI. The fingerprint test is
// the load-bearing one: it fails the suite (and therefore the pre-commit gate)
// the moment a gate's own script changes without the registry being re-blessed,
// which is the edit every weakened gate needs.

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const RUNNER = join(REPO, '.claude/hooks/run-hook.mjs');

const runHook = (id, payload, env = {}) =>
  spawnSync(process.execPath, [RUNNER, id], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO, ...env },
  });

describe('hook registry — contents', () => {
  it('loads and describes every armed hook', () => {
    const registry = loadRegistry(REPO);
    assert.ok(registry, 'registry.json must parse');
    assert.ok(registry.hooks.length > 0);
    for (const entry of registry.hooks) {
      assert.match(entry.id, /^[a-z]+(:[a-z-]+)+$/, `${entry.id} id shape`);
      assert.ok(entry.event, `${entry.id} names an event`);
      assert.ok(entry.description?.length > 20, `${entry.id} has a real description`);
      assert.ok(existsSync(scriptPath(REPO, entry)), `${entry.id} script exists`);
    }
  });

  it('has unique ids', () => {
    const ids = loadRegistry(REPO).hooks.map((h) => h.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('fingerprints match the scripts on disk', () => {
    for (const entry of loadRegistry(REPO).hooks) {
      assert.equal(
        fingerprint(scriptPath(REPO, entry)),
        entry.fingerprint,
        `${entry.id}: ${entry.script} changed — review it, then run \`node scripts/doctor.mjs --bless-hooks\``,
      );
    }
  });

  it('registers every hook script, helpers aside', () => {
    const registry = loadRegistry(REPO);
    const known = new Set([
      ...registry.hooks.map((h) => h.script),
      ...(registry.helpers ?? []).map((h) => h.script),
      'run-hook.mjs',
    ]);
    // Specs live beside the gate they cover here, and a spec is not a gate.
    const onDisk = readdirSync(join(REPO, '.claude/hooks')).filter(
      (f) => /\.(mjs|js|sh)$/.test(f) && !/\.(spec|test)\.[cm]?js$/.test(f),
    );
    for (const file of onDisk) assert.ok(known.has(file), `${file} is not in the registry`);
  });

  it('wires every registry id into settings.json, and nothing else', () => {
    const settings = JSON.parse(
      spawnSync('cat', [join(REPO, '.claude/settings.json')], { encoding: 'utf8' }).stdout,
    );
    const wired = Object.values(settings.hooks)
      .flat()
      .flatMap((e) => e.hooks)
      .map((h) => h.command.split(/\s+/).pop());
    const registered = loadRegistry(REPO).hooks.map((h) => h.id);
    assert.deepEqual([...wired].sort(), [...registered].sort());
  });
});

describe('hook registry — profiles and flags', () => {
  const entry = { id: 'x:y', profiles: ['strict'] };

  it('defaults to the standard profile and rejects junk', () => {
    assert.equal(profileOf({}), 'standard');
    assert.equal(profileOf({ SPECKIT_HOOK_PROFILE: 'nonsense' }), 'standard');
    assert.equal(profileOf({ SPECKIT_HOOK_PROFILE: 'STRICT' }), 'strict');
  });

  it('arms nothing under profile off', () => {
    assert.equal(isEnabled(entry, { SPECKIT_HOOK_PROFILE: 'off' }).enabled, false);
  });

  it('honours the per-id disable list', () => {
    assert.deepEqual([...disabledIds({ SPECKIT_DISABLED_HOOKS: 'a:b, c:d ' })], ['a:b', 'c:d']);
    const off = isEnabled(entry, { SPECKIT_HOOK_PROFILE: 'strict', SPECKIT_DISABLED_HOOKS: 'x:y' });
    assert.equal(off.enabled, false);
    assert.match(off.reason, /SPECKIT_DISABLED_HOOKS/);
  });

  it('skips a hook outside the active profile', () => {
    assert.equal(isEnabled(entry, { SPECKIT_HOOK_PROFILE: 'standard' }).enabled, false);
    assert.equal(isEnabled(entry, { SPECKIT_HOOK_PROFILE: 'strict' }).enabled, true);
  });

  it('reads the dry-run flag in every spelling that means yes', () => {
    for (const v of ['1', 'true', 'YES', 'on']) assert.equal(isDryRun({ SPECKIT_HOOKS_DRY_RUN: v }), true);
    for (const v of ['0', '', 'off']) assert.equal(isDryRun({ SPECKIT_HOOKS_DRY_RUN: v }), false);
  });

  it('treats an unknown id as not-a-gate', () => {
    assert.equal(hookById(REPO, 'nope'), null);
    assert.deepEqual(isEnabled(null), { enabled: false, reason: 'not in the registry' });
  });
});

describe('run-hook.mjs — the wrapper', () => {
  const blocked = { tool_input: { command: 'git ' + 'reset --hard HEAD~1' } };

  it('propagates a gate block', () => {
    const run = runHook('pre:bash:guard', blocked);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /Bash guard/);
  });

  it('lets an innocent call through', () => {
    assert.equal(runHook('pre:bash:guard', { tool_input: { command: 'ls -la' } }).status, 0);
  });

  it('downgrades a block to a report under dry run', () => {
    const run = runHook('pre:bash:guard', blocked, { SPECKIT_HOOKS_DRY_RUN: '1' });
    assert.equal(run.status, 0);
    assert.match(run.stderr, /DRY RUN — pre:bash:guard would have blocked/);
    assert.match(run.stderr, /Bash guard/);
  });

  it('disarms the gate under profile off and per-id disable', () => {
    assert.equal(runHook('pre:bash:guard', blocked, { SPECKIT_HOOK_PROFILE: 'off' }).status, 0);
    assert.equal(
      runHook('pre:bash:guard', blocked, { SPECKIT_DISABLED_HOOKS: 'pre:bash:guard' }).status,
      0,
    );
  });

  it('never breaks a session over an unknown id', () => {
    const run = runHook('made:up:id', blocked);
    assert.equal(run.status, 0);
    assert.match(run.stderr, /no registry entry/);
  });
});

// An unreadable request used to be read as consent: every gate that can refuse
// did `catch { process.exit(0) }`, so a payload too large to arrive intact
// passed all of them without a word. The wrapper owns stdin, so it refuses on
// their behalf — but only for the entries the registry marks `fail_closed`.
const runHookRaw = (id, raw, env = {}) =>
  spawnSync(process.execPath, [RUNNER, id], {
    input: raw,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO, ...env },
  });

const TRUNCATED = '{"tool_input": {"command": "git rese';
const DESTRUCTIVE = { tool_input: { command: 'git reset' + ' --hard origin/main' } };

describe('hook registry — fail-closed stdin', () => {
  it('marks every gate that can refuse, and nothing that cannot', () => {
    const byId = Object.fromEntries(loadRegistry(REPO).hooks.map((h) => [h.id, h]));
    for (const id of [
      'pre:bash:guard',
      'pre:bash:commit-gate',
      'pre:edit:config-protection',
      'pre:edit:red-first',
      'stop:test-gate',
      'subagent:verdict',
    ])
      assert.equal(byId[id]?.fail_closed, true, `${id} can refuse, so it must fail closed`);

    // Advisory hooks are not marked: the edit has already landed by the time
    // post:edit:affected-tests runs, and refusing a stop because the telemetry
    // payload was long helps nobody.
    for (const id of ['session:start:context', 'post:edit:affected-tests', 'stop:telemetry', 'pre:compact:flush'])
      assert.ok(!byId[id]?.fail_closed, `${id} is advisory and must not refuse`);
  });

  it('refuses a fail-closed gate when the payload is not valid JSON', () => {
    const run = runHookRaw('pre:bash:guard', TRUNCATED);
    assert.equal(run.status, 2, 'a gate that cannot read the request has not approved it');
    assert.match(run.stderr, /not valid JSON/);
  });

  it('refuses a fail-closed gate when the payload exceeds the cap', () => {
    const run = runHookRaw('pre:bash:guard', JSON.stringify(DESTRUCTIVE), {
      SPECKIT_HOOK_INPUT_MAX_BYTES: '16',
    });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /exceeded 16 bytes/);
  });

  it('passes an oversized payload through to an advisory hook', () => {
    // stop:telemetry writes a counts-only ledger; a long transcript is normal
    // there, and a refusal would end the session over bookkeeping.
    const run = runHookRaw('stop:telemetry', JSON.stringify({ session_id: 'x'.repeat(4096) }), {
      SPECKIT_HOOK_INPUT_MAX_BYTES: '16',
    });
    assert.equal(run.status, 0);
    assert.doesNotMatch(run.stderr, /refused/);
  });

  it('treats empty stdin as nothing to judge, not as a corrupted request', () => {
    // Different condition from "arrived truncated", and the gates already
    // handle it — refusing here would break every by-hand invocation.
    assert.equal(runHookRaw('pre:bash:guard', '').status, 0);
  });

  it('reports the refusal instead of blocking under dry run', () => {
    const run = runHookRaw('pre:bash:guard', TRUNCATED, { SPECKIT_HOOKS_DRY_RUN: '1' });
    assert.equal(run.status, 0);
    assert.match(run.stderr, /DRY RUN/);
  });

  it('still runs a fail-closed gate on a payload it can read', () => {
    const run = runHook('pre:bash:guard', DESTRUCTIVE);
    assert.equal(run.status, 2, 'the gate itself must still be the one deciding');
    assert.match(run.stderr, /destroys uncommitted work/);
  });
});
