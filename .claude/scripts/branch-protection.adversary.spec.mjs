import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { BODY, REQUIRED, main, missing } from './branch-protection.mjs';

const prot = (contexts = REQUIRED, admins = true) => ({ required_status_checks: { strict: false, contexts }, enforce_admins: { enabled: admins } });
const ok = (b) => ({ code: 0, stdout: typeof b === 'string' ? b : JSON.stringify(b), stderr: '' });

const go = (argv, answer, env = { GH_TOKEN: 'owner-token-secret' }) => {
  const calls = [];
  const lines = [];
  const run = (file, args, opts = {}) => {
    calls.push({ file, args, input: opts.input, env: opts.env });
    return answer(args, opts);
  };
  let code;
  try {
    code = main(argv, { run, env, log: (l) => lines.push(String(l)) });
  } catch (e) {
    code = `threw ${e.message}`;
  }
  return { code, calls, out: lines.join('\n') };
};

describe('branch-protection: hostile protections and environments', () => {
  // @traces 961-FR-006
  it('missing names both contexts and admins for null, undefined and empty protections', () => {
    for (const p of [null, undefined, {}]) {
      const lacks = missing(p).join(' ');
      assert.match(lacks, /CI OK/);
      assert.match(lacks, /agent-review/);
      assert.match(lacks, /enforce_admins/);
    }
  });

  // @traces 961-FR-006
  it('a context that merely contains a required name does not satisfy it', () => {
    const lacks = missing(prot(['CI OK extra', 'agent-review-old', 'pre-agent-review'])).join(' ');
    assert.match(lacks, /CI OK/);
    assert.match(lacks, /agent-review/);
  });

  // @traces 961-FR-006
  it('contexts given as one string do not count as a list holding both names', () => {
    assert.equal(missing({ ...prot(), required_status_checks: { contexts: 'CI OK agent-review' } }).length, 2);
  });

  // @traces 961-FR-006
  it('names are matched exactly: case and surrounding space differ', () => {
    assert.equal(missing(prot(['ci ok', 'Agent-Review'])).length, 2);
    assert.equal(missing(prot([' CI OK', 'agent-review '])).length, 2);
  });

  // @traces 961-FR-006
  it('admins exempt is flagged for every shape but an object with enabled true', () => {
    for (const enforce_admins of [false, undefined, null, { enabled: 'true' }, { enabled: 1 }, {}]) {
      assert.deepEqual(missing({ ...prot(), enforce_admins }).length, 1, JSON.stringify(enforce_admins));
    }
  });

  // @traces 961-FR-006
  it('a protection with both contexts, admins on and extra contexts is complete', () => {
    assert.deepEqual(missing(prot(['a', 'CI OK', 'b', 'agent-review'])), []);
  });

  // @traces 961-FR-006
  it('check exits 1 rather than throwing on an empty or non-JSON answer from a successful call', () => {
    for (const stdout of ['', 'not json', '<html>502</html>']) {
      const r = go(['check'], () => ok(stdout));
      assert.equal(r.code, 1, JSON.stringify(stdout));
    }
  });

  // @traces 961-FR-006
  it('apply exits 1 when the read-back is not JSON', () => {
    const r = go(['apply'], (args) => (args.includes('PUT') ? ok({}) : ok('garbage')));
    assert.equal(r.code, 1);
  });

  // @traces 961-FR-006
  it('check never PUTs, and apply stops without reading back when the PUT is refused', () => {
    const check = go(['check'], () => ok(prot()));
    assert.equal(check.calls.filter((x) => x.args.includes('PUT')).length, 0);
    const apply = go(['apply'], (args) => (args.includes('PUT') ? { code: 1, stdout: '', stderr: 'HTTP 403' } : ok(prot())));
    assert.equal(apply.code, 1);
    assert.equal(apply.calls.length, 1);
    assert.match(apply.out, /403/);
  });

  // @traces 961-FR-006
  it('apply PUTs the body byte for byte, and only to main\'s protection path', () => {
    const r = go(['apply'], () => ok(prot()));
    const puts = r.calls.filter((x) => x.args.includes('PUT'));
    assert.equal(puts.length, 1);
    assert.equal(puts[0].input, JSON.stringify(BODY));
    assert.ok(puts[0].args.includes('repos/george-hutanu/motor-fix/branches/main/protection'));
    assert.ok(r.calls.every((x) => x.file === 'gh'));
  });

  // @traces 961-FR-006
  it('the PUT body keeps the required list a separate copy, so a caller cannot widen it by editing REQUIRED', () => {
    assert.deepEqual(BODY.required_status_checks.checks.map((c) => c.context), ['CI OK', 'agent-review']);
    assert.ok(Object.isFrozen(REQUIRED) || BODY.required_status_checks.checks !== REQUIRED);
  });

  // @traces 961-FR-006
  it('never prints the token', () => {
    const good = go(['check'], () => ok(prot()));
    const bad = go(['apply'], () => ({ code: 1, stdout: '', stderr: 'denied' }));
    assert.doesNotMatch(good.out, /owner-token-secret/);
    assert.doesNotMatch(bad.out, /owner-token-secret/);
  });

  // @traces 961-FR-006
  it('does not use the workflow GITHUB_TOKEN as the owner token', () => {
    const r = go(['check'], (args) => (args[0] === 'auth' ? { code: 1, stdout: '', stderr: 'no login' } : ok(prot())), { GITHUB_TOKEN: 'workflow-token' });
    assert.equal(r.code, 1);
    assert.equal(r.calls.filter((x) => x.args[0] === 'api').length, 0);
  });

  // @traces 961-FR-006
  it('a whitespace-only GH_TOKEN falls back to the george-hutanu gh login', () => {
    const r = go(['check'], (args) => (args[0] === 'auth' ? { code: 0, stdout: 'from-gh\n', stderr: '' } : ok(prot())), { GH_TOKEN: '   ' });
    assert.equal(r.code, 0);
    const api = r.calls.find((x) => x.args[0] === 'api');
    assert.equal(api.env.GH_TOKEN, 'from-gh');
    assert.deepEqual(r.calls[0].args, ['auth', 'token', '-u', 'george-hutanu']);
  });

  // @traces 961-FR-006
  it('an empty gh auth answer with exit 0 is no token', () => {
    const r = go(['apply'], (args) => (args[0] === 'auth' ? { code: 0, stdout: '\n', stderr: '' } : ok(prot())), {});
    assert.equal(r.code, 1);
    assert.equal(r.calls.filter((x) => x.args.includes('PUT')).length, 0);
  });

  // @traces 961-FR-006
  it('refuses in a cloud session even when only the check is asked, and reads nothing', () => {
    const r = go(['check'], () => ok(prot()), { GH_TOKEN: 'proxy', CLAUDE_CODE_REMOTE: 'true' });
    assert.equal(r.code, 1);
    assert.equal(r.calls.length, 0);
  });

  // @traces 961-FR-006
  it('verbs are exact: case, extra words and flags are usage errors', () => {
    for (const argv of [['APPLY'], ['Check'], ['--apply'], [''], [undefined], ['apply ']]) {
      assert.equal(go(argv, () => ok(prot())).code, 64, JSON.stringify(argv));
    }
  });
});
