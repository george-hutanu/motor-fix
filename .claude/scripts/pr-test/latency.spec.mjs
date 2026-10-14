// @traces 1171-FR-009
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { latencyOf, median, readyAt, render } from './latency.mjs';

const review = (at, body = 'Verdict: failure (agent-review on abc1234, lap 1)\n\n5 blocking') => ({ submitted_at: at, body });

describe('readyAt', () => {
  it('is the first ready_for_review event, else the creation of a PR opened ready', () => {
    const events = [{ event: 'labeled', created_at: '2026-10-11T09:00:00Z' }, { event: 'ready_for_review', created_at: '2026-10-11T10:00:00Z' }, { event: 'ready_for_review', created_at: '2026-10-11T12:00:00Z' }];
    assert.equal(readyAt({ events, createdAt: '2026-10-11T08:00:00Z', draftAtCreation: true }), '2026-10-11T10:00:00Z');
    assert.equal(readyAt({ events: [], createdAt: '2026-10-11T08:00:00Z', draftAtCreation: false }), '2026-10-11T08:00:00Z');
    assert.equal(readyAt({ events: [], createdAt: '2026-10-11T08:00:00Z', draftAtCreation: true }), null);
  });
});

describe('latencyOf', () => {
  it('measures ready to the tester\'s first review in minutes, and counts the tester\'s reviews as laps', () => {
    const reviews = [
      review('2026-10-11T09:59:00Z'),
      { submitted_at: '2026-10-11T10:10:00Z', body: 'looks fine' },
      review('2026-10-11T10:25:30Z'),
      review('2026-10-11T11:40:00Z', 'Verdict: success (agent-review on abc1234, lap 2)'),
    ];
    assert.deepEqual(latencyOf({ ready: '2026-10-11T10:00:00Z', reviews }), { minutes: 25.5, laps: 2 });
  });

  it('gives null minutes and no laps to a PR never ready or never reviewed', () => {
    assert.deepEqual(latencyOf({ ready: null, reviews: [review('2026-10-11T10:00:00Z')] }), { minutes: null, laps: 0 });
    assert.deepEqual(latencyOf({ ready: '2026-10-11T10:00:00Z', reviews: [] }), { minutes: null, laps: 0 });
  });
});

describe('median', () => {
  it('is the middle value, the mean of the two middle ones for an even count, and null for none, ignoring nulls', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([null, 5]), 5);
    assert.equal(median([]), null);
  });
});

describe('render', () => {
  it('prints one row per PR and the medians', () => {
    const out = render([{ pr: 360, minutes: 21, laps: 3 }, { pr: 361, minutes: 19.5, laps: 2 }, { pr: 9, minutes: null, laps: 0 }]);
    assert.match(out, /^PR\s+ready→review\s+laps$/m);
    assert.match(out, /^#360\s+21 min\s+3$/m);
    assert.match(out, /^#9\s+—\s+0$/m);
    assert.match(out, /^median\s+20\.3 min\s+2\.5$/m);
  });
});
