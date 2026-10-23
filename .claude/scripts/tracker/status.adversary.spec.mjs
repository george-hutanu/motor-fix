import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { decide } from './status.mjs';

const STAGES = ['planning', 'in development', 'QA'];
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

  it('never names a label outside the three stages and blocked, never the retired in review', () => {
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
          assert.deepEqual(stagesOf(after), d.stage ? [d.stage] : [], t);
          assert.equal(after.has('blocked'), d.story === 'Blocked', t);
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

describe('Blocked with no nameable stage leaves blocked alone', () => {
  // @traces 485-FR-001
  it('blocked from To do removes every stage label and adds blocked, from any starting label set', () => {
    const d = decide({ event: 'blocked', current: 'To do', prior: null });
    assert.equal(d.story, 'Blocked');
    assert.equal(d.stage, null);
    for (const have of subsets(ALL)) {
      const after = apply(new Set([...have, 'ui', 'claim: chief-1']), d.labels);
      assert.deepEqual([...after].filter((l) => ALL.includes(l)), ['blocked'], have.join(','));
      assert.equal(after.has('ui') && after.has('claim: chief-1'), true);
    }
  });

  // @traces 485-FR-001
  it('every event on a story already Blocked with no recorded prior leaves blocked alone', () => {
    for (const event of EVENTS) {
      for (const prior of [null, undefined, '', 'To do', 'Done', 'nonsense']) {
        const d = decide({ event, current: 'Blocked', prior });
        if (d.story !== 'Blocked') continue;
        for (const have of subsets(ALL)) {
          const after = apply(new Set(have), d.labels);
          assert.deepEqual([...after].filter((l) => ALL.includes(l)), ['blocked'], `${event} prior ${prior} carrying ${have.join(',')}`);
        }
        assert.equal(d.stage, null, `${event} prior ${prior}`);
      }
    }
  });

  // @traces 485-FR-001
  it('names exactly the three stage removals and the blocked addition, and nothing else', () => {
    const ops = parse(decide({ event: 'blocked', current: 'To do', prior: null }).labels);
    assert.deepEqual(ops.filter((o) => o.op === 'add').map((o) => o.name), ['blocked']);
    assert.deepEqual(ops.filter((o) => o.op === 'remove').map((o) => o.name).sort(), [...STAGES].sort());
  });

  // @traces 485-FR-001
  it('applying the arguments twice gives the same set as applying them once', () => {
    const d = decide({ event: 'blocked', current: 'To do', prior: null });
    const once = apply(new Set(ALL), d.labels);
    assert.deepEqual([...apply(once, d.labels)].sort(), [...once].sort());
  });

  // @traces 485-FR-001
  it('a Blocked story whose prior is garbage still ends with at most one stage label and blocked', () => {
    const d = decide({ event: 'qa', current: 'Blocked', prior: 'Blocked' });
    const after = apply(new Set(ALL), d.labels);
    assert.deepEqual(stagesOf(after).length <= 1, true);
    assert.equal(after.has('blocked'), true);
  });
});

describe('Blocked from a status with a stage keeps that stage', () => {
  // @traces 485-FR-002
  it('blocked from each stage status adds that stage and blocked and removes the other stages', () => {
    const cases = { Planning: 'planning', Implementing: 'in development', QA: 'QA', 'In progress': 'in development', 'In review': 'QA' };
    for (const [current, stage] of Object.entries(cases)) {
      const d = decide({ event: 'blocked', current, prior: null });
      assert.equal(d.stage, stage, current);
      const after = apply(new Set(ALL), d.labels);
      assert.deepEqual([...after].filter((l) => ALL.includes(l)).sort(), [stage, 'blocked'].sort(), current);
    }
  });

  // @traces 485-FR-002
  it('a Blocked story with a recorded prior of each stage or retired alias keeps that stage beside blocked', () => {
    const cases = { Planning: 'planning', Implementing: 'in development', QA: 'QA', 'In progress': 'in development', 'In review': 'QA' };
    for (const [prior, stage] of Object.entries(cases)) {
      for (const event of ['blocked', 'qa', 'start']) {
        const d = decide({ event, current: 'Blocked', prior });
        if (d.story !== 'Blocked') continue;
        const after = apply(new Set(ALL), d.labels);
        assert.deepEqual([...after].filter((l) => ALL.includes(l)).sort(), [stage, 'blocked'].sort(), `${event} prior ${prior}`);
      }
    }
  });

  // @traces 485-FR-002
  it('blocked from Done is not written and its labels match the Done story', () => {
    const d = decide({ event: 'blocked', current: 'Done', prior: null });
    assert.equal(d.write, false);
    assert.equal(d.story, 'Done');
    assert.equal(d.stage, null);
    assert.equal(apply(new Set(ALL), d.labels).has('blocked'), false);
  });
});
