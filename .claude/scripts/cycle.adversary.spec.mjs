import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { cycleRow, idleGaps, main } from './cycle.mjs';

const at = (hhmm, day = '21') => `2026-10-${day}T${hhmm}:00Z`;
const merged = (n, extra = {}) => ({ number: n, head: { ref: `b${n}` }, created_at: at('09:00'), merged_at: at('10:00'), ...extra });

const capture = async (argv, api, records = []) => {
  const out = [];
  const code = await main(argv, { api, records, out: (s) => out.push(s) });
  return { code, text: out.join('\n') };
};

describe('the cycle report with sources that are missing or wrong', () => {
  // @traces 1361-FR-012
  it('exits 0 and prints a dash per figure when every GitHub read fails', async () => {
    let first = true;
    const api = (path) => {
      if (path.startsWith('pulls?') && first) {
        first = false;
        return [merged(12)];
      }
      throw new Error(`HTTP 500: ${path}`);
    };
    const { code, text } = await capture([], api);
    assert.equal(code, 0);
    assert.match(text, /#12/);
    assert.match(text, /[–-]/);
    assert.doesNotMatch(text, /NaN|undefined|null|Invalid/);
  });

  // @traces 1361-FR-012
  it('exits 0 when the list of merged PRs cannot be read at all', async () => {
    const { code } = await capture([], () => {
      throw new Error('HTTP 403: rate limit exceeded');
    });
    assert.equal(code, 0);
  });

  // @traces 1361-FR-012
  it('survives answers of the wrong shape: HTML for a timeline, an object for the runs, nulls in the PR', async () => {
    const api = (path) => {
      if (path.startsWith('pulls?')) return [merged(5), { number: 6, merged_at: at('10:00') }];
      if (path.includes('/timeline')) return '<html>Bad gateway</html>';
      if (path.includes('/runs')) return {};
      return null;
    };
    const { code, text } = await capture(['--json'], api, [null, {}, { branch: 'b5' }]);
    assert.equal(code, 0);
    const rows = JSON.parse(text);
    assert.deepEqual(rows.map((r) => r.pr), [5, 6]);
    for (const row of rows) for (const [key, value] of Object.entries(row)) assert.ok(value === null || Number.isFinite(value), `${row.pr} ${key}: ${value}`);
  });

  // @traces 1361-FR-012
  it('never asks GitHub for a page size outside 1 to 100: any other --limit is a usage error that asks nothing', async () => {
    for (const limit of ['0', '-5', 'abc', '100000', '2.5', '']) {
      const asked = [];
      const api = (path) => {
        asked.push(path);
        return [];
      };
      const { code } = await capture(['--limit', limit], api);
      assert.equal(code, 64, limit);
      assert.deepEqual(asked, [], `--limit ${limit} asked ${asked[0]}`);
    }
    for (const limit of ['1', '100']) {
      const asked = [];
      const { code } = await capture(['--limit', limit], (path) => {
        asked.push(path);
        return [];
      });
      assert.equal(code, 0, limit);
      assert.equal(Number(/per_page=([^&]+)/.exec(asked[0])?.[1]), Number(limit));
    }
  });

});

describe('cycleRow with hostile ledgers and timelines', () => {
  const base = { number: 1, head: '1361-x', created_at: at('09:00'), merged_at: at('11:00'), timeline: [], runs: [] };

  // @traces 1361-FR-012
  it('reads hook time that is not a number a ledger can hold as missing or zero, never NaN', () => {
    for (const hook_ms of ['abc', -5, null, {}, [], '12']) {
      const row = cycleRow({ ...base, ledgers: [{ branch: '1361-x', hook_ms }] });
      assert.ok(row.hook_minutes === null || (Number.isFinite(row.hook_minutes) && row.hook_minutes >= 0), `${String(hook_ms)}: ${row.hook_minutes}`);
    }
  });

  // @traces 1361-FR-012
  it('does not add the hook time of a session on a branch that merely starts with the PR\'s branch name', () => {
    const row = cycleRow({ ...base, ledgers: [{ branch: '1361-x', hook_ms: 60000 }, { branch: '1361-x-2', hook_ms: 600000 }, { branch: 'x-1361-x', hook_ms: 600000 }] });
    assert.equal(row.hook_minutes, 1);
  });

});
