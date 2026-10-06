import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { parseQaRun, qaRunLine } from './qa-run.mjs';

const SHA = 'b'.repeat(40);
const URL = 'https://github.com/o/r/actions/runs/123';

describe('the QA run line of a hand-off note', () => {
  it('names the run, the head it tests, the lap and the run page', () => {
    assert.equal(qaRunLine({ id: 123, sha: SHA, lap: 2, url: URL }), `- QA run: 123 · head ${SHA} · lap 2 · ${URL}`);
  });

  it('reads back the run and the head from a note', () => {
    const note = `# Hand-off — specs/9-x\n- PR: #9 · head ${SHA}\n${qaRunLine({ id: 123, sha: SHA, lap: 1, url: URL })}\n- Open decisions: none\n`;
    assert.deepEqual(parseQaRun(note), { id: '123', head: SHA, lap: 1 });
  });

  it('takes the last line when a fix lap added another', () => {
    const other = 'c'.repeat(40);
    const note = `${qaRunLine({ id: 1, sha: SHA, lap: 1, url: URL })}\n${qaRunLine({ id: 2, sha: other, lap: 2, url: URL })}\n`;
    assert.deepEqual(parseQaRun(note), { id: '2', head: other, lap: 2 });
  });

  it('reads nothing from a note without the line, or with a short head', () => {
    assert.equal(parseQaRun('# Hand-off\n- PR: #9\n'), null);
    assert.equal(parseQaRun(`- QA run: 5 · head ${SHA.slice(0, 7)} · lap 1 · ${URL}`), null);
    assert.equal(parseQaRun(''), null);
    assert.equal(parseQaRun(undefined), null);
  });
});
