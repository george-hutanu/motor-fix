import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  JEV_ENDPOINT,
  ask,
  choice,
  choiceOf,
  jevEnabled,
  noul,
  noulOf,
  qid,
  score,
  scoreOf,
  unavailableNote,
} from './jev.mjs';

// Every test injects `fetchImpl` and an explicit `apiKey`. Nothing here may
// reach the network: a spec that needs an API key is a spec that fails in CI
// for a reason unrelated to the code it covers.
const ok = (answers, usage = { input_tokens: 1, output_tokens: 1 }) => ({
  ok: true,
  json: async () => ({ model: 'jev-test', answers, usage }),
});

const capture = (response) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return typeof response === 'function' ? response(calls.length) : response;
  };
  return { calls, fetchImpl };
};

const fixture = () => mkdtempSync(join(tmpdir(), 'jev-'));

describe('question builders', () => {
  it('omits criteria when a noul is asked bare', () => {
    assert.deepEqual(noul('Is it?'), { type: 'noul', instructions: 'Is it?' });
  });

  it('carries both boundaries when either is given', () => {
    assert.deepEqual(noul('Is it?', 'yes side').criteria, { true: 'yes side', false: '' });
  });

  it('accepts a choice as an array of names or a map of glosses', () => {
    assert.deepEqual(choice('Pick', ['a', 'b']).criteria, { a: null, b: null });
    assert.deepEqual(choice('Pick', { a: 'first' }).criteria, { a: 'first' });
  });

  it('keeps a score rubric in the order it was given', () => {
    assert.deepEqual(score('How bad', ['none', 'some', 'lots']).criteria, ['none', 'some', 'lots']);
  });

  it('makes question ids safe as JSON keys', () => {
    assert.equal(qid('FR-003', 'testable'), 'FR_003_testable');
    assert.equal(qid('apps/scanner/src/cli.ts', 1), 'apps_scanner_src_cli_ts_1');
  });
});

describe('ask', () => {
  it('posts the documented wire shape', async () => {
    const { calls, fetchImpl } = capture(ok({ q: { type: 'noul', noul: 0.9 } }));
    await ask({ some: 'state' }, { q: noul('Is it?') }, { apiKey: 'k', fetchImpl });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, JEV_ENDPOINT);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
    assert.equal(calls[0].body.model, 'jev-latest');
    assert.deepEqual(calls[0].body.state, { some: 'state' });
    assert.deepEqual(calls[0].body.questions.q, { type: 'noul', instructions: 'Is it?' });
  });

  it('asks nothing and reports available when there are no questions', async () => {
    const { calls, fetchImpl } = capture(ok({}));
    const result = await ask('state', {}, { apiKey: 'k', fetchImpl });
    assert.equal(calls.length, 0);
    assert.equal(result.unavailable, false);
  });

  it('splits past the per-call ceiling and merges the answers', async () => {
    const questions = Object.fromEntries(
      Array.from({ length: 95 }, (_, i) => [`q${i}`, noul(`Is ${i}?`)]),
    );
    const { calls, fetchImpl } = capture((n) => ok({ [`batch${n}`]: { type: 'noul', noul: 0.5 } }));
    const result = await ask('state', questions, { apiKey: 'k', fetchImpl });

    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((c) => Object.keys(c.body.questions).length), [40, 40, 15]);
    assert.deepEqual(Object.keys(result.answers).sort(), ['batch1', 'batch2', 'batch3']);
    assert.equal(result.usage.input_tokens, 3);
  });

  // The fail-open contract. Each of these is a real production path: no key
  // on a fresh clone, a 500 from the vendor, a wedged socket, a body that is
  // not what the docs promise.
  it('is unavailable, not thrown, without a key', async () => {
    const repo = fixture();
    const { calls, fetchImpl } = capture(ok({}));
    const result = await ask('state', { q: noul('Is it?') }, { repo, fetchImpl, apiKey: '' });
    assert.equal(calls.length, 0);
    assert.equal(result.unavailable, true);
    assert.match(result.reason, /TYPESAFE_API_KEY/);
  });

  it('is unavailable, not thrown, on a non-200', async () => {
    const { fetchImpl } = capture({ ok: false, status: 503 });
    const result = await ask('state', { q: noul('Is it?') }, { apiKey: 'k', fetchImpl });
    assert.equal(result.unavailable, true);
    assert.match(result.reason, /HTTP 503/);
    assert.deepEqual(result.answers, {});
  });

  it('is unavailable, not thrown, when the transport fails', async () => {
    const result = await ask('state', { q: noul('Is it?') }, {
      apiKey: 'k',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    assert.equal(result.unavailable, true);
    assert.match(result.reason, /ECONNREFUSED/);
  });

  it('is unavailable, not thrown, when the body has no answers', async () => {
    const { fetchImpl } = capture({ ok: true, json: async () => ({ unexpected: true }) });
    const result = await ask('state', { q: noul('Is it?') }, { apiKey: 'k', fetchImpl });
    assert.deepEqual(result.answers, {});
  });

  it('keeps the batches that succeeded when one fails', async () => {
    const questions = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`q${i}`, noul(`Is ${i}?`)]),
    );
    const { fetchImpl } = capture((n) => (n === 1 ? { ok: false, status: 500 } : ok({ kept: { type: 'noul', noul: 1 } })));
    const result = await ask('state', questions, { apiKey: 'k', fetchImpl });

    assert.deepEqual(Object.keys(result.answers), ['kept']);
    // Partial, so not unavailable — but the reason survives for the report.
    assert.equal(result.unavailable, false);
    assert.match(result.reason, /HTTP 500/);
  });
});

describe('answer readers', () => {
  it('reads each answer type', () => {
    assert.equal(noulOf({ type: 'noul', noul: 0.42 }), 0.42);
    assert.deepEqual(choiceOf({ type: 'choice', choice: 'patch', confidence: 0.8 }), {
      choice: 'patch',
      confidence: 0.8,
    });
    assert.deepEqual(scoreOf({ type: 'score', score: 1.9, confidence: 0.9, legend: { 2: 'blocking' } }), {
      score: 1.9,
      confidence: 0.9,
      label: 'blocking',
    });
  });

  it('returns undefined rather than a wrong number for a missing answer', () => {
    for (const bad of [undefined, null, {}, { noul: 'high' }]) {
      assert.equal(noulOf(bad), undefined);
      assert.equal(choiceOf(bad), undefined);
      assert.equal(scoreOf(bad), undefined);
    }
  });

  it('defaults a missing confidence to 0 so a caller never treats it as certain', () => {
    assert.equal(choiceOf({ choice: 'defer' }).confidence, 0);
    assert.equal(scoreOf({ score: 1 }).confidence, 0);
  });

  it('says the lane is unavailable without pretending to know why', () => {
    assert.match(unavailableNote(), /unavailable \(disabled\)/);
    assert.match(unavailableNote('HTTP 500'), /HTTP 500/);
  });
});

describe('jevEnabled', () => {
  it('is off when switched off, whatever the key says', () => {
    const repo = fixture();
    writeFileSync(join(repo, '.env'), 'TYPESAFE_API_KEY=abc\n');
    assert.equal(jevEnabled(repo, { SPECKIT_JEV: '0', TYPESAFE_API_KEY: 'abc' }), false);
    assert.equal(jevEnabled(repo, { SPECKIT_JEV: 'false', TYPESAFE_API_KEY: 'abc' }), false);
  });

  it('is off without a key even when switched on', () => {
    const repo = fixture();
    const saved = process.env.TYPESAFE_API_KEY;
    const savedJev = process.env.JEV;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV;
    try {
      assert.equal(jevEnabled(repo, { SPECKIT_JEV: '1' }), false);
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
      if (savedJev !== undefined) process.env.JEV = savedJev;
    }
  });

  it('honours the persisted off switch, and lets the environment override it', () => {
    const repo = fixture();
    mkdirSync(join(repo, '.specify'), { recursive: true });
    writeFileSync(join(repo, '.specify', 'harness-settings.json'), JSON.stringify({ jev: false }));
    const saved = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = 'abc';
    try {
      assert.equal(jevEnabled(repo, {}), false);
      // Same precedence as every other harness setting: the environment wins.
      assert.equal(jevEnabled(repo, { SPECKIT_JEV: '1' }), true);
    } finally {
      if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = saved;
    }
  });
});
