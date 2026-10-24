import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BODY, REQUIRED, main } from './branch-protection.mjs';

const protection = (contexts = REQUIRED, admins = true) => ({ required_status_checks: { strict: false, contexts }, enforce_admins: { enabled: admins } });
const ok = (body) => ({ code: 0, stdout: JSON.stringify(body), stderr: '' });

/** A fake gh run recording every call; `answer(args)` gives its result. */
function fakeRun(answer) {
  const calls = [];
  const run = (file, args, opts = {}) => {
    calls.push({ file, args, input: opts.input, env: opts.env });
    return answer(args);
  };
  return { calls, run };
}

const go = (argv, answer, env = { GH_TOKEN: 'owner-token' }) => {
  const lines = [];
  const { calls, run } = fakeRun(answer);
  const code = main(argv, { run, env, log: (l) => lines.push(l) });
  return { code, calls, out: lines.join('\n') };
};

describe('branch-protection: agent-review and CI OK required on main', () => {
  // @traces 961-FR-006
  it('apply PUTs the protection: both contexts, not strict, admins enforced, no reviews or restrictions, no force push or deletion', () => {
    const { code, calls } = go(['apply'], (args) => ok(args.includes('PUT') ? protection() : protection()));
    assert.equal(code, 0);
    const put = calls.find((c) => c.args.includes('PUT'));
    assert.ok(put.args.includes('repos/george-hutanu/motor-fix/branches/main/protection'));
    assert.deepEqual(JSON.parse(put.input), BODY);
    assert.deepEqual(BODY, {
      required_status_checks: { strict: false, contexts: ['CI OK', 'agent-review'] },
      enforce_admins: true,
      required_pull_request_reviews: null,
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false,
    });
    assert.equal(put.env.GH_TOKEN, 'owner-token');
  });

  // @traces 961-FR-006
  it('apply reads the protection back and fails when GitHub did not keep it', () => {
    const { code, out } = go(['apply'], (args) => ok(args.includes('PUT') ? {} : protection(['CI OK'])));
    assert.equal(code, 1);
    assert.match(out, /agent-review/);
  });

  // @traces 961-FR-006
  it('check passes only when both contexts are required and admins are not exempt', () => {
    assert.equal(go(['check'], () => ok(protection())).code, 0);
    assert.equal(go(['check'], () => ok(protection(['CI OK', 'agent-review', 'body']))).code, 0);
    const missing = go(['check'], () => ok(protection(['CI OK'])));
    assert.equal(missing.code, 1);
    assert.match(missing.out, /agent-review/);
    const none = go(['check'], () => ok({ enforce_admins: { enabled: true } }));
    assert.match(none.out, /CI OK/);
    assert.match(none.out, /agent-review/);
    const admins = go(['check'], () => ok(protection(REQUIRED, false)));
    assert.equal(admins.code, 1);
    assert.match(admins.out, /enforce_admins/);
  });

  // @traces 961-FR-006
  it('check fails on an unprotected branch and names it', () => {
    const { code, out } = go(['check'], () => ({ code: 1, stdout: '', stderr: 'gh: Branch not protected (HTTP 404)' }));
    assert.equal(code, 1);
    assert.match(out, /not protected/);
  });

  // @traces 961-FR-006
  it('refuses to run without the owner\'s token, and in a cloud session', () => {
    const none = go(['apply'], (args) => (args[0] === 'auth' ? { code: 1, stdout: '', stderr: 'no login' } : ok(protection())), {});
    assert.equal(none.code, 1);
    assert.equal(none.calls.filter((c) => c.args.includes('PUT')).length, 0);
    const cloud = go(['apply'], () => ok(protection()), { GH_TOKEN: 'proxy', CLAUDE_CODE_REMOTE: 'true' });
    assert.equal(cloud.code, 1);
    assert.equal(cloud.calls.length, 0);
  });

  it('names its usage on anything else', () => {
    assert.equal(go([], () => ok({})).code, 64);
    assert.equal(go(['delete'], () => ok({})).code, 64);
  });
});

describe('the rule is written where agents read it', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\s+/g, ' ');

  // @traces 961-FR-008
  it('AGENTS.md step 7 and the lifecycle name the required checks and the Dependabot review workflow', () => {
    assert.match(read('../../AGENTS.md'), /7\. Merge on `agent-review` success[^]*?GitHub requires `agent-review` and `CI OK` on `main`, admins too/);
    const lifecycle = read('../skills/speckit-auto/lifecycle.md');
    assert.match(lifecycle, /`agent-review` and `CI OK` are required status checks on `main`, for administrators too/);
    assert.match(lifecycle, /dependabot-review\.yml[^.]*writes its `agent-review` success/);
  });
});
