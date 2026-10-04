import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decide, main } from './notion-status.mjs';
import { readState } from './run-state.mjs';

const go = (event, current, prior = null) => decide({ event, current, prior });

describe('the ladder: Planning → Implementing → In review → QA → Done', () => {
  it('moves the story and its timeline row forward on each event', () => {
    assert.deepEqual(go('start', 'To do'), {
      write: true,
      story: 'Planning',
      timeline: 'Planning',
      prior: null,
      note: 'To do → Planning',
      stage: 'planning',
      labels: '--add-label "planning" --remove-label "in development" --remove-label "in review" --remove-label "QA" --remove-label "blocked"',
    });
    const impl = go('implement', 'Planning');
    assert.equal(impl.story, 'Implementing');
    assert.equal(impl.timeline, 'Implementing');
    assert.equal(go('review', 'Implementing').story, 'In review');
    const qa = go('qa', 'In review');
    assert.equal(qa.story, 'QA');
    assert.equal(qa.timeline, 'QA');
    const done = go('finish', 'QA');
    assert.equal(done.story, 'Done');
    assert.equal(done.timeline, 'Merged');
  });

  it('never moves backwards, and an equal value is not written', () => {
    assert.equal(go('start', 'In review').write, false);
    assert.equal(go('start', 'Implementing').write, false);
    assert.equal(go('implement', 'In review').write, false);
    assert.equal(go('review', 'QA').write, false);
    assert.equal(go('qa', 'QA').write, false);
    assert.match(go('qa', 'QA').note, /unchanged/);
  });

  it('never moves a Done story', () => {
    for (const event of ['start', 'implement', 'review', 'qa', 'blocked', 'unblock']) assert.equal(go(event, 'Done').write, false, event);
  });
});

describe('Blocked', () => {
  it('records the status it leaves', () => {
    const r = go('blocked', 'QA');
    assert.equal(r.write, true);
    assert.equal(r.story, 'Blocked');
    assert.equal(r.timeline, 'Blocked');
    assert.equal(r.prior, 'QA');
  });

  it('keeps the first record when blocked twice', () => {
    const r = go('blocked', 'Blocked', 'In review');
    assert.equal(r.write, false);
    assert.equal(r.prior, 'In review');
  });

  it('is left only by unblock, which returns to the recorded status', () => {
    assert.equal(go('qa', 'Blocked', 'In review').write, false);
    assert.equal(go('finish', 'Blocked', 'QA').write, false);
    const r = go('unblock', 'Blocked', 'QA');
    assert.equal(r.write, true);
    assert.equal(r.story, 'QA');
    assert.equal(r.timeline, 'QA');
    assert.equal(r.prior, null);
  });

  it('returns to Implementing when nothing was recorded, and does nothing when not blocked', () => {
    assert.equal(go('unblock', 'Blocked', null).story, 'Implementing');
    assert.equal(go('unblock', 'QA', null).write, false);
  });

  it('reads a legacy In progress record as Implementing', () => {
    assert.equal(go('unblock', 'Blocked', 'In progress').story, 'Implementing');
    assert.equal(go('implement', 'In progress').write, true);
    assert.equal(go('review', 'In progress').story, 'In review');
  });

  it('refuses an event it does not know', () => {
    assert.throws(() => go('ship', 'QA'), /unknown event/);
  });
});

const STAGE_LABELS = ['planning', 'in development', 'in review', 'QA'];

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
    ['review', 'Implementing', 'in review'],
    ['qa', 'In review', 'QA'],
  ];

  it('names the stage label of each status on the ladder', () => {
    for (const [event, current, stage] of ladder) assert.equal(go(event, current).stage, stage, event);
  });

  it('adds the stage label and removes every other one and blocked', () => {
    assert.equal(
      go('qa', 'In review').labels,
      '--add-label "QA" --remove-label "planning" --remove-label "in development" --remove-label "in review" --remove-label "blocked"',
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
    assert.deepEqual(apply(again.labels, ['in review', 'QA', 'tooling']), ['QA', 'tooling']);
    const behind = go('start', 'In review');
    assert.equal(behind.write, false);
    assert.deepEqual(apply(behind.labels, ['planning', 'in review']), ['in review']);
  });

  it('keeps the stage it left while Blocked, with blocked beside it', () => {
    const blocked = go('blocked', 'QA');
    assert.equal(blocked.stage, 'QA');
    assert.deepEqual(apply(blocked.labels, ['in review', 'QA']), ['QA', 'blocked']);
    assert.deepEqual(apply(go('qa', 'Blocked', 'In review').labels, ['QA']), ['blocked', 'in review']);
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
    const repo = mkdtempSync(join(tmpdir(), 'notion-status-'));
    dirs.push(repo);
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((line) => out.push(line));
    assert.equal(main(['blocked', '--current', 'QA'], repo), 0);
    assert.equal(readState(repo).notion_prior_status, 'QA');
    assert.equal(main(['unblock', '--current', 'Blocked'], repo), 0);
    assert.equal(JSON.parse(out.at(-1)).story, 'QA');
    assert.match(JSON.parse(out.at(-1)).labels, /--add-label "QA" .*--remove-label "blocked"/);
    assert.equal(readState(repo).notion_prior_status, null);
  });

  it('reads the event whichever side of --current it is on', () => {
    const repo = mkdtempSync(join(tmpdir(), 'notion-status-'));
    dirs.push(repo);
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((line) => out.push(line));
    assert.equal(main(['--current', 'In review', 'qa'], repo), 0);
    assert.equal(JSON.parse(out.at(-1)).story, 'QA');
  });
});
