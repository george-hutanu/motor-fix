import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REAL = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const GUARD = 'pre:bash:guard';
const COMMIT = 'pre:bash:commit-gate';
const ADVISORY = 'pre:tool:agent-model';
const PAYLOAD = { tool_name: 'Bash', tool_input: { command: 'ls' } };

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runhook-crash-'));
  cpSync(join(REAL, '.claude/hooks'), join(dir, '.claude/hooks'), { recursive: true });
  cpSync(join(REAL, '.claude/scripts'), join(dir, '.claude/scripts'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (file, body) => {
  const p = join(dir, '.claude/hooks', file);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
};
const run = (id, env = {}, input = JSON.stringify(PAYLOAD)) =>
  spawnSync(process.execPath, [join(dir, '.claude/hooks/run-hook.mjs'), id], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      SPECKIT_HOOKS_DRY_RUN: '',
      SPECKIT_DISABLED_HOOKS: '',
      SPECKIT_HOOK_PROFILE: '',
      CLAUDE_PROJECT_DIR: dir,
      ...env,
    },
  });

describe('a fail-closed gate that crashes', () => {
  it('refuses when the script has a syntax error and shows the parse error first', () => {
    put('bash-guard.mjs', 'const = ;\n');
    const r = run(GUARD);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /SyntaxError/);
    assert.ok(r.stderr.indexOf('SyntaxError') < r.stderr.indexOf('SPECKIT_DISABLED_HOOKS=pre:bash:guard'));
  });

  it('refuses when the script throws at top level', () => {
    put('bash-guard.mjs', "throw new Error('boom-marker');\n");
    const r = run(GUARD);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /boom-marker/);
    assert.match(r.stderr, /SPECKIT_DISABLED_HOOKS=pre:bash:guard/);
  });

  for (const code of [3, 127, 130, 255]) {
    it(`refuses on exit ${code} and names the code`, () => {
      put('bash-guard.mjs', `process.exit(${code});\n`);
      const r = run(GUARD);
      assert.equal(r.status, 2);
      assert.match(r.stderr, new RegExp(`\\b${code}\\b`));
    });
  }

  it('refuses when the shell gate exits 1', () => {
    put('pre-commit-check.sh', '#!/bin/sh\necho shell-out\necho shell-err >&2\nexit 1\n');
    const r = run(COMMIT, {}, JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }));
    assert.equal(r.status, 2);
    assert.match(r.stdout, /shell-out/);
    assert.match(r.stderr, /shell-err/);
    assert.match(r.stderr, /SPECKIT_DISABLED_HOOKS=pre:bash:commit-gate/);
  });

  it('refuses when the shell gate is not executable-parsable (syntax error)', () => {
    put('pre-commit-check.sh', '#!/bin/sh\nif then fi\n');
    const r = run(COMMIT, {}, JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }));
    assert.equal(r.status, 2);
  });

  it('keeps exit 2 as a block and adds no crash refusal', () => {
    put('bash-guard.mjs', "console.error('blocked-marker'); process.exit(2);\n");
    const r = run(GUARD);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /blocked-marker/);
    assert.doesNotMatch(r.stderr, /SPECKIT_DISABLED_HOOKS/);
  });

  it('keeps exit 0 as a pass with no refusal text', () => {
    put('bash-guard.mjs', 'process.exit(0);\n');
    const r = run(GUARD);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stderr, /SPECKIT_DISABLED_HOOKS/);
  });

  it('does not run the gate when its id is one of several disabled ids', () => {
    put('bash-guard.mjs', 'process.exit(1);\n');
    const r = run(GUARD, { SPECKIT_DISABLED_HOOKS: `x:y, ${GUARD} ,a:b` });
    assert.equal(r.status, 0);
  });

  it('does not treat a different disabled id as a waiver', () => {
    put('bash-guard.mjs', 'process.exit(1);\n');
    const r = run(GUARD, { SPECKIT_DISABLED_HOOKS: COMMIT });
    assert.equal(r.status, 2);
  });

  it('arms nothing under profile off', () => {
    put('bash-guard.mjs', 'process.exit(1);\n');
    const r = run(GUARD, { SPECKIT_HOOK_PROFILE: 'off' });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stderr, /SPECKIT_DISABLED_HOOKS/);
  });

  it('refuses a crash even when the payload is empty', () => {
    put('bash-guard.mjs', 'process.exit(1);\n');
    const r = run(GUARD, {}, '');
    assert.equal(r.status, 2);
  });

  it('prints a single refusal line naming the id exactly once', () => {
    put('bash-guard.mjs', 'process.exit(1);\n');
    const r = run(GUARD);
    const hits = r.stderr.split('\n').filter((l) => l.includes('SPECKIT_DISABLED_HOOKS=pre:bash:guard'));
    assert.equal(hits.length, 1);
  });

  it('refuses a fail-closed entry marked in a copied registry even when the id is new', () => {
    const regPath = join(dir, '.claude/hooks/registry.json');
    const reg = JSON.parse(readFileSync(regPath, 'utf8'));
    reg.hooks.push({
      id: 'pre:test:crasher',
      event: 'PreToolUse',
      matcher: 'Bash',
      script: 'crasher.mjs',
      profiles: ['standard', 'strict'],
      description: 'A synthetic gate that always crashes, to prove the wrapper reads the flag',
      fail_closed: true,
      fingerprint: 'x',
    });
    writeFileSync(regPath, JSON.stringify(reg));
    put('crasher.mjs', 'process.exit(1);\n');
    const r = run('pre:test:crasher');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /SPECKIT_DISABLED_HOOKS=pre:test:crasher/);
  });

  it('passes exit 1 through once fail_closed is false in the registry', () => {
    const regPath = join(dir, '.claude/hooks/registry.json');
    const reg = JSON.parse(readFileSync(regPath, 'utf8'));
    reg.hooks.find((h) => h.id === GUARD).fail_closed = false;
    writeFileSync(regPath, JSON.stringify(reg));
    put('bash-guard.mjs', 'process.exit(1);\n');
    const r = run(GUARD);
    assert.equal(r.status, 1);
  });
});

describe('an advisory hook keeps its exit code', () => {
  for (const code of [3, 127]) {
    it(`passes exit ${code} through with output and no refusal`, () => {
      put('agent-model-router.mjs', `console.log('adv-out'); console.error('adv-err'); process.exit(${code});\n`);
      const r = run(ADVISORY, {}, JSON.stringify({ tool_name: 'Agent', tool_input: {} }));
      assert.equal(r.status, code);
      assert.match(r.stdout, /adv-out/);
      assert.match(r.stderr, /adv-err/);
      assert.doesNotMatch(r.stderr, /SPECKIT_DISABLED_HOOKS/);
    });
  }

  it('passes a syntax-error crash through as exit 1 with no refusal', () => {
    put('agent-model-router.mjs', 'const = ;\n');
    const r = run(ADVISORY, {}, JSON.stringify({ tool_name: 'Agent', tool_input: {} }));
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stderr, /SPECKIT_DISABLED_HOOKS/);
  });

  it('passes exit 2 through unchanged', () => {
    put('agent-model-router.mjs', 'process.exit(2);\n');
    const r = run(ADVISORY, {}, JSON.stringify({ tool_name: 'Agent', tool_input: {} }));
    assert.equal(r.status, 2);
  });

  it('is downgraded like any block under dry run, with no crash refusal', () => {
    put('agent-model-router.mjs', 'process.exit(1);\n');
    const r = run(ADVISORY, { SPECKIT_HOOKS_DRY_RUN: '1' }, JSON.stringify({ tool_name: 'Agent', tool_input: {} }));
    assert.equal(r.status, 0);
    assert.match(r.stderr, /would have blocked/);
    assert.doesNotMatch(r.stderr, /SPECKIT_DISABLED_HOOKS/);
  });
});
