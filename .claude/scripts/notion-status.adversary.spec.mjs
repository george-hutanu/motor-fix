import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { decide } from './notion-status.mjs';

const STAGES = ['planning', 'in development', 'in review', 'QA'];
const ALL = [...STAGES, 'blocked'];
const EVENTS = ['start', 'implement', 'review', 'qa', 'finish', 'blocked', 'unblock'];
const STATUSES = ['To do', 'Planning', 'Implementing', 'In review', 'QA', 'Done', 'Blocked', 'In progress'];

const parse = (labels) => {
  const ops = [...labels.matchAll(/--(add|remove)-label "([^"]+)"/g)].map((m) => ({ op: m[1], name: m[2] }));
  const rebuilt = ops.map((o) => `--${o.op}-label "${o.name}"`).join(' ');
  assert.equal(rebuilt, labels, 'labels string is only quoted add/remove arguments');
  return ops;
};
const apply = (set, labels) => {
  const next = new Set(set);
  for (const { op, name } of parse(labels)) op === 'add' ? next.add(name) : next.delete(name);
  return next;
};
const stagesOf = (set) => STAGES.filter((s) => set.has(s));
const subsets = (items) => items.reduce((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]]);

describe('applying label arguments to any starting label set', () => {
  it('leaves at most one stage label after every single event, from every status and label set', () => {
    for (const current of STATUSES) {
      for (const event of EVENTS) {
        for (const prior of [null, 'Implementing', 'QA']) {
          const d = decide({ event, current, prior });
          if (d.story === 'Blocked' && d.stage === null) continue;
          for (const have of subsets(ALL)) {
            const after = apply(new Set([...have, 'ui', 'feature']), d.labels);
            const where = `${event} from ${current} prior ${prior} carrying ${have.join(',')}`;
            assert.deepEqual(stagesOf(after), d.stage ? [d.stage] : [], where);
            assert.equal(after.has('blocked'), d.story === 'Blocked', where);
          }
        }
      }
    }
  });

  it('never names a label outside the four stages and blocked', () => {
    for (const current of STATUSES)
      for (const event of EVENTS)
        for (const prior of [null, 'Planning', 'In review']) {
          for (const { name } of parse(decide({ event, current, prior }).labels)) assert.ok(ALL.includes(name), `${event} ${current}: ${name}`);
        }
  });

  it('never both adds and removes the same label', () => {
    for (const current of STATUSES)
      for (const event of EVENTS) {
        const names = parse(decide({ event, current, prior: 'QA' }).labels).map((o) => o.name);
        assert.equal(new Set(names).size, names.length, `${event} ${current}`);
      }
  });

  it('converges after any sequence of up to four events, even out of order, with state carried from each result', () => {
    for (const start of ['To do', 'Planning', 'Implementing', 'In review', 'QA', 'In progress']) {
      const walk = (story, prior, labels, depth, trail) => {
        if (depth === 0) return;
        for (const event of EVENTS) {
          const d = decide({ event, current: story, prior });
          const after = apply(labels, d.labels);
          const t = `${trail} > ${event}`;
          if (!(d.story === 'Blocked' && d.stage === null)) {
            assert.deepEqual(stagesOf(after), d.stage ? [d.stage] : [], t);
            assert.equal(after.has('blocked'), d.story === 'Blocked', t);
          }
          walk(d.story, d.prior, after, depth - 1, t);
        }
      };
      walk(start, null, new Set(['in review', 'QA', 'planning', 'in development', 'ui']), 4, start);
    }
  });

  it('gives the legacy In progress the labels of Implementing for every event', () => {
    for (const event of EVENTS) {
      const legacy = decide({ event, current: 'In progress', prior: 'In progress' });
      const modern = decide({ event, current: 'Implementing', prior: 'Implementing' });
      assert.equal(legacy.stage, modern.stage, event);
      assert.equal(legacy.labels, modern.labels, event);
    }
  });
});

describe('hostile input', () => {
  it('rejects inherited property names as events', () => {
    for (const event of ['toString', 'constructor', '__proto__', '']) assert.throws(() => decide({ event, current: 'QA' }), /unknown event/, event);
  });
});
