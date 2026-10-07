import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ROUTED, SMALL, LARGE, MIN_CONFIDENCE, band, chooseModel, parseRange, response, routerOff } from './agent-model-router.mjs';

// What this hook must not do is the point of most of these: it must not refuse
// a call, must not route an agent whose model is already a decision, and must
// not reach the network for a diff whose size already answers the question.

const HOOK = fileURLToPath(new URL('./agent-model-router.mjs', import.meta.url));
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A fetch that answers one choice question, and records whether it was called. */
const KEY = 'test-key-not-a-credential';

const stubJev = (choice, confidence = 0.9) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ answers: { model: { type: 'choice', choice, confidence } }, usage: null }) };
  };
  impl.calls = calls;
  return impl;
};

const never = () => {
  throw new Error('the lane was called for a diff the thresholds already decided');
};

describe('model router — the diff range', () => {
  it('reads the range the reviewer was handed', () => {
    assert.equal(parseRange('Review specs/016-x against a1b2c3d..HEAD please'), 'a1b2c3d..HEAD');
    assert.equal(parseRange('diff range main...HEAD'), 'main...HEAD');
  });

  it('keeps a revision whole rather than matching its tail', () => {
    // The bug this pins: a class without `~` still matches `1..b2fb29f` out of
    // `b2fb29f~1..b2fb29f`, and git is handed a range that does not resolve.
    assert.equal(parseRange('review b2fb29f~1..b2fb29f'), 'b2fb29f~1..b2fb29f');
    assert.equal(parseRange('review HEAD^..HEAD'), 'HEAD^..HEAD');
  });

  it('is null when the prompt names none, so nothing is guessed', () => {
    assert.equal(parseRange('Review the working tree'), null);
    assert.equal(parseRange(undefined), null);
  });
});

describe('model router — the bands', () => {
  it('calls a handful of lines small', () => {
    assert.equal(band({ files: SMALL.files, lines: SMALL.lines }), 'small');
  });

  it('calls either dimension past the ceiling large', () => {
    assert.equal(band({ files: LARGE.files, lines: 10 }), 'large');
    assert.equal(band({ files: 1, lines: LARGE.lines }), 'large');
  });

  it('asks only in between', () => {
    assert.equal(band({ files: 8, lines: 200 }), 'ask');
  });

  it('has no band for an unknown size', () => {
    assert.equal(band(null), null);
  });
});

describe('model router — choosing', () => {
  it('takes sonnet for a small diff without asking anything', async () => {
    const picked = await chooseModel({ files: 1, lines: 12 }, 'code-reviewer', { repo, fetchImpl: never });
    assert.equal(picked.model, 'sonnet');
    assert.match(picked.why, /1 files, 12 lines/);
  });

  it('takes fable for a large diff without asking anything', async () => {
    const picked = await chooseModel({ files: 40, lines: 2000 }, 'spec-reviewer', { repo, fetchImpl: never, fableTo: null });
    assert.equal(picked.model, 'fable');
  });

  it('takes opus instead of fable on a large diff while the fable switch is off (813-FR-004)', async () => {
    const picked = await chooseModel({ files: 40, lines: 2000 }, 'spec-reviewer', { repo, fetchImpl: never, fableTo: 'claude-opus-5-5' });
    assert.equal(picked.model, 'opus');
    assert.match(picked.why, /fable switch off/);
  });

  it('takes opus when the lane answers fable while the switch is off (813-FR-004)', async () => {
    const picked = await chooseModel({ files: 8, lines: 200 }, 'code-reviewer', { repo, fetchImpl: stubJev('fable'), apiKey: KEY, fableTo: 'claude-opus-5-5' });
    assert.equal(picked.model, 'opus');
  });

  it('leaves sonnet alone while the switch is off (813-FR-004)', async () => {
    const picked = await chooseModel({ files: 1, lines: 12 }, 'code-reviewer', { repo, fetchImpl: never, fableTo: 'claude-opus-5-5' });
    assert.equal(picked.model, 'sonnet');
  });

  it('reads the switch from the environment when the caller does not pass it (813-FR-004)', async () => {
    const before = process.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'claude-opus-5-5';
    try {
      const picked = await chooseModel({ files: 40, lines: 2000 }, 'spec-reviewer', { repo, fetchImpl: never });
      assert.equal(picked.model, 'opus');
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
      else process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = before;
    }
  });

  it('asks the lane in the middle band and carries its answer', async () => {
    const fetchImpl = stubJev('fable');
    const picked = await chooseModel({ files: 8, lines: 200 }, 'code-reviewer', { repo, fetchImpl, apiKey: KEY, fableTo: null });
    assert.equal(picked.model, 'fable');
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].state.review, 'code-reviewer');
  });

  it('routes nothing when the lane is unavailable', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500 });
    assert.equal(await chooseModel({ files: 8, lines: 200 }, 'code-reviewer', { repo, fetchImpl, apiKey: KEY }), null);
  });

  it('routes nothing when the lane cannot separate the two', async () => {
    const fetchImpl = stubJev('sonnet', MIN_CONFIDENCE - 0.01);
    assert.equal(await chooseModel({ files: 8, lines: 200 }, 'code-reviewer', { repo, fetchImpl, apiKey: KEY }), null);
  });

  it('routes nothing when the answer names a model it was not offered', async () => {
    const fetchImpl = stubJev('haiku');
    assert.equal(await chooseModel({ files: 8, lines: 200 }, 'code-reviewer', { repo, fetchImpl, apiKey: KEY }), null);
  });

  it('routes nothing for a size git could not report', async () => {
    assert.equal(await chooseModel(null, 'code-reviewer', { repo, fetchImpl: never }), null);
  });
});

describe('model router — the response', () => {
  const input = { subagent_type: 'code-reviewer', prompt: 'review a..b', description: 'review' };

  it('echoes the whole tool input, so nothing is dropped by the rewrite', () => {
    const out = JSON.parse(response(input, 'code-reviewer', { model: 'sonnet', why: 'small' }));
    assert.deepEqual(out.hookSpecificOutput.updatedInput, { ...input, model: 'sonnet' });
  });

  it('announces every switch it makes', () => {
    const out = JSON.parse(response(input, 'code-reviewer', { model: 'sonnet', why: '2 files, 9 lines' }));
    assert.match(out.hookSpecificOutput.systemMessage, /code-reviewer on sonnet \(2 files, 9 lines\)/);
  });

  it('never carries a permission decision — this hook cannot refuse a call', () => {
    const out = JSON.parse(response(input, 'code-reviewer', { model: 'fable', why: 'big' }));
    assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  });
});

describe('model router — as a hook', () => {
  const run = (payload, env = {}) =>
    spawnSync(process.execPath, [HOOK], {
      encoding: 'utf8',
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env },
    });

  const silent = (result) => {
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
  };

  it('ignores every tool but the subagent one', () => {
    silent(run({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
  });

  it('leaves an agent the caller already chose a model for', () => {
    silent(run({ tool_name: 'Agent', tool_input: { subagent_type: 'code-reviewer', model: 'opus', prompt: 'a..b' } }));
  });

  it('leaves the agents whose frontmatter already answers this', () => {
    silent(run({ tool_name: 'Agent', tool_input: { subagent_type: 'mutation-runner', prompt: 'a..b' } }));
    assert.ok(!ROUTED.has('mutation-runner'));
  });

  it('leaves a review with no range to size', () => {
    silent(run({ tool_name: 'Agent', tool_input: { subagent_type: 'spec-reviewer', prompt: 'review the feature' } }));
  });

  it('does nothing at all when it is switched off', () => {
    silent(run({ tool_name: 'Agent', tool_input: { subagent_type: 'code-reviewer', prompt: 'a1b2c3d..HEAD' } }, { SPECKIT_MODEL_ROUTER: '0' }));
    assert.equal(routerOff({ SPECKIT_MODEL_ROUTER: '0' }), true);
    assert.equal(routerOff({}), false);
  });

  it('passes a malformed payload through rather than failing the call', () => {
    silent(run('not json at all'));
    silent(run(''));
  });
});
