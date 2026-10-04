import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { decide } from './pr-lifecycle-gate.mjs';

const STAGES = ['planning', 'in development', 'in review', 'QA'];
const pending = [{ state: 'PENDING' }];
const pr = (over = {}) => ({
  isDraft: false,
  mergeable: 'MERGEABLE',
  number: 6,
  title: 'feat(ui-cockpit): a change',
  state: 'OPEN',
  statusCheckRollup: pending,
  labels: [{ name: 'feature' }],
  ...over,
});
const labelsOf = (...names) => names.map((name) => ({ name }));
const task = (p) => ({ ahead: 2, branch: 'chore-thing', pr: p, prLinked: true, unpushed: 0 });
const subsets = (items) => items.reduce((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]]);

const applyEdits = (message, number, names) => {
  const next = new Set(names);
  const pattern = new RegExp(`gh pr edit ${number}((?: --(?:add|remove)-label "[^"]+")+)`, 'g');
  for (const [, args] of message.matchAll(pattern))
    for (const [, op, name] of args.matchAll(/--(add|remove)-label "([^"]+)"/g)) op === 'add' ? next.add(name) : next.delete(name);
  return next;
};
const stagesOf = (set) => STAGES.filter((s) => set.has(s));

describe('stage labels in every combination', () => {
  for (const isDraft of [true, false]) {
    it(`${isDraft ? 'draft' : 'ready'} PR: the named gh command leaves exactly one fitting stage label, and the gate then passes`, () => {
      const fits = isDraft ? ['planning', 'in development'] : ['in review', 'QA'];
      for (const have of subsets(STAGES)) {
        const names = [...have, 'feature', 'ui'];
        const why = decide(task(pr({ isDraft, labels: labelsOf(...names) })));
        if (have.length === 1 && fits.includes(have[0])) {
          assert.equal(why, null, have.join(','));
          continue;
        }
        assert.equal(typeof why, 'string', `refuses ${have.join(',') || 'none'}`);
        const after = applyEdits(why, 6, names);
        const stages = stagesOf(after);
        assert.equal(stages.length, 1, `${have.join(',') || 'none'} -> ${stages.join(',')}`);
        assert.ok(fits.includes(stages[0]), `${stages[0]} fits`);
        assert.ok(after.has('ui') && after.has('feature'), 'bystanders kept');
        assert.equal(decide(task(pr({ isDraft, labels: labelsOf(...after) }))), null, 'second pass is clean');
      }
    });
  }
});

describe('labels that only look like stage labels', () => {
  const lookalikes = ['QA-later', 'planning-doc', 'in review-ish', 'pre-in development', 'blocked', 'in  review'];

  it('does not count them as stage labels, so a ready PR with none still gets the default', () => {
    const why = decide(task(pr({ labels: labelsOf(...lookalikes, 'feature') })));
    assert.match(why, /gh pr edit 6 --add-label "in review"/);
    assert.doesNotMatch(why, /--remove-label/);
  });

  it('does not remove them when a real stage label is fixed', () => {
    const why = decide(task(pr({ labels: labelsOf(...lookalikes, 'in review', 'QA', 'feature') })));
    for (const l of lookalikes) assert.equal(why.includes(`"${l}"`), false, l);
  });
});

describe('labels the gate cannot see', () => {
  it('treats a missing labels field as unseen: no label refusal, and no throw', () => {
    const noLabels = pr();
    delete noLabels.labels;
    assert.doesNotMatch(decide(task(noLabels)) ?? '', /label/);
  });

  it('treats a null labels field as unseen: no label refusal, and no throw', () => {
    assert.doesNotMatch(decide(task(pr({ labels: null }))) ?? '', /label/);
  });
});

describe('order of refusals', () => {
  it('gives a stage refusal before a merge instruction when the ready PR is green and mislabelled', () => {
    const green = [{ conclusion: 'SUCCESS' }, { __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS' }];
    const why = decide(task(pr({ statusCheckRollup: green, labels: labelsOf('in review', 'QA', 'feature') })));
    assert.match(why, /more than one stage label/);
  });
});
