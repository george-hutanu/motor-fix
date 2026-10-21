import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { proofFor } from './dispatch.mjs';
import { flowsHash, proofPath } from './precheck.mjs';

const SCRIPT = join(import.meta.dirname, 'dispatch.mjs');
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function checkout() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'dispatch-adv-')));
  roots.push(repo);
  const git = (...args) => {
    const r = spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
    return r.stdout.trim();
  };
  spawnSync('git', ['init', '-q', '-b', 'main', repo]);
  const commit = (files, message = 'change') => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const flows = join(repo, 'flows.mjs');
  writeFileSync(flows, 'export default async () => [];\n');
  const spec = join(repo, 'scratch-spec.txt');
  writeFileSync(spec, '# A spec with no scenarios\n');
  const hash = flowsHash(flows);
  const stamp = (sha, h = hash) => {
    mkdirSync(dirname(proofPath(repo, sha, h)), { recursive: true });
    writeFileSync(proofPath(repo, sha, h), '');
  };
  return { repo, git, commit, flows, hash, stamp, spec };
}

describe('a flows proof for an earlier sha', () => {
  // @traces 1361-FR-007
  it('holds across an empty commit, which changes nothing', () => {
    const t = checkout();
    const proved = t.commit({ 'apps/api/src/a.ts': 'export const a = 1;\n' });
    const head = t.commit({}, 'retrigger ci');
    t.stamp(proved);
    const out = proofFor({ root: t.repo, sha: head, hash: t.hash });
    assert.deepEqual(out, { proof: proofPath(t.repo, proved, t.hash) });
  });

  // @traces 1361-FR-007
  it('does not cover a head on a diverged branch, even when the proved commit is documentation-adjacent', () => {
    const t = checkout();
    const base = t.commit({ 'apps/api/src/a.ts': 'export const a = 1;\n' });
    t.git('checkout', '-q', '-b', 'other');
    const other = t.commit({ 'docs/other.md': '# Other\n' });
    t.git('checkout', '-q', 'main');
    const head = t.commit({ 'docs/head.md': '# Head\n' });
    t.stamp(other);
    const { refused, proof } = proofFor({ root: t.repo, sha: head, hash: t.hash });
    assert.equal(proof, undefined, `proved at ${other.slice(0, 7)}, base ${base.slice(0, 7)}`);
    assert.ok(refused);
  });

  // @traces 1361-FR-007
  it('refuses a gap that edits documentation and one code file in the same commit, naming the code file', () => {
    const t = checkout();
    const proved = t.commit({ 'apps/api/src/a.ts': 'export const a = 1;\n' });
    const head = t.commit({ 'docs/guide.md': '# Guide\n', 'libs/domain/src/x.ts': 'export const x = 1;\n' });
    t.stamp(proved);
    const { refused } = proofFor({ root: t.repo, sha: head, hash: t.hash });
    assert.match(refused, /libs\/domain\/src\/x\.ts/);
    assert.doesNotMatch(refused, /docs\/guide\.md/);
  });

  // @traces 1361-FR-007
  it('refuses a gap that moves a code file into a Markdown path', () => {
    const t = checkout();
    const proved = t.commit({ 'apps/api/src/a.ts': 'export const a = 1;\n' });
    renameSync(join(t.repo, 'apps/api/src/a.ts'), join(t.repo, 'a-note.md'));
    const head = t.commit({}, 'looks like a doc');
    t.stamp(proved);
    const { refused, proof } = proofFor({ root: t.repo, sha: head, hash: t.hash });
    assert.equal(proof, undefined);
    assert.match(refused, /apps\/api\/src\/a\.ts/);
  });

  // @traces 1361-FR-007
  it('refuses a gap that edits Markdown the harness reads: under .claude, .specify and .github', () => {
    for (const path of ['.claude/skills/speckit-watch/SKILL.md', '.specify/memory/constitution.md', '.github/pull_request_template.md']) {
      const t = checkout();
      const proved = t.commit({ 'apps/api/src/a.ts': 'export const a = 1;\n' });
      const head = t.commit({ [path]: '# Changed\n' });
      t.stamp(proved);
      const { refused } = proofFor({ root: t.repo, sha: head, hash: t.hash });
      assert.ok(refused, path);
      assert.match(refused, new RegExp(path.replaceAll('.', '\\.')));
    }
  });

});

describe('dispatch --flows from a real checkout', () => {
  const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(join(process.env.FAKE_GH_DIR, 'calls.log'), args.join(' ') + '\\n');
const say = (v) => process.stdout.write(JSON.stringify(v));
const [a, b] = args;
if (a === 'pr' && b === 'view') say({ state: 'OPEN', headRefOid: process.env.FAKE_HEAD });
else if (a === 'api' && b === 'repos/{owner}/{repo}/pulls/62') say({ state: 'open', head: { sha: process.env.FAKE_HEAD } });
else if (a === 'workflow' && b === 'run') writeFileSync(join(process.env.FAKE_GH_DIR, 'nonce'), JSON.parse(readFileSync(0, 'utf8')).nonce);
else if (a === 'run' && b === 'list') say([{ databaseId: 77, displayTitle: 'PR QA ' + readFileSync(join(process.env.FAKE_GH_DIR, 'nonce'), 'utf8'), url: 'https://x/runs/77' }]);
`;

  function run(t, argv, { cwd = t.repo, head }) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dispatch-adv-gh-')));
    roots.push(dir);
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'gh'), FAKE_GH);
    chmodSync(join(dir, 'bin', 'gh'), 0o755);
    const r = spawnSync(process.execPath, [SCRIPT, '62', '--out', join(dir, 'out'), '--no-wait', ...argv], {
      cwd,
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, CLAUDE_CODE_REMOTE: '', PATH: `${join(dir, 'bin')}:${process.env.PATH}`, FAKE_GH_DIR: dir, FAKE_HEAD: head, PR_QA_POLL_MS: '1', PR_QA_POLL_TRIES: '1' },
    });
    const calls = existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n') : [];
    return { code: r.status, stderr: r.stderr, workflowRuns: calls.filter((c) => c.startsWith('workflow run')) };
  }

  // @traces 1361-FR-007
  it('refuses with exit 64 and dispatches nothing when code changed since the proof, naming the file', () => {
    const t = checkout();
    const proved = t.commit({ 'apps/api/src/a.ts': 'export const a = 1;\n' });
    const head = t.commit({ 'apps/api/src/b.ts': 'export const b = 1;\n' });
    t.stamp(proved);
    const r = run(t, ['--flows', t.flows, '--spec', t.spec], { head });
    assert.equal(r.code, 64, r.stderr);
    assert.match(r.stderr, /apps\/api\/src\/b\.ts/);
    assert.deepEqual(r.workflowRuns, []);
  });

  // @traces 1361-FR-007
  it('finds the proof when it is run from a subfolder of the checkout', () => {
    const t = checkout();
    const head = t.commit({ 'apps/api/src/a.ts': 'export const a = 1;\n' });
    t.stamp(head);
    const r = run(t, ['--flows', t.flows, '--spec', t.spec], { head, cwd: join(t.repo, 'apps', 'api', 'src') });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.workflowRuns.length, 1);
  });

});
