import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decide, main } from './status.mjs';
import { readState } from '../run-state.mjs';

const go = (event, current, prior = null) => decide({ event, current, prior });

describe('the ladder: Planning → Implementing → QA → Done', () => {
  it('moves the story forward on each event', () => {
    assert.deepEqual(go('start', 'To do'), {
      write: true,
      story: 'Planning',
      prior: null,
      note: 'To do → Planning',
      stage: 'planning',
      labels: '--add-label "planning" --remove-label "in development" --remove-label "QA" --remove-label "blocked"',
    });
    const impl = go('implement', 'Planning');
    assert.equal(impl.story, 'Implementing');
    const qa = go('qa', 'Implementing');
    assert.equal(qa.story, 'QA');
    const done = go('finish', 'QA');
    assert.equal(done.story, 'Done');
  });

  it('never moves backwards, and an equal value is not written', () => {
    assert.equal(go('start', 'QA').write, false);
    assert.equal(go('start', 'Implementing').write, false);
    assert.equal(go('implement', 'QA').write, false);
    assert.equal(go('review', 'QA').write, false);
    assert.equal(go('qa', 'QA').write, false);
    assert.match(go('qa', 'QA').note, /unchanged/);
  });

  it('never moves a Done story', () => {
    for (const event of ['start', 'implement', 'review', 'qa', 'blocked', 'unblock']) assert.equal(go(event, 'Done').write, false, event);
  });
});

describe('In review is folded into QA (owner, 2026-10-04)', () => {
  it('has no In review stage: marking the PR ready goes straight to QA', () => {
    const ready = go('review', 'Implementing');
    assert.equal(ready.write, true);
    assert.equal(ready.story, 'QA');
    assert.equal(ready.stage, 'QA');
    assert.equal(ready.note, 'Implementing → QA');
  });

  it('keeps review as an alias of qa for every status', () => {
    for (const current of ['To do', 'Planning', 'Implementing', 'QA', 'Done', 'Blocked', 'In progress', 'In review']) {
      assert.deepEqual(go('review', current, 'QA'), go('qa', current, 'QA'), current);
    }
  });

  it('never writes In review, and no label it sets is in review', () => {
    for (const event of ['start', 'implement', 'review', 'qa', 'finish', 'blocked', 'unblock']) {
      for (const current of ['To do', 'Planning', 'Implementing', 'In review', 'QA', 'Blocked', 'In progress']) {
        const r = go(event, current, 'In review');
        assert.notEqual(r.story, 'In review', `${event} on ${current}`);
        assert.doesNotMatch(r.labels, /in review/, `${event} on ${current}`);
      }
    }
  });

  it('reads a legacy In review status as QA and moves it there', () => {
    const qa = go('qa', 'In review');
    assert.equal(qa.write, true);
    assert.equal(qa.story, 'QA');
    assert.equal(qa.note, 'In review → QA');
    assert.equal(go('start', 'In review').write, false);
    assert.equal(go('finish', 'In review').story, 'Done');
    assert.equal(go('unblock', 'Blocked', 'In review').story, 'QA');
  });
});

describe('Blocked', () => {
  it('records the status it leaves', () => {
    const r = go('blocked', 'QA');
    assert.equal(r.write, true);
    assert.equal(r.story, 'Blocked');
    assert.equal(r.prior, 'QA');
  });

  it('keeps the first record when blocked twice', () => {
    const r = go('blocked', 'Blocked', 'Implementing');
    assert.equal(r.write, false);
    assert.equal(r.prior, 'Implementing');
  });

  it('is left only by unblock, which returns to the recorded status', () => {
    assert.equal(go('qa', 'Blocked', 'Implementing').write, false);
    assert.equal(go('finish', 'Blocked', 'QA').write, false);
    const r = go('unblock', 'Blocked', 'QA');
    assert.equal(r.write, true);
    assert.equal(r.story, 'QA');
    assert.equal(r.prior, null);
  });

  it('returns to Implementing when nothing was recorded, and does nothing when not blocked', () => {
    assert.equal(go('unblock', 'Blocked', null).story, 'Implementing');
    assert.equal(go('unblock', 'QA', null).write, false);
  });

  it('reads a legacy In progress record as Implementing', () => {
    assert.equal(go('unblock', 'Blocked', 'In progress').story, 'Implementing');
    assert.equal(go('implement', 'In progress').write, true);
    assert.equal(go('review', 'In progress').story, 'QA');
  });

  it('refuses an event it does not know', () => {
    assert.throws(() => go('ship', 'QA'), /unknown event/);
  });
});

const STAGE_LABELS = ['planning', 'in development', 'QA'];

/** The PR's labels after `gh pr edit <n> <labels>`, sorted. */
const apply = (labels, before) => {
  const named = (flag) => [...labels.matchAll(new RegExp(`--${flag}-label "([^"]+)"`, 'g'))].map((m) => m[1]);
  const removed = named('remove');
  return [...new Set([...before, ...named('add')])].filter((l) => !removed.includes(l)).sort();
};

describe('the stage label: exactly one on an open PR, whatever it carried before', () => {
  const ladder = [
    ['start', 'To do', 'planning'],
    ['implement', 'Planning', 'in development'],
    ['review', 'Implementing', 'QA'],
    ['qa', 'Implementing', 'QA'],
  ];

  it('names the stage label of each status on the ladder', () => {
    for (const [event, current, stage] of ladder) assert.equal(go(event, current).stage, stage, event);
  });

  it('adds the stage label and removes every other one and blocked', () => {
    assert.equal(
      go('qa', 'Implementing').labels,
      '--add-label "QA" --remove-label "planning" --remove-label "in development" --remove-label "blocked"',
    );
  });

  it('leaves one stage label from any starting labels, and the other labels alone', () => {
    const everything = [...STAGE_LABELS, 'blocked', 'feature', 'scope: harness'];
    for (const [event, current, stage] of ladder) {
      assert.deepEqual(apply(go(event, current).labels, everything), [stage, 'feature', 'scope: harness'].sort(), event);
    }
  });

  it('still sets the label when the story does not move: a late or repeated event converges', () => {
    const again = go('qa', 'QA');
    assert.equal(again.write, false);
    assert.deepEqual(apply(again.labels, ['in development', 'QA', 'tooling']), ['QA', 'tooling']);
    const behind = go('start', 'QA');
    assert.equal(behind.write, false);
    assert.deepEqual(apply(behind.labels, ['planning', 'QA']), ['QA']);
  });

  it('keeps the stage it left while Blocked, with blocked beside it', () => {
    const blocked = go('blocked', 'QA');
    assert.equal(blocked.stage, 'QA');
    assert.deepEqual(apply(blocked.labels, ['in development', 'QA']), ['QA', 'blocked']);
    assert.deepEqual(apply(go('qa', 'Blocked', 'Implementing').labels, ['QA']), ['blocked', 'in development']);
    const unblocked = go('unblock', 'Blocked', 'QA');
    assert.equal(unblocked.stage, 'QA');
    assert.deepEqual(apply(unblocked.labels, ['QA', 'blocked']), ['QA']);
  });

  it('only adds blocked when the stage it left is unknown', () => {
    for (const r of [go('blocked', 'Blocked', null), go('blocked', 'To do')]) {
      assert.equal(r.stage, null);
      assert.equal(r.labels, '--add-label "blocked"');
    }
  });

  it('removes every stage label and blocked from a merged PR', () => {
    for (const r of [go('finish', 'QA'), go('finish', 'Done'), go('review', 'Done')]) {
      assert.equal(r.stage, null);
      assert.deepEqual(apply(r.labels, [...STAGE_LABELS, 'blocked', 'feature']), ['feature']);
    }
  });
});

describe('the command line keeps the prior status in run-state', () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('stores it on blocked and gives it back on unblock', () => {
    const repo = mkdtempSync(join(tmpdir(), 'tracker-status-'));
    dirs.push(repo);
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((line) => out.push(line));
    assert.equal(main(['blocked', '--current', 'QA'], repo), 0);
    assert.equal(readState(repo).prior_status, 'QA');
    assert.equal(main(['unblock', '--current', 'Blocked'], repo), 0);
    assert.equal(JSON.parse(out.at(-1)).story, 'QA');
    assert.match(JSON.parse(out.at(-1)).labels, /--add-label "QA" .*--remove-label "blocked"/);
    assert.equal(readState(repo).prior_status, null);
  });

  it('reads the event whichever side of --current it is on', () => {
    const repo = mkdtempSync(join(tmpdir(), 'tracker-status-'));
    dirs.push(repo);
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((line) => out.push(line));
    assert.equal(main(['--current', 'Implementing', 'qa'], repo), 0);
    assert.equal(JSON.parse(out.at(-1)).story, 'QA');
  });
});
