import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// scripts/watch-schedule.sh, run from a copy in a throwaway main checkout with
// fake launchctl, gh, node and claude first on PATH and HOME in the temp dir:
// nothing here loads a real launchd agent or starts a real agent.

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'watch-schedule.sh');
const PLIST = 'Library/LaunchAgents/com.motorfix.watch.plist';
let t;

const fake = (name, body) => {
  const file = join(t.bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
};

beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'watch-schedule-')));
  t = { root, home: join(root, 'home'), bin: join(root, 'bin'), main: join(root, 'main'), calls: join(root, 'calls.log') };
  for (const d of [t.home, t.bin, join(t.main, 'scripts')]) mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', t.main]);
  copyFileSync(SCRIPT, join(t.main, 'scripts', 'watch-schedule.sh'));
  fake('launchctl', `echo "launchctl $*" >> "$CALLS"\ncase "$1" in print) [ -n "$LOADED" ] || exit 113; printf '\\tstate = %s\\n' "$LOADED";; esac\nexit 0`);
  fake('gh', `echo "gh $*" >> "$CALLS"\necho tok-george`);
  fake('claude', 'exit 0');
  fake('node', `echo "node $* token=$GH_TOKEN cwd=$(pwd)" >> "$CALLS"\ncase "$*" in *--gate*) exit "\${GATE_EXIT:-0}";; *--dispatch*) exit "\${DISPATCH_EXIT:-0}";; esac\nexit 0`);
});
afterEach(() => rmSync(t.root, { recursive: true, force: true }));

const run = (verb, extra = {}) => {
  const env = { PATH: `${t.bin}:/usr/bin:/bin`, HOME: t.home, CALLS: t.calls, ...extra };
  try {
    return { status: 0, out: execFileSync('sh', [join(t.main, 'scripts', 'watch-schedule.sh'), ...[].concat(verb)], { cwd: t.root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { status: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};
const calls = () => (existsSync(t.calls) ? readFileSync(t.calls, 'utf8').trim().split('\n') : []);
const passes = () => readFileSync(join(t.main, '.work', 'watch-schedule', 'passes.log'), 'utf8').trim().split('\n');

describe('scripts/watch-schedule.sh', () => {
  // @traces 1361-FR-003
  it('install renders the launchd agent for the main checkout every 900 s and bootstraps it', () => {
    const r = run('install');
    assert.equal(r.status, 0, r.out);
    const plist = readFileSync(join(t.home, PLIST), 'utf8');
    assert.match(plist, /<key>Label<\/key>\s*<string>com\.motorfix\.watch<\/string>/);
    assert.match(plist, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
    assert.ok(plist.includes(`<string>${join(t.main, 'scripts', 'watch-schedule.sh')}</string>`), plist);
    assert.match(plist, /<string>run<\/string>/);
    assert.ok(plist.includes(`<key>WorkingDirectory</key>`) && plist.includes(`<string>${t.main}</string>`), plist);
    assert.ok(plist.includes(`${t.bin}:`), 'PATH holds the directory of node, claude and gh');
    assert.ok(plist.includes(join(t.main, '.work', 'watch-schedule')), 'launchd output goes under .work');
    const uid = execFileSync('id', ['-u'], { encoding: 'utf8' }).trim();
    assert.ok(calls().includes(`launchctl bootstrap gui/${uid} ${join(t.home, PLIST)}`), calls().join('\n'));
  });

  // @traces 1361-FR-003
  it('uninstall boots the agent out and removes its plist', () => {
    assert.equal(run('install').status, 0);
    const r = run('uninstall');
    assert.equal(r.status, 0, r.out);
    assert.ok(!existsSync(join(t.home, PLIST)));
    assert.ok(calls().some((l) => l.startsWith('launchctl bootout gui/')), calls().join('\n'));
  });

  // @traces 1361-FR-003
  it('status prints whether the agent is loaded and the last pass', () => {
    mkdirSync(join(t.main, '.work', 'watch-schedule'), { recursive: true });
    writeFileSync(join(t.main, '.work', 'watch-schedule', 'passes.log'), '2026-10-21T10:00:00Z gate 0\n2026-10-21T10:15:00Z gate 2 dispatch 0\n');
    const loaded = run('status', { LOADED: 'not running' });
    assert.equal(loaded.status, 0, loaded.out);
    assert.match(loaded.out, /state = not running/);
    assert.match(loaded.out, /2026-10-21T10:15:00Z gate 2 dispatch 0/);
    assert.doesNotMatch(loaded.out, /10:00:00Z/);
    assert.match(run('status').out, /not loaded/);
  });

  // @traces 1361-FR-001
  it('run runs the gate and nothing more when it finds no work', () => {
    const r = run('run', { GATE_EXIT: '0' });
    assert.equal(r.status, 0, r.out);
    const nodes = calls().filter((l) => l.startsWith('node '));
    assert.equal(nodes.length, 1);
    assert.ok(nodes[0].startsWith('node .claude/scripts/watch.mjs --gate'), nodes[0]);
    assert.ok(nodes[0].includes(`token=tok-george cwd=${t.main}`), nodes[0]);
    assert.ok(calls().includes('gh auth token -u george-hutanu'));
    assert.match(passes().at(-1), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ gate 0$/);
  });

  // @traces 1361-FR-001
  it('run dispatches when the gate exits 2, and logs both exit codes', () => {
    const r = run('run', { GATE_EXIT: '2', DISPATCH_EXIT: '0' });
    assert.equal(r.status, 0, r.out);
    const nodes = calls().filter((l) => l.startsWith('node '));
    assert.deepEqual(nodes.map((l) => l.split(' token=')[0]), ['node .claude/scripts/watch.mjs --gate', 'node .claude/scripts/watch.mjs --dispatch']);
    assert.match(passes().at(-1), / gate 2 dispatch 0$/);
  });

  // @traces 1361-FR-001
  it('run logs a failing gate and dispatches nothing', () => {
    run('run', { GATE_EXIT: '1' });
    assert.equal(calls().filter((l) => l.startsWith('node ')).length, 1);
    assert.match(passes().at(-1), / gate 1$/);
  });

  // @traces 1361-FR-001
  it('run logs a missing george-hutanu token and runs no gate under gh\'s active account', () => {
    fake('gh', `echo "gh $*" >> "$CALLS"\necho "no oauth token found for george-hutanu" >&2\nexit 1`);
    const r = run('run', { GATE_EXIT: '2', GH_TOKEN: 'tok-work' });
    assert.equal(r.status, 1, r.out);
    assert.deepEqual(calls().filter((l) => l.startsWith('node ')), []);
    assert.match(passes().at(-1), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ no token for george-hutanu$/);
  });

  // @traces 1361-FR-003
  it('refuses every verb in a cloud session and touches nothing', () => {
    for (const verb of ['install', 'uninstall', 'status', 'run']) {
      const r = run(verb, { CLAUDE_CODE_REMOTE: 'true', GATE_EXIT: '2' });
      assert.notEqual(r.status, 0, verb);
      assert.match(r.out, /cloud session/, verb);
    }
    assert.deepEqual(calls(), []);
    assert.ok(!existsSync(join(t.home, PLIST)));
    assert.ok(!existsSync(join(t.main, '.work')));
  });

  // @traces 1361-FR-005
  it('is described in the speckit-watch skill and AGENTS.md, with the claim both sides share', () => {
    const read = (rel) => readFileSync(join(import.meta.dirname, '..', '..', rel), 'utf8').replace(/\s+/g, ' ');
    const skill = read('.claude/skills/speckit-watch/SKILL.md');
    const scheduling = skill.slice(skill.indexOf('## Keeping it scheduled'), skill.indexOf('## Limits'));
    assert.match(scheduling, /scripts\/watch-schedule\.sh install/);
    assert.match(scheduling, /watch\.mjs --dispatch/);
    assert.match(scheduling, /shares the claim/);
    assert.match(skill, /`claim refused: <fix> claimed <m> min ago`[^.]*skip that entry/);
    const bullet = read('AGENTS.md').match(/ - Parallel work is watched:.*?(?= - [A-Z])/)[0];
    assert.match(bullet, /scripts\/watch-schedule\.sh install/);
    assert.match(bullet, /share the claim/);
  });

  // @traces 1357-FR-009
  // @traces 1357-FR-006
  it('run --gate-only appends the gate\'s plan lines to the day\'s plan file and dispatches nothing', () => {
    fake('node', `echo "node $* token=$GH_TOKEN cwd=$(pwd)" >> "$CALLS"\ncase "$*" in *--gate*) printf 'tail .worktrees/a #12\\nmerge .worktrees/b #13\\n'; exit 2;; esac\nexit 0`);
    const r = run(['run', '--gate-only']);
    assert.equal(r.status, 2, r.out);
    assert.deepEqual(calls().filter((l) => l.startsWith('node ')).map((l) => l.split(' token=')[0]), ['node .claude/scripts/watch.mjs --gate']);
    const day = new Date().toISOString().slice(0, 10);
    const plan = readFileSync(join(t.main, '.work', 'watch-schedule', `plan-${day}.log`), 'utf8').trim().split('\n');
    assert.equal(plan.length, 2);
    assert.match(plan[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ tail \.worktrees\/a #12$/);
    assert.match(plan[1], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ merge \.worktrees\/b #13$/);
    assert.match(passes().at(-1), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ gate 2 gate-only$/);
    assert.ok(!existsSync(join(t.main, '.work', 'watch-dispatch')));
  });

  // @traces 1357-FR-009
  it('run --gate-only writes no plan file when the gate finds nothing or fails', () => {
    for (const code of ['0', '1']) {
      const r = run(['run', '--gate-only'], { GATE_EXIT: code });
      assert.equal(r.status, Number(code), r.out);
      assert.match(passes().at(-1), new RegExp(` gate ${code} gate-only$`));
    }
    assert.deepEqual(readdirSync(join(t.main, '.work', 'watch-schedule')).filter((f) => f.startsWith('plan-')), []);
    assert.equal(calls().filter((l) => l.includes('--dispatch')).length, 0);
  });

  // @traces 1357-FR-009
  it('install --gate-only renders a plist that runs the pass gate-only; status names the newest plan file', () => {
    assert.equal(run(['install', '--gate-only']).status, 0);
    assert.match(readFileSync(join(t.home, PLIST), 'utf8'), /<string>run<\/string>\s*<string>--gate-only<\/string>/);
    mkdirSync(join(t.main, '.work', 'watch-schedule'), { recursive: true });
    for (const d of ['2026-10-20', '2026-10-21']) writeFileSync(join(t.main, '.work', 'watch-schedule', `plan-${d}.log`), 'x\n');
    assert.match(run('status').out, /plan files: .*plan-2026-10-21\.log/);
  });

  // @traces 1357-FR-009
  it('run --dispatch is today\'s pass, and --gate-only with --dispatch is a usage error that runs nothing', () => {
    const r = run(['run', '--dispatch'], { GATE_EXIT: '2' });
    assert.equal(r.status, 0, r.out);
    assert.match(passes().at(-1), / gate 2 dispatch 0$/);
    const both = run(['run', '--gate-only', '--dispatch'], { GATE_EXIT: '2' });
    assert.equal(both.status, 64);
    assert.match(both.out, /usage/);
    assert.equal(calls().filter((l) => l.startsWith('node ')).length, 2, 'only the first run reached node');
    assert.notEqual(run(['install', '--gate-only', '--dispatch']).status, 0);
    assert.ok(!existsSync(join(t.home, PLIST)));
  });

  // @traces 1357-FR-011
  it('run --gate-only never calls launchctl', () => {
    run(['run', '--gate-only'], { GATE_EXIT: '2' });
    assert.deepEqual(calls().filter((l) => l.startsWith('launchctl')), []);
  });

  it('refuses an unknown verb', () => {
    assert.notEqual(run('frobnicate').status, 0);
  });
});
