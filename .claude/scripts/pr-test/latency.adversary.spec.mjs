import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latencyOf, measure, median, readyAt, render } from './latency.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'latency.mjs');
const R = '2026-10-11T10:00:00Z';
const review = (at, body = 'Verdict: success (agent-review on abc1234)') => ({ submitted_at: at, body });

describe('median', () => {
  it('is null for no values and for values that are all null', () => {
    assert.equal(median([]), null);
    assert.equal(median([null, null]), null);
  });
  it('takes the middle of an odd count, the mean of the middle two of an even count, one value as itself', () => {
    assert.equal(median([5]), 5);
    assert.equal(median([9, 1, 5]), 5);
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });
  it('counts a zero', () => {
    assert.equal(median([0, 0, 10]), 0);
  });
  it('does not mutate its input', () => {
    const v = [3, 1, 2];
    median(v);
    assert.deepEqual(v, [3, 1, 2]);
  });
});

describe('readyAt', () => {
  it('uses the first ready_for_review event when there are several', () => {
    const events = [{ event: 'ready_for_review', created_at: 'A' }, { event: 'convert_to_draft', created_at: 'B' }, { event: 'ready_for_review', created_at: 'C' }];
    assert.equal(readyAt({ events, createdAt: 'Z', draftAtCreation: true }), 'A');
  });
  it('is null for a PR still a draft and the creation time for one opened ready', () => {
    assert.equal(readyAt({ events: [], createdAt: 'Z', draftAtCreation: true }), null);
    assert.equal(readyAt({ events: [], createdAt: 'Z', draftAtCreation: false }), 'Z');
  });
});

describe('latencyOf', () => {
  it('has no minutes and no laps without a ready time or without reviews', () => {
    assert.deepEqual(latencyOf({ ready: null, reviews: [review(R)] }), { minutes: null, laps: 0 });
    assert.deepEqual(latencyOf({ ready: R, reviews: [] }), { minutes: null, laps: 0 });
  });
  it("ignores a review from before ready and one that is not the tester's", () => {
    const out = latencyOf({ ready: R, reviews: [review('2026-10-11T09:00:00Z'), { submitted_at: '2026-10-11T10:05:00Z', body: 'LGTM' }, { submitted_at: '2026-10-11T10:06:00Z', body: null }, { submitted_at: '2026-10-11T10:07:00Z' }] });
    assert.deepEqual(out, { minutes: null, laps: 0 });
  });
  it('measures the first tester review whatever the order the API lists them in, and counts every one', () => {
    const out = latencyOf({ ready: R, reviews: [review('2026-10-11T10:30:00Z'), review('2026-10-11T10:06:00Z'), review('2026-10-11T10:50:00Z', 'Verdict: failure (agent-review on def5678)')] });
    assert.deepEqual(out, { minutes: 6, laps: 3 });
  });
  it('counts a review at the very ready instant as 0 minutes', () => {
    assert.deepEqual(latencyOf({ ready: R, reviews: [review(R)] }), { minutes: 0, laps: 1 });
  });
  it('accepts leading whitespace before the verdict line', () => {
    assert.equal(latencyOf({ ready: R, reviews: [review('2026-10-11T10:03:00Z', '\n  Verdict: success (agent-review on abc)')] }).laps, 1);
  });
  it('rounds to a tenth of a minute', () => {
    assert.equal(latencyOf({ ready: R, reviews: [review('2026-10-11T10:01:23Z')] }).minutes, 1.4);
  });
  it('compares instants, not strings, across time zone offsets', () => {
    const out = latencyOf({ ready: '2026-10-11T10:00:00Z', reviews: [review('2026-10-11T12:05:00+02:00')] });
    assert.deepEqual(out, { minutes: 5, laps: 1 });
  });
});

describe('render', () => {
  it('prints a median row of dashes for no PRs and for PRs never reviewed', () => {
    assert.match(render([]), /median\s+—\s+—\n$/);
    assert.match(render([{ pr: 1, minutes: null, laps: 0 }]), /#1\s+—\s+0\nmedian\s+—\s+—\n$/);
  });
  it('prints the median over the PRs measured', () => {
    const out = render([{ pr: 1, minutes: 4, laps: 1 }, { pr: 2, minutes: 8, laps: 3 }, { pr: 3, minutes: null, laps: 0 }]);
    assert.match(out, /median\s+6 min\s+2\n$/);
  });
  it('keeps the header and every row aligned on the same column for a four-digit PR number', () => {
    const lines = render([{ pr: 1234, minutes: 5, laps: 1 }, { pr: 1, minutes: 5, laps: 1 }]).trim().split('\n');
    assert.match(lines[0], /^PR\s+ready→review\s+laps$/);
    assert.equal(new Set(lines.map((l) => l.search(/\d+ min|ready→review|—/))).size, 1);
  });
});

describe('measure', () => {
  const api = (info, events, reviews) => (path) => (path.includes('/timeline') ? events : path.includes('/reviews') ? reviews : [info]);
  it('measures a draft opened and later marked ready', () => {
    const out = measure(7, api({ created_at: '2026-10-10T00:00:00Z', draft: false }, [{ event: 'ready_for_review', created_at: R }], [review('2026-10-11T10:08:00Z')]));
    assert.deepEqual(out, { pr: 7, minutes: 8, laps: 1 });
  });
  it('measures from creation for a PR opened ready', () => {
    const out = measure(7, api({ created_at: R, draft: false }, [], [review('2026-10-11T10:02:00Z')]));
    assert.deepEqual(out, { pr: 7, minutes: 2, laps: 1 });
  });
  it('gives a draft that was never readied no minutes', () => {
    const out = measure(7, api({ created_at: R, draft: true }, [], [review('2026-10-11T10:02:00Z')]));
    assert.deepEqual(out, { pr: 7, minutes: null, laps: 0 });
  });
  it('lets an api failure propagate rather than print a zero', () => {
    assert.throws(() => measure(7, () => { throw new Error('HTTP 404'); }), /HTTP 404/);
  });
});

describe('latency command line', () => {
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 20_000 });
  it('exits 64 with no PR numbers or a malformed one', () => {
    for (const args of [[], ['abc'], ['12abc'], ['5', '-3'], ['1.5'], ['']]) assert.equal(cli(...args).status, 64, JSON.stringify(args));
  });
});
