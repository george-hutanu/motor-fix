import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { cycleRow, harnessLaps, idleGaps, main } from './cycle.mjs';

// The cycle report: per merged PR, how long it waited and why. Every source
// (GitHub's timeline, the QA runs, the telemetry ledgers) can be missing;
// a missing source prints a dash, never an error.

const at = (hhmm, day = '21') => `2026-10-${day}T${hhmm}:00Z`;
const committed = (hhmm) => ({ event: 'committed', committer: { date: at(hhmm) } });
const reviewed = (hhmm, body) => ({ event: 'reviewed', submitted_at: at(hhmm), body });
const run = (hhmm, conclusion = 'success', status = 'completed') => ({ created_at: at(hhmm), status, conclusion });

const full = () => ({
  number: 465,
  head: '1361-watch-schedule-qa-telemetry',
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
    { branch: '1361-watch-schedule-qa-telemetry', hook_ms: 90000 },
    { branch: '1361-watch-schedule-qa-telemetry', hook_ms: 30000 },
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
      pr: 465,
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
    const row = cycleRow({ ...full(), ledgers: [{ branch: '1361-watch-schedule-qa-telemetry', turns: 3 }] });
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
      [/^pulls\/465$/, { ...merged(465, { head: { ref: '1361-x' } }) }],
      [/^issues\/465\/timeline/, [{ event: 'ready_for_review', created_at: at('09:20') }]],
      [/^actions\/workflows\/pr-qa\.yml\/runs\?branch=1361-x/, { workflow_runs: [run('09:21')] }],
    ]);
    const { code, text } = await capture(['--pr', '465', '--json'], api, [{ branch: '1361-x', hook_ms: 120000 }]);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(text), [
      { pr: 465, open_to_ready: 20, ready_to_merge: 40, laps: 1, harness_laps: null, idle_gaps: 0, hook_minutes: 2 },
    ]);
  });

  it('counts the laps dispatched from main, matched to the PR by the run title', async () => {
    const titled = (hhmm, title, conclusion) => ({ ...run(hhmm, conclusion), display_title: title });
    const api = fakeApi([
      [/^pulls\/465$/, { ...merged(465, { head: { ref: '1361-x' } }) }],
      [/^issues\/465\/timeline/, [{ event: 'ready_for_review', created_at: at('09:20') }]],
      [/^actions\/workflows\/pr-qa\.yml\/runs\?branch=1361-x/, { workflow_runs: [run('09:20', 'skipped')] }],
      [
        /^actions\/workflows\/pr-qa\.yml\/runs\?event=workflow_dispatch&created=%3E%3D2026-10-21/,
        {
          workflow_runs: [
            titled('09:21', 'PR QA #465 at abc lap 1 465-abc-x', 'failure'),
            titled('09:40', 'PR QA #465 at def lap 2 465-def-y'),
            titled('09:41', 'PR QA #4650 at fed lap 1 4650-fed-z'),
          ],
        },
      ],
    ]);
    const { text } = await capture(['--pr', '465', '--json'], api);
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
});
