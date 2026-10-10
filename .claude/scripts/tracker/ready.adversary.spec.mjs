import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decideReady, readyLogged } from './ready.mjs';

const SCRIPT = fileURLToPath(new URL('./ready.mjs', import.meta.url));
const item = (id, over = {}) => ({ id, status: 'To do', priority: 'Medium', blockers: [], hold: null, ticked: false, ...over });
const ids = (list) => list.map((entry) => entry.id ?? entry);
const cli = (args, input) => spawnSync('node', [SCRIPT, ...args], { input, encoding: 'utf8' });

describe('deciding readiness from unusual items', () => {
  it('returns empty lists for no items', () => {
    assert.deepEqual(decideReady([]), { tick: [], untick: [], ready: [], held: [] });
  });

  it('treats an item with no blockers field as ready', () => {
    const { ready } = decideReady([{ id: 'ST-1', status: 'To do' }]);
    assert.deepEqual(ids(ready), ['ST-1']);
  });

  it('treats a missing ticked field as unticked and ticks a ready item', () => {
    const { tick } = decideReady([{ id: 'ST-1', status: 'To do', blockers: [] }]);
    assert.deepEqual(tick, ['ST-1']);
  });

  it('treats null blockers as no blockers', () => {
    const { ready } = decideReady([item('ST-1', { blockers: null })]);
    assert.deepEqual(ids(ready), ['ST-1']);
  });

  it('treats an empty-string hold as no hold', () => {
    const { ready, held } = decideReady([item('ST-1', { hold: '' })]);
    assert.deepEqual(ids(ready), ['ST-1']);
    assert.deepEqual(held, []);
  });

  it('holds an item with an outside hold even when every blocker is done', () => {
    const { ready, held } = decideReady([item('ST-1', { hold: 'waits on the lawyer', blockers: [{ id: 'ST-0', status: 'Done' }] })]);
    assert.deepEqual(ready, []);
    assert.deepEqual(held, [{ id: 'ST-1', reason: 'waits on the lawyer' }]);
  });

  it('keeps the outside hold as the reason when a blocker is also open', () => {
    const { held } = decideReady([item('ST-1', { hold: 'owner call', blockers: [{ id: 'ST-0', status: 'Planning' }] })]);
    assert.equal(held.length, 1);
    assert.equal(held[0].reason, 'owner call');
  });

  it('does not treat unusual blocker statuses as finished', () => {
    for (const status of ['done', 'merged', 'DONE', 'Done ', 'To do', 'Blocked', '', null, undefined, 'Cancelled', 'Archived']) {
      const { ready, held } = decideReady([item('ST-1', { blockers: [{ id: 'ST-0', status }] })]);
      assert.deepEqual(ready, [], `blocker status ${JSON.stringify(status)}`);
      assert.deepEqual(ids(held), ['ST-1'], `blocker status ${JSON.stringify(status)}`);
    }
  });

  it('accepts both Done and Merged blockers together', () => {
    const { ready } = decideReady([item('ST-1', { blockers: [{ id: 'ST-0', status: 'Done' }, { id: 'EP-1', status: 'Merged' }] })]);
    assert.deepEqual(ids(ready), ['ST-1']);
  });

  it('lists every open blocker in the reason', () => {
    const { held } = decideReady([item('ST-1', { blockers: [{ id: 'ST-2', status: 'Planning' }, { id: 'ST-3', status: 'Done' }, { id: 'ST-4', status: 'QA' }] })]);
    assert.match(held[0].reason, /ST-2/);
    assert.match(held[0].reason, /ST-4/);
    assert.doesNotMatch(held[0].reason, /ST-3/);
  });

  it('unticks a ticked item in any non-To do status', () => {
    for (const status of ['Blocked', 'In review', 'QA', 'Planning', 'Implementing', 'Done', 'In progress']) {
      const { untick, tick } = decideReady([item('ST-1', { status, ticked: true })]);
      assert.deepEqual(untick, ['ST-1'], status);
      assert.deepEqual(tick, [], status);
    }
  });

});

describe('ordering the ready list', () => {
  it('orders by the number in the ID, not as text', () => {
    const { ready } = decideReady([item('ST-100'), item('ST-9'), item('ST-20')]);
    assert.deepEqual(ids(ready), ['ST-9', 'ST-20', 'ST-100']);
  });

  it('orders by ID within a priority regardless of input order', () => {
    const a = decideReady([item('ST-3', { priority: 'High' }), item('ST-1', { priority: 'High' }), item('ST-2', { priority: 'High' })]);
    const b = decideReady([item('ST-2', { priority: 'High' }), item('ST-1', { priority: 'High' }), item('ST-3', { priority: 'High' })]);
    assert.deepEqual(ids(a.ready), ['ST-1', 'ST-2', 'ST-3']);
    assert.deepEqual(a.ready, b.ready);
  });

  it('puts IDs without digits after numbered IDs of the same priority without throwing', () => {
    const { ready } = decideReady([item('EP-x'), item('ST-5'), item('none')]);
    assert.equal(ids(ready)[0], 'ST-5');
    assert.deepEqual(ids(ready).slice(1).sort(), ['EP-x', 'none']);
  });

  it('orders IDs without digits deterministically whatever the input order', () => {
    const a = decideReady([item('alpha'), item('beta')]);
    const b = decideReady([item('beta'), item('alpha')]);
    assert.deepEqual(a.ready, b.ready);
  });

  it('orders numeric IDs by value', () => {
    const { ready } = decideReady([item(7), item(3)]);
    assert.deepEqual(ids(ready), [3, 7]);
  });

  it('refuses an item with no ID instead of ticking page null', () => {
    assert.throws(() => decideReady([{ status: 'To do' }, item('ST-1')]), /needs an id/);
  });

  it('is deterministic when repeated and does not mutate its input', () => {
    const items = [item('ST-2', { priority: 'Low' }), item('ST-1', { priority: 'High' })];
    const copy = structuredClone(items);
    const first = decideReady(items);
    assert.deepEqual(items, copy);
    assert.deepEqual(decideReady(items), first);
  });

  it('keeps an item at most once in ready when its ID is duplicated across the input', () => {
    const { ready } = decideReady([item('ST-1'), item('ST-1')]);
    assert.deepEqual(ids(ready), ['ST-1']);
  });

  it('does not tick the same ID twice when it is duplicated', () => {
    const { tick } = decideReady([item('ST-1'), item('ST-1')]);
    assert.deepEqual(tick, ['ST-1']);
  });

  it('reports not-ready To do items with a reason and never lists them as ready', () => {
    const { ready, held } = decideReady([
      item('ST-1', { blockers: [{ id: 'ST-2', status: 'Planning' }] }),
      item('ST-2', { status: 'Planning' }),
    ]);
    assert.deepEqual(ready, []);
    assert.deepEqual(ids(held), ['ST-1']);
  });
});

describe('reading the sync log', () => {
  const finish = '- 2026-10-04 · finish · ST-1 story · QA → Done';
  const ready = '- 2026-10-04 · ready · Foundations · +ST-2 −none';

  it('fails on an empty log and names the finish line', () => {
    const r = readyLogged('');
    assert.equal(r.ok, false);
    assert.match(r.reason, /finish/);
  });

  it('fails on a log with only whitespace', () => {
    assert.equal(readyLogged('\n\n  \n').ok, false);
  });

  it('reads CRLF line endings the same as LF', () => {
    assert.equal(readyLogged([finish, ready].join('\r\n')).ok, true);
    assert.equal(readyLogged([ready, finish].join('\r\n')).ok, false);
  });

  it('reads CRLF around a PENDING ready line', () => {
    assert.equal(readyLogged([finish, '[TRACKER-SYNC PENDING: ready Foundations — down]'].join('\r\n')).ok, true);
  });

  it('does not count a PENDING comment as a ready line', () => {
    const r = readyLogged([finish, '[TRACKER-SYNC PENDING: comment ST-1 — usage limit]'].join('\n'));
    assert.equal(r.ok, false);
  });

  it('does not count PENDING lines for other events as a ready line', () => {
    for (const event of ['finish ST-1', 'start ST-1', 'debt feature line 3', 'blocked ST-1', 'comment ST-1']) {
      assert.equal(readyLogged([finish, `[TRACKER-SYNC PENDING: ${event} — error]`].join('\n')).ok, false, event);
    }
  });

  it('does not count the word ready inside another event line', () => {
    const lines = [
      finish,
      '- 2026-10-04 · start · ST-2 story · To do → Planning (already ready to go)',
      '- 2026-10-04 · comment · ST-1 · everything is ready',
    ];
    assert.equal(readyLogged(lines.join('\n')).ok, false);
  });

  it('does not count a ready word in prose that is not a log line', () => {
    assert.equal(readyLogged([finish, 'The board is ready.', 'ready'].join('\n')).ok, false);
  });

  it('does not count words that merely contain ready, such as already or readyish', () => {
    assert.equal(readyLogged([finish, '- 2026-10-04 · already · Foundations', '- 2026-10-04 · readyish · Foundations'].join('\n')).ok, false);
  });

  it('requires the ready line after the last of several finishes', () => {
    assert.equal(readyLogged([finish, ready, finish].join('\n')).ok, false);
    assert.equal(readyLogged([finish, ready, finish, ready].join('\n')).ok, true);
  });

  it('is satisfied by one ready line after several consecutive finishes', () => {
    assert.equal(readyLogged([finish, finish, finish, ready].join('\n')).ok, true);
  });

  it('is decided by order when every line shares the same date', () => {
    assert.equal(readyLogged(['- 2026-10-04 · ready · A', '- 2026-10-04 · finish · B'].join('\n')).ok, false);
  });

  it('passes with no trailing newline and with many trailing newlines', () => {
    assert.equal(readyLogged(`${finish}\n${ready}`).ok, true);
    assert.equal(readyLogged(`${finish}\n${ready}\n\n\n`).ok, true);
  });

  it('is not fooled by a finish line indented or quoted inside a note', () => {
    const r = readyLogged([ready, 'Note: run the finish step when done'].join('\n'));
    assert.equal(r.ok, false);
  });

  it('returns a reason string on every failure', () => {
    const r = readyLogged(finish);
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
    assert.match(r.reason, /tracker\/ready|speckit-tracker-sync ready/);
  });

});

describe('the command line', () => {
  const dirs = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'tracker-ready-'));
    dirs.push(d);
    return d;
  };
  const cleanup = () => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  };

  it('decide prints the decision as JSON for valid input', () => {
    const r = cli(['decide'], JSON.stringify([item('ST-1')]));
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), decideReady([item('ST-1')]));
  });

  it('decide on an empty array prints empty lists', () => {
    const r = cli(['decide'], '[]');
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), { tick: [], untick: [], ready: [], held: [] });
  });

  it('decide exits non-zero on malformed JSON and prints no decision', () => {
    const r = cli(['decide'], '{not json');
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });

  it('decide exits non-zero on empty stdin', () => {
    const r = cli(['decide'], '');
    assert.notEqual(r.status, 0);
  });

  it('decide exits non-zero when the JSON is not an array', () => {
    for (const body of ['{}', 'null', '"x"', '42']) {
      const r = cli(['decide'], body);
      assert.notEqual(r.status, 0, body);
      assert.equal(r.stdout.trim(), '', body);
    }
  });

  it('decide prints no raw stack trace for malformed input', () => {
    const r = cli(['decide'], '{not json');
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });

  it('check exits 0 when the log has a ready line after the finish', () => {
    const file = join(tmp(), 'tracker-sync.md');
    writeFileSync(file, '- 2026-10-04 · finish · ST-1\n- 2026-10-04 · ready · Foundations\n');
    try {
      assert.equal(cli(['check', file]).status, 0);
    } finally {
      cleanup();
    }
  });

  it('check exits 1 and says what to run when the ready line is missing', () => {
    const file = join(tmp(), 'tracker-sync.md');
    writeFileSync(file, '- 2026-10-04 · finish · ST-1\n');
    try {
      const r = cli(['check', file]);
      assert.equal(r.status, 1);
      assert.match(r.stdout + r.stderr, /tracker\/ready|speckit-tracker-sync ready/);
    } finally {
      cleanup();
    }
  });

  it('check exits 1 on an empty file', () => {
    const file = join(tmp(), 'tracker-sync.md');
    writeFileSync(file, '');
    try {
      assert.equal(cli(['check', file]).status, 1);
    } finally {
      cleanup();
    }
  });

  it('check exits non-zero with a message when the file is missing', () => {
    const r = cli(['check', join(tmp(), 'absent.md')]);
    try {
      assert.notEqual(r.status, 0);
      assert.notEqual(r.stdout + r.stderr, '');
      assert.doesNotMatch(r.stderr, /\n\s+at /);
    } finally {
      cleanup();
    }
  });

  it('check exits non-zero when no file is given', () => {
    const r = cli(['check']);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });

  it('check exits non-zero when the path is a directory', () => {
    const dir = tmp();
    try {
      assert.notEqual(cli(['check', dir]).status, 0);
    } finally {
      cleanup();
    }
  });

  it('check reads a CRLF file', () => {
    const file = join(tmp(), 'tracker-sync.md');
    writeFileSync(file, '- 2026-10-04 · finish · ST-1\r\n- 2026-10-04 · ready · Foundations\r\n');
    try {
      assert.equal(cli(['check', file]).status, 0);
    } finally {
      cleanup();
    }
  });

  it('exits non-zero on an unknown command', () => {
    const r = cli(['frobnicate']);
    assert.notEqual(r.status, 0);
    assert.notEqual(r.stdout + r.stderr, '');
  });

  it('exits non-zero with no command', () => {
    const r = cli([]);
    assert.notEqual(r.status, 0);
  });
});

describe('the command line from wherever it is called', () => {
  it('still runs, and still fails a log with no ready line, through a symlinked path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracker-ready-link-'));
    try {
      const link = join(dir, 'ready.mjs');
      symlinkSync(SCRIPT, link);
      const log = join(dir, 'tracker-sync.md');
      writeFileSync(log, '- 2026-10-04 · finish · ST-1 story · QA → Done\n');
      const r = spawnSync('node', [link, 'check', log], { encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /tracker\/ready|speckit-tracker-sync ready/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints a decision larger than a pipe buffer in full', () => {
    const items = Array.from({ length: 5000 }, (_, i) => item(`ST-${i + 1}`, { priority: 'Low' }));
    const r = cli(['decide'], JSON.stringify(items));
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).ready.length, 5000);
  });
});
