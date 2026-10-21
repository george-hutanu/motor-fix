import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { orphanedChecks, orphanLine, runIdOf } from './merge-gate.mjs';

// The 'PR title' check: attempt 1 of run 39618505833 left in_progress at 14:37Z,
// attempt 2 of the same run completed success at 14:43Z, and the run completed.
const RUN = '39618505833';
const attempt = (status, startedAt, extra = {}) => ({ name: 'PR title', status, startedAt, runId: RUN, runStatus: 'completed', ...extra });
const orphan = attempt('in_progress', '2026-10-21T14:37:49Z', { checkRunId: 119285437128 });
const retried = attempt('completed', '2026-10-21T14:43:56Z', { conclusion: 'success', checkRunId: 119288507053 });

describe('orphaned check attempts', () => {
  // @traces 1362-FR-003
  it('finds the earlier attempt left in_progress once a newer attempt of the same run completed', () => {
    assert.deepEqual(orphanedChecks([orphan, retried]), [orphan]);
    assert.deepEqual(orphanedChecks([retried, orphan]), [orphan]);
  });

  // @traces 1362-FR-003
  it('reads statuses in either case, as REST and the GraphQL rollup write them', () => {
    const upper = [{ ...orphan, status: 'IN_PROGRESS', runStatus: 'COMPLETED' }, { ...retried, status: 'COMPLETED' }];
    assert.deepEqual(orphanedChecks(upper), [upper[0]]);
    assert.deepEqual(orphanedChecks([{ ...orphan, status: 'queued' }, retried]).length, 1);
  });

  // @traces 1362-FR-004
  it('keeps a check pending with no newer completed attempt', () => {
    assert.deepEqual(orphanedChecks([orphan]), []);
    assert.deepEqual(orphanedChecks([orphan, attempt('completed', '2026-10-21T14:30:00Z')]), [], 'an older completed attempt is no newer attempt');
    assert.deepEqual(orphanedChecks([orphan, attempt('in_progress', '2026-10-21T14:43:56Z')]), [], 'a newer unfinished attempt is no completed one');
  });

  // @traces 1362-FR-004
  it('keeps it pending while the workflow run itself has not completed', () => {
    for (const runStatus of ['in_progress', 'queued', undefined, null]) assert.deepEqual(orphanedChecks([{ ...orphan, runStatus }, retried]), [], String(runStatus));
  });

  // @traces 1362-FR-004
  it('needs the same check name and the same workflow run', () => {
    assert.deepEqual(orphanedChecks([orphan, { ...retried, name: 'CI OK' }]), []);
    assert.deepEqual(orphanedChecks([orphan, { ...retried, runId: '39618505834' }]), []);
  });

  // @traces 1362-FR-004
  it('never calls a check with no run id or no start date an orphan', () => {
    assert.deepEqual(orphanedChecks([{ ...orphan, runId: undefined }, { ...retried, runId: undefined }]), []);
    assert.deepEqual(orphanedChecks([{ ...orphan, runId: null }, retried]), []);
    assert.deepEqual(orphanedChecks([{ ...orphan, startedAt: null }, retried]), []);
    assert.deepEqual(orphanedChecks([orphan, { ...retried, startedAt: 'not a date' }]), []);
  });

  it('takes nothing for nothing', () => {
    assert.deepEqual(orphanedChecks([]), []);
    assert.deepEqual(orphanedChecks(undefined), []);
  });
});

describe('the run id of a check run', () => {
  // @traces 1362-FR-003
  it('is read from an Actions details URL, and is null for anything else', () => {
    assert.equal(runIdOf(`https://github.com/george-hutanu/motor-fix/actions/runs/${RUN}/job/119285437128`), RUN);
    assert.equal(runIdOf('https://example.com/checks/1'), null);
    assert.equal(runIdOf(undefined), null);
  });
});

describe('the line that names an ignored orphan', () => {
  // @traces 1362-FR-003
  it('names the check, its workflow, the check run, the run and the newer attempt', () => {
    const line = orphanLine([{ ...orphan, workflowName: 'PR title' }], 'aa04cfd0eec3201ad509c2fa527b092500ec2fea');
    assert.match(line, /PR title \/ PR title/);
    assert.match(line, /119285437128/);
    assert.match(line, new RegExp(RUN));
    assert.match(line, /aa04cfd/);
    assert.match(line, /newer attempt/);
  });

  it('is null when nothing was ignored', () => {
    assert.equal(orphanLine([], 'aa04cfd'), null);
  });
});
