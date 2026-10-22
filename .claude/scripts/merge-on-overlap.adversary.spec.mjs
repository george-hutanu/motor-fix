import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latestLapReport, overlap } from './merge-main.mjs';

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'watch-schedule.sh');
const STORAGE = "the PR's docker-compose.yml has no storage service: merge main into the branch";
const none = { prFiles: ['.claude/skills/x/SKILL.md'], mainFiles: ['README.md'], mergeable: 'MERGEABLE', lapReport: null };

// @traces 1357-FR-003
describe('overlap edge cases', () => {
  it('does not treat look-alike compose, lock and workflow names as infra paths', () => {
    for (const path of ['docker-compose.yml.bak', 'docker-compose.yaml', 'package-lock.json.orig', 'my-package-lock.json', 'apps/api/openapi.json.bak', '.github/workflow/ci.yml', '.github/workflows-old/ci.yml', '.claude/hooks/registry.json.bak', '.specify/capability/x.md']) {
      assert.equal(overlap({ ...none, mainFiles: [path] }).needed, false, path);
    }
  });

  it('matches deep paths under the recursive infra folders', () => {
    for (const path of ['.github/workflows/a/b/c.yml', 'libs/domain/prisma/migrations/2026/x/migration.sql', '.specify/capabilities/deep/er/x.md']) {
      assert.deepEqual(overlap({ ...none, mainFiles: [path] }), { needed: true, rule: 'infra path' }, path);
    }
  });

  it('matches docker-compose with any middle part', () => {
    for (const path of ['docker-compose.override.yml', 'docker-compose-ci.yml', 'docker-compose.a.b.yml']) {
      assert.equal(overlap({ ...none, mainFiles: [path] }).rule, 'infra path', path);
    }
  });

  it('is not needed when main changed nothing, whatever the PR changed', () => {
    assert.deepEqual(overlap({ ...none, prFiles: ['apps/api/src/a.ts'], mainFiles: [] }), { needed: false, rule: null });
  });

  it('is not needed when the PR changed nothing and main changed no infra path', () => {
    assert.deepEqual(overlap({ ...none, prFiles: [], mainFiles: ['apps/api/src/a.ts'] }), { needed: false, rule: null });
  });

  it('matches projects on the first two segments exactly for libs too', () => {
    assert.equal(overlap({ ...none, prFiles: ['libs/domain/src/a.ts'], mainFiles: ['libs/domain-extra/src/a.ts'] }).needed, false);
    assert.equal(overlap({ ...none, prFiles: ['libs/domain-extra/src/a.ts'], mainFiles: ['libs/domain/src/a.ts'] }).needed, false);
    assert.equal(overlap({ ...none, prFiles: ['apps/web-e2e/a.ts'], mainFiles: ['apps/web/a.ts'] }).needed, false);
  });

  it('treats a project path with no file under it as the project itself', () => {
    assert.equal(overlap({ ...none, prFiles: ['apps/web'], mainFiles: ['apps/web/src/a.ts'] }).needed, false);
  });

  it('keeps paths with spaces and unicode distinct', () => {
    assert.equal(overlap({ ...none, prFiles: ['docs/café notes.md'], mainFiles: ['docs/cafe notes.md'] }).needed, false);
    assert.equal(overlap({ ...none, prFiles: ['docs/café notes.md'], mainFiles: ['docs/café notes.md'] }).rule, 'same file');
  });

  it('is case-sensitive on the storage message and on file names', () => {
    assert.equal(overlap({ ...none, lapReport: STORAGE.toUpperCase() }).needed, false);
    assert.equal(overlap({ ...none, prFiles: ['Docs/A.md'], mainFiles: ['docs/a.md'] }).needed, false);
  });

  it('finds the storage message anywhere in a long report', () => {
    const report = `${'noise\n'.repeat(10000)}${STORAGE}\n${'more\n'.repeat(10)}`;
    assert.deepEqual(overlap({ ...none, lapReport: report }), { needed: true, rule: 'lap report' });
  });

  it('answers a ten-thousand-file overlap with the same-file rule', () => {
    const many = Array.from({ length: 10000 }, (_, i) => `docs/f${i}.md`);
    assert.deepEqual(overlap({ ...none, prFiles: many, mainFiles: [...many].reverse() }), { needed: true, rule: 'same file' });
  });

  it('answers the same on a second call with the same input', () => {
    const input = { ...none, mainFiles: ['package-lock.json'] };
    assert.deepEqual(overlap(input), overlap(input));
  });
});

// @traces 1357-FR-003
describe('latestLapReport edge cases', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lap-adv-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const lap = (name, text) => {
    mkdirSync(join(dir, 'pr-review', name), { recursive: true });
    if (text !== null) writeFileSync(join(dir, 'pr-review', name, 'report.md'), text);
  };

  it('returns null for a feature with no pr-review folder', () => {
    assert.equal(latestLapReport(dir), null);
  });

  it('returns null for an empty pr-review folder', () => {
    mkdirSync(join(dir, 'pr-review'));
    assert.equal(latestLapReport(dir), null);
  });

  it('orders laps numerically, so lap10 beats lap9', () => {
    lap('lap9', 'nine');
    lap('lap10', 'ten');
    lap('lap2', 'two');
    assert.equal(latestLapReport(dir), 'ten');
  });

  it('ignores folders that are not lap<k>', () => {
    lap('lap1', 'one');
    lap('lapx', 'x');
    lap('lap', 'bare');
    lap('lap1x', 'onex');
    lap('xlap9', 'xnine');
    lap('Lap9', 'upper');
    assert.equal(latestLapReport(dir), 'one');
  });

  it('reads lap01 as lap 1 and picks lap2 over it', () => {
    lap('lap01', 'zero-one');
    lap('lap2', 'two');
    assert.equal(latestLapReport(dir), 'two');
  });

  it('does not fall back to an older lap when the newest has no report', () => {
    lap('lap1', 'one');
    lap('lap2', null);
    assert.equal(latestLapReport(dir), null);
  });

  it('returns null for a missing or empty feature directory argument', () => {
    assert.equal(latestLapReport(join(dir, 'nope')), null);
    assert.equal(latestLapReport(undefined), null);
  });

  it('is not fooled by a storage message in an older lap when the latest is clean', () => {
    lap('lap1', STORAGE);
    lap('lap2', 'all flows passed');
    assert.deepEqual(overlap({ ...none, lapReport: latestLapReport(dir) }), { needed: false, rule: null });
  });
});

let t;
const fake = (name, body) => {
  const file = join(t.bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
};
const gateSays = (text, code = 2) => fake('node', `echo "node $* token=$GH_TOKEN" >> "$CALLS"\ncase "$*" in *--gate*) printf '%s' '${text}'; exit ${code};; esac\nexit 0`);
const run = (args, extra = {}) => {
  const env = { PATH: `${t.bin}:/usr/bin:/bin`, HOME: t.home, CALLS: t.calls, ...extra };
  try {
    return { status: 0, out: execFileSync('sh', [join(t.main, 'scripts', 'watch-schedule.sh'), ...[].concat(args)], { cwd: t.root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { status: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};
const calls = () => (existsSync(t.calls) ? readFileSync(t.calls, 'utf8').trim().split('\n') : []);
const work = () => join(t.main, '.work', 'watch-schedule');
const planFile = () => join(work(), `plan-${new Date().toISOString().slice(0, 10)}.log`);
const PLIST = 'Library/LaunchAgents/com.motorfix.watch.plist';

// @traces 1357-FR-009
describe('watch-schedule.sh --gate-only edge cases', { timeout: 30000 }, () => {
  beforeEach(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'watch-sched-adv-')));
    t = { root, home: join(root, 'home'), bin: join(root, 'bin'), main: join(root, 'main'), calls: join(root, 'calls.log') };
    for (const d of [t.home, t.bin, join(t.main, 'scripts')]) mkdirSync(d, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', t.main]);
    copyFileSync(SCRIPT, join(t.main, 'scripts', 'watch-schedule.sh'));
    fake('launchctl', 'echo "launchctl $*" >> "$CALLS"\nexit 0');
    fake('gh', 'echo "gh $*" >> "$CALLS"\necho tok-george');
    fake('claude', 'exit 0');
  });
  afterEach(() => rmSync(t.root, { recursive: true, force: true }));

  it('keeps plan lines with slashes, ampersands, backslashes and quotes verbatim after the time', () => {
    const line = 'fix .worktrees/a&b/c #12 a\\1 "q" $HOME `x` | y';
    gateSays(`${line}\n`);
    assert.equal(run(['run', '--gate-only']).status, 2);
    const plan = readFileSync(planFile(), 'utf8').trim().split('\n');
    assert.equal(plan.length, 1);
    assert.match(plan[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ /);
    assert.equal(plan[0].replace(/^\S+ /, ''), line);
  });

  it('prefixes every line of a plan that has no trailing newline', () => {
    gateSays('one\ntwo');
    assert.equal(run(['run', '--gate-only']).status, 2);
    const plan = readFileSync(planFile(), 'utf8').trim().split('\n');
    assert.deepEqual(plan.map((l) => l.replace(/^\S+ /, '')), ['one', 'two']);
  });

  it('exits 2 and logs the pass when the gate says 2 with no output, writing no empty plan line', () => {
    gateSays('');
    assert.equal(run(['run', '--gate-only']).status, 2);
    assert.match(readFileSync(join(work(), 'passes.log'), 'utf8').trim().split('\n').at(-1), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ gate 2 gate-only$/);
    const plan = existsSync(planFile()) ? readFileSync(planFile(), 'utf8').split('\n').filter((l) => l.trim() !== '') : [];
    assert.deepEqual(plan.filter((l) => /^\S+Z\s*$/.test(l)), []);
  });

  it('appends a second pass to the same day file instead of replacing it', () => {
    gateSays('first\n');
    run(['run', '--gate-only']);
    gateSays('second\n');
    run(['run', '--gate-only']);
    const plan = readFileSync(planFile(), 'utf8').trim().split('\n').map((l) => l.replace(/^\S+ /, ''));
    assert.deepEqual(plan, ['first', 'second']);
  });

  it('exits with the gate code for codes other than 0, 1 and 2 and writes no plan file', () => {
    gateSays('weird\n', 3);
    const r = run(['run', '--gate-only']);
    assert.equal(r.status, 3, r.out);
    assert.ok(!existsSync(planFile()));
    assert.equal(calls().filter((l) => l.includes('--dispatch')).length, 0);
  });

  it('refuses --dispatch before --gate-only the same way', () => {
    gateSays('x\n');
    const r = run(['run', '--dispatch', '--gate-only']);
    assert.equal(r.status, 64);
    assert.match(r.out, /usage/);
    assert.deepEqual(calls().filter((l) => l.startsWith('node ')), []);
  });

  it('refuses an unknown flag with a usage error and runs nothing', () => {
    gateSays('x\n');
    const r = run(['run', '--bogus']);
    assert.notEqual(r.status, 0);
    assert.notEqual(r.status, 2, 'not the gate code');
    assert.deepEqual(calls().filter((l) => l.startsWith('node ')), []);
  });

  it('refuses an unknown flag next to --gate-only', () => {
    gateSays('x\n');
    const r = run(['run', '--gate-only', '--bogus']);
    assert.notEqual(r.status, 0);
    assert.notEqual(r.status, 2);
    assert.deepEqual(calls().filter((l) => l.startsWith('node ')), []);
  });

  it('refuses an unknown verb even with a valid flag, and touches nothing', () => {
    const r = run(['frobnicate', '--gate-only']);
    assert.notEqual(r.status, 0);
    assert.deepEqual(calls(), []);
    assert.ok(!existsSync(t.home + '/' + PLIST));
  });

  it('refuses install with an unknown flag and writes no plist', () => {
    gateSays('');
    const r = run(['install', '--bogus']);
    assert.notEqual(r.status, 0);
    assert.ok(!existsSync(join(t.home, PLIST)));
    assert.deepEqual(calls().filter((l) => l.startsWith('launchctl')), []);
  });

  it('install --dispatch renders the same pass as install and no gate-only flag', () => {
    gateSays('');
    assert.equal(run(['install', '--dispatch']).status, 0);
    const plist = readFileSync(join(t.home, PLIST), 'utf8');
    assert.match(plist, /<string>run<\/string>/);
    assert.doesNotMatch(plist, /gate-only/);
  });

  it('install --gate-only --dispatch bootstraps nothing', () => {
    gateSays('');
    const r = run(['install', '--gate-only', '--dispatch']);
    assert.equal(r.status, 64);
    assert.deepEqual(calls().filter((l) => l.startsWith('launchctl')), []);
  });

  it('refuses a cloud session under --gate-only and touches nothing', () => {
    gateSays('x\n');
    const r = run(['run', '--gate-only'], { CLAUDE_CODE_REMOTE: 'true' });
    assert.equal(r.status, 1);
    assert.match(r.out, /cloud session/);
    assert.ok(!existsSync(join(t.main, '.work')));
    assert.deepEqual(calls(), []);
  });

  it('logs a missing george-hutanu token under --gate-only, exits 1 and runs no gate', () => {
    fake('gh', 'echo "gh $*" >> "$CALLS"\necho "no oauth token found" >&2\nexit 1');
    gateSays('x\n');
    const r = run(['run', '--gate-only'], { GH_TOKEN: 'tok-work' });
    assert.equal(r.status, 1, r.out);
    assert.match(readFileSync(join(work(), 'passes.log'), 'utf8').trim().split('\n').at(-1), /no token for george-hutanu$/);
    assert.deepEqual(calls().filter((l) => l.startsWith('node ')), []);
    assert.ok(!existsSync(planFile()));
  });

  it('never claims: the only node call is the gate', () => {
    gateSays('tail a\n');
    run(['run', '--gate-only']);
    assert.deepEqual(calls().filter((l) => l.startsWith('node ')).map((l) => l.split(' token=')[0]), ['node .claude/scripts/watch.mjs --gate']);
    assert.ok(!readdirSync(join(t.main, '.work')).includes('watch-dispatch'));
  });

  it('status says plan files: none when there are no plan files', () => {
    const r = run('status');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /plan files: none/);
  });
});
