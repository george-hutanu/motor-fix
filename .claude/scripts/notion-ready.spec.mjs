import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { decideReady, readyLogged } from './notion-ready.mjs';

const item = (id, over = {}) => ({ id, status: 'To do', priority: 'Medium', blockers: [], hold: null, ticked: false, ...over });
const ids = (list) => list.map((entry) => entry.id ?? entry);

describe('which items are ready', () => {
  it('is ready when To do, every blocker finished and nothing holds it', () => {
    const result = decideReady([item('ST-20', { blockers: [{ id: 'ST-79', status: 'Done' }, { id: 'ST-17', status: 'Merged' }] })]);
    assert.deepEqual(ids(result.ready), ['ST-20']);
    assert.deepEqual(result.tick, ['ST-20']);
  });

  it('is not ready while one blocker is still open, and says which', () => {
    const result = decideReady([item('ST-82', { blockers: [{ id: 'ST-79', status: 'Merged' }, { id: 'ST-157', status: 'Implementing' }] })]);
    assert.deepEqual(result.ready, []);
    assert.deepEqual(result.held, [{ id: 'ST-82', reason: 'waits on ST-157 (Implementing)' }]);
  });

  it('is not ready while an outside party holds it', () => {
    const result = decideReady([item('ST-5', { hold: 'the lawyer' })]);
    assert.deepEqual(result.ready, []);
    assert.deepEqual(result.held, [{ id: 'ST-5', reason: 'the lawyer' }]);
  });

  for (const status of ['Planning', 'Implementing', 'In review', 'QA', 'Blocked', 'Done', 'In progress']) {
    it(`is never ready at ${status}`, () => {
      const result = decideReady([item('ST-1', { status })]);
      assert.deepEqual(result.ready, []);
      assert.deepEqual(result.held, []);
    });
  }
});

describe('what to write', () => {
  it('unticks an item that started or finished', () => {
    const result = decideReady([item('ST-20', { status: 'Planning', ticked: true }), item('ST-19', { status: 'Done', ticked: true })]);
    assert.deepEqual(result.untick, ['ST-20', 'ST-19']);
    assert.deepEqual(result.tick, []);
  });

  it('unticks an item that is blocked again', () => {
    const result = decideReady([item('ST-196', { ticked: true, blockers: [{ id: 'ST-194', status: 'In review' }] })]);
    assert.deepEqual(result.untick, ['ST-196']);
  });

  it('writes nothing for an item whose tick is already right', () => {
    const result = decideReady([item('ST-20', { ticked: true }), item('ST-82', { blockers: [{ id: 'ST-157', status: 'QA' }] })]);
    assert.deepEqual(result.tick, []);
    assert.deepEqual(result.untick, []);
    assert.deepEqual(ids(result.ready), ['ST-20']);
  });
});

describe('the ready list', () => {
  it('runs Highest, High, Medium, Low, then no priority, and by number within one', () => {
    const result = decideReady([
      item('ST-479', { priority: 'Low' }),
      item('ST-450'),
      item('ST-1000', { priority: null }),
      item('ST-441'),
      item('ST-194', { priority: 'Highest' }),
      item('ST-432', { priority: 'High' }),
      item('ST-20', { priority: 'High' }),
    ]);
    assert.deepEqual(ids(result.ready), ['ST-194', 'ST-20', 'ST-432', 'ST-441', 'ST-450', 'ST-479', 'ST-1000']);
  });
});

const log = (...lines) => ['# Notion sync — 490-notion-ready', '', ...lines].join('\n');

describe('the archive check', () => {
  it('passes when a ready line follows the last finish', () => {
    const result = readyLogged(log('- 2026-10-04 · start · ST-490 story · To do → Planning', '- 2026-10-04 · finish · ST-490 story · QA → Done', '- 2026-10-04 · ready · Foundations · +ST-82 −none'));
    assert.equal(result.ok, true);
  });

  it('passes when the refresh after the finish was logged PENDING', () => {
    const result = readyLogged(log('- 2026-10-04 · finish · ST-490 story · QA → Done', '[NOTION-SYNC PENDING: ready Foundations — usage limit]'));
    assert.equal(result.ok, true);
  });

  it('fails with no ready line after the finish, and names what to run', () => {
    const result = readyLogged(log('- 2026-10-04 · finish · ST-490 story · QA → Done', '- 2026-10-04 · finish · Foundations timeline row · QA → Merged'));
    assert.equal(result.ok, false);
    assert.match(result.reason, /notion-ready/);
  });

  it('fails when the only ready line came before the last finish', () => {
    const result = readyLogged(log('- 2026-10-04 · start · ST-490 story · To do → Planning', '- 2026-10-04 · ready · Foundations · −ST-490', '- 2026-10-04 · finish · ST-490 story · QA → Done'));
    assert.equal(result.ok, false);
  });

  it('fails when nothing has finished yet', () => {
    const result = readyLogged(log('- 2026-10-04 · start · ST-490 story · To do → Planning', '- 2026-10-04 · ready · Foundations · −ST-490'));
    assert.equal(result.ok, false);
    assert.match(result.reason, /finish/);
  });

  it('reads lines written without the separator after the date', () => {
    const result = readyLogged(log('- 2026-10-04 finish · ST-19 story Status: In review → Done', '- 2026-10-04 ready · Foundations · +ST-20'));
    assert.equal(result.ok, true);
  });
});
