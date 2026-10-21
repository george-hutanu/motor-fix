import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { cycleRow, harnessLaps, idleGaps, logStamps, main } from './cycle.mjs';

// The cycle report: per merged PR, how long it waited and why. Every source
// (GitHub's timeline, the QA runs, the telemetry ledgers) can be missing;
// a missing source prints a dash, never an error.

const at = (hhmm, day = '21') => `2026-10-${day}T${hhmm}:00Z`;
const committed = (hhmm) => ({ event: 'committed', committer: { date: at(hhmm) } });
const reviewed = (hhmm, body) => ({ event: 'reviewed', submitted_at: at(hhmm), body });
const run = (hhmm, conclusion = 'success', status = 'completed') => ({ created_at: at(hhmm), status, conclusion });

const full = () => ({
  number: 900,
  head: '900-some-feature',
  created_at: at('09:00'),
  merged_at: at('14:00'),
  timeline: [
    committed('09:00'),
    committed('10:00'),
    { event: 'labeled', created_at: at('10:05') },
    { event: 'ready_for_review', created_at: at('11:30') },
    reviewed('12:00', 'Blocking: flow not run for /ro/app/garage'),
    committed('12:20'),
    reviewed('12:50', 'Looks right. No findings.'),
    { event: 'ready_for_review', created_at: at('12:55') },
  ],
  runs: [run('11:31', 'failure'), run('12:21'), run('12:22', 'cancelled'), run('13:00', null, 'in_progress')],
  ledgers: [
    { branch: '900-some-feature', hook_ms: 90000 },
    { branch: '900-some-feature', hook_ms: 30000 },
    { branch: 'main', hook_ms: 600000 },
  ],
});

// @traces 1361-FR-012
describe('cycle — idle gaps', () => {
  it('lists every gap over 60 minutes between consecutive times, whatever their order', () => {
    assert.deepEqual(idleGaps([at('12:00'), at('09:00'), at('10:00'), at('10:30'), at('14:01')]), [90, 121]);
  });

  it('does not count a gap of exactly 60 minutes', () => {
    assert.deepEqual(idleGaps([at('09:00'), at('10:00')]), []);
  });

  it('reads no times and unparseable times as no gaps', () => {
    assert.deepEqual(idleGaps([]), []);
    assert.deepEqual(idleGaps([null, 'not a date', at('09:00')]), []);
  });
});

// @traces 1361-FR-012
describe('cycle — harness-caused laps', () => {
  it('counts the reviews that name a harness failure', () => {
    const reviews = [
      { body: 'Blocking: flow not run for /ro' },
      { body: 'High: Page did not load: /en/app/garage' },
      { body: 'could not sign in as owner (owner@x): HTTP 401' },
      { body: 'sign-in answered 429' },
      { body: 'A flow threw: TypeError in the flows file' },
      { body: 'Medium: the button is misaligned at 320 px' },
      { body: '' },
    ];
    assert.equal(harnessLaps(reviews), 5);
  });

  it('is missing, not zero, when there are no reviews', () => {
    assert.equal(harnessLaps([]), null);
    assert.equal(harnessLaps(null), null);
  });
});

// @traces 1361-FR-012
describe('cycle — one row', () => {
  it('prints open to ready, ready to merge, laps, harness laps, idle gaps and hook minutes', () => {
    assert.deepEqual(cycleRow(full()), {
      pr: 900,
      open_to_ready: 150,
      ready_to_merge: 150,
      laps: 2,
      harness_laps: 1,
      idle_gaps: 1,
      hook_minutes: 2,
    });
  });

  it('times a PR opened ready from its opening, with open to ready missing', () => {
    const pr = { ...full(), timeline: full().timeline.filter((e) => e.event !== 'ready_for_review') };
    const row = cycleRow(pr);
    assert.equal(row.open_to_ready, null);
    assert.equal(row.ready_to_merge, 300);
  });

  it('marks every source it lacks as missing: no ledger, no runs, no timeline', () => {
    const row = cycleRow({ number: 7, head: 'dependabot/npm/x', created_at: at('09:00'), merged_at: at('09:30'), timeline: null, runs: null, ledgers: [] });
    assert.deepEqual(row, { pr: 7, open_to_ready: null, ready_to_merge: 30, laps: null, harness_laps: null, idle_gaps: 0, hook_minutes: null });
  });

  it('reads a ledger written before hook time was recorded as missing hook minutes', () => {
    const row = cycleRow({ ...full(), ledgers: [{ branch: '900-some-feature', turns: 3 }] });
    assert.equal(row.hook_minutes, null);
  });
});

// @traces 1361-FR-012
describe('cycle — the report', () => {
  const merged = (n, extra = {}) => ({ number: n, head: { ref: `b${n}` }, created_at: at('09:00'), merged_at: at('10:00'), ...extra });
  const fakeApi = (routes) => (path) => {
    for (const [pattern, answer] of routes) if (pattern.test(path)) return typeof answer === 'function' ? answer(path) : answer;
    throw new Error(`HTTP 404: ${path}`);
  };
  const capture = async (argv, api, records = []) => {
    const out = [];
    const code = await main(argv, { api, records, out: (s) => out.push(s) });
    return { code, text: out.join('\n') };
  };

  it('lists the merged PRs only, with a dash for each missing source, and exits 0', async () => {
    const api = fakeApi([
      [/^pulls\?state=closed/, [merged(12), { ...merged(11), merged_at: null }]],
      [/^issues\/12\/timeline/, () => { throw new Error('HTTP 502'); }],
      [/^actions\/workflows\/pr-qa\.yml\/runs/, { workflow_runs: [] }],
    ]);
    const { code, text } = await capture([], api);
    assert.equal(code, 0);
    assert.match(text, /#12/);
    assert.doesNotMatch(text, /#11/, 'a closed, unmerged PR is not a cycle');
    assert.match(text, /–/);
  });

  it('prints one PR with --pr and the rows as JSON with --json', async () => {
    const api = fakeApi([
      [/^pulls\/900$/, { ...merged(900, { head: { ref: '900-x' } }) }],
      [/^issues\/900\/timeline/, [{ event: 'ready_for_review', created_at: at('09:20') }]],
      [/^actions\/workflows\/pr-qa\.yml\/runs\?branch=900-x/, { workflow_runs: [run('09:21')] }],
    ]);
    const { code, text } = await capture(['--pr', '900', '--json'], api, [{ branch: '900-x', hook_ms: 120000 }]);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(text), [
      { pr: 900, open_to_ready: 20, ready_to_merge: 40, laps: 1, harness_laps: null, idle_gaps: 0, hook_minutes: 2 },
    ]);
  });

  it('counts the laps dispatched from main, matched to the PR by the run title', async () => {
    const titled = (hhmm, title, conclusion) => ({ ...run(hhmm, conclusion), display_title: title });
    const api = fakeApi([
      [/^pulls\/900$/, { ...merged(900, { head: { ref: '900-x' } }) }],
      [/^issues\/900\/timeline/, [{ event: 'ready_for_review', created_at: at('09:20') }]],
      [/^actions\/workflows\/pr-qa\.yml\/runs\?branch=900-x/, { workflow_runs: [run('09:20', 'skipped')] }],
      [
        /^actions\/workflows\/pr-qa\.yml\/runs\?event=workflow_dispatch&created=%3E%3D2026-10-21/,
        {
          workflow_runs: [
            titled('09:21', 'PR QA #900 at abc lap 1 900-abc-x', 'failure'),
            titled('09:40', 'PR QA #900 at def lap 2 900-def-y'),
            titled('09:41', 'PR QA #9000 at fed lap 1 9000-fed-z'),
          ],
        },
      ],
    ]);
    const { text } = await capture(['--pr', '900', '--json'], api);
    assert.equal(JSON.parse(text)[0].laps, 2);
  });

  it('asks GitHub for no more PRs than --limit', async () => {
    const asked = [];
    const api = (path) => {
      asked.push(path);
      if (path.startsWith('pulls?')) return [];
      throw new Error('unexpected');
    };
    const { code } = await capture(['--limit', '3'], api);
    assert.equal(code, 0);
    assert.match(asked[0], /per_page=3\b/);
  });
  it('asks for 25 PRs when --limit is not given', async () => {
    const asked = [];
    await capture([], (path) => {
      asked.push(path);
      return [];
    });
    assert.match(asked[0], /per_page=25$/);
  });

  it('refuses a --limit outside 1 to 100 and a --pr that is not a number as usage errors, asking GitHub nothing', async () => {
    for (const argv of [['--limit', '0'], ['--limit', '101'], ['--limit'], ['--pr', '../../user'], ['--pr', '0']]) {
      const asked = [];
      const errors = [];
      const code = await main(argv, { api: (path) => asked.push(path) && [], records: [], out: () => {}, err: (s) => errors.push(s) });
      assert.equal(code, 64, argv.join(' '));
      assert.deepEqual(asked, []);
      assert.match(errors.join('\n'), /^usage: cycle\.mjs/);
    }
  });

  it('prints one line naming the error, and exits 0, when the merged PRs cannot be read', async () => {
    for (const fail of [() => { throw new Error('HTTP 403: rate limit exceeded\nmore detail'); }, () => ({ message: 'Not Found' })]) {
      const out = [];
      const code = await main([], { api: fail, records: [], out: (s) => out.push(s) });
      assert.equal(code, 0);
      assert.equal(out.length, 1);
      assert.match(out[0], /^cannot read merged PRs: /);
      assert.doesNotMatch(out[0], /more detail/);
    }
    const out = [];
    const errors = [];
    await main(['--json'], { api: () => { throw new Error('HTTP 500'); }, records: [], out: (s) => out.push(s), err: (s) => errors.push(s) });
    assert.deepEqual(out, ['[]'], 'the JSON output stays JSON');
    assert.match(errors.join('\n'), /cannot read merged PRs: HTTP 500/);
  });

  it('reads every page of the timeline, so a ready event past the first hundred still counts', async () => {
    const asks = [];
    const api = (path, opts) => {
      asks.push([path, opts]);
      if (/^pulls\/900$/.test(path)) return merged(900);
      if (/^issues\/900\/timeline/.test(path)) return [...Array.from({ length: 150 }, () => ({ event: 'labeled' })), { event: 'ready_for_review', created_at: at('09:20') }];
      return { workflow_runs: [] };
    };
    const { text } = await capture(['--pr', '900', '--json'], api);
    assert.deepEqual(asks.find(([path]) => path.includes('/timeline'))[1], { paginate: true });
    assert.equal(JSON.parse(text)[0].open_to_ready, 20);
  });
});

// @traces 1361-FR-012
describe("cycle — the feature's logs", () => {
  it('reads the UTC minute each stamped line starts with, and skips the rest', () => {
    const text = ['# Auto run', '- 2026-10-21 09:05 · start · ST-1 · go', '2026-10-21 10:40 phase 9 done', '- 2026-10-21 · an older date-only line', '  continued text 2026-10-21 11:00', '- 2026-10-21 12:00:30 not a minute'].join('\n');
    assert.deepEqual(logStamps(text), [at('09:05'), at('10:40')]);
    assert.deepEqual(logStamps(null), []);
  });

  it('reads an ISO stamp to its minute, as level.mjs and the precompact flush write them', () => {
    const text = [
      '- 2026-10-21T10:05:00.000Z · level 1 → 2 · files: 9',
      '## Compaction 2026-10-21T11:30:59.999Z (auto)',
      '2026-10-21T12:15Z bare',
      '- 2026-10-21T13:00:00+03:00 an offset is not UTC',
      '- 2026-10-21T14:00 no zone',
    ].join('\n');
    assert.deepEqual(logStamps(text), [at('10:05'), at('11:30'), at('12:15')]);
  });

  it("counts the idle gaps the feature's logs show, within the PR's open to merge", () => {
    const base = { number: 1, head: '900-x', created_at: at('09:00'), merged_at: at('12:00'), timeline: [], runs: [] };
    assert.equal(cycleRow(base).idle_gaps, 1, 'opened to merged is one gap of 180');
    assert.equal(cycleRow({ ...base, logStamps: [at('09:50'), at('10:40'), at('11:30')] }).idle_gaps, 0);
    assert.equal(cycleRow({ ...base, logStamps: [at('08:00'), at('13:30')] }).idle_gaps, 1, 'stamps outside the PR do not count');
  });

  it("passes the PR's branch to the log reader, and a reader that fails is a missing source", async () => {
    const pr = { number: 12, head: { ref: 'b12' }, created_at: at('09:00'), merged_at: at('12:00') };
    const api = (path) => (path.startsWith('pulls?') ? [pr] : path.includes('/timeline') ? [] : { workflow_runs: [] });
    const report = async (featureLogs) => {
      const out = [];
      const code = await main(['--json'], { api, records: [], out: (s) => out.push(s), featureLogs });
      return { code, row: JSON.parse(out[0])[0] };
    };
    const asked = [];
    const stamped = await report((branch) => {
      asked.push(branch);
      return [at('10:00'), at('11:00')];
    });
    assert.deepEqual(asked, ['b12']);
    assert.equal(stamped.code, 0);
    assert.equal(stamped.row.idle_gaps, 0);
    const failed = await report(() => {
      throw new Error('EACCES');
    });
    assert.equal(failed.code, 0);
    assert.equal(failed.row.idle_gaps, 1);
  });
});
