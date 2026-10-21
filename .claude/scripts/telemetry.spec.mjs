import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyRecord, mergeTranscript, ranked, summarize } from './lib/telemetry.mjs';
import { byLevel, loadRecords, phases, unused } from './telemetry.mjs';

// The usage ledger. Two things matter beyond the counting: it must fold a
// transcript incrementally (a session's transcript is re-read every turn), and
// it must never record message content.

const HOOK = new URL('../hooks/session-telemetry.mjs', import.meta.url).pathname;

const assistant = (blocks, usage = {}, timestamp = '2026-09-12T10:00:00Z', id) =>
  `${JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { ...(id ? { id } : {}), usage, content: blocks },
  })}\n`;
const used = (input, output, cache_read = 0, cache_creation = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cache_read,
  cache_creation_input_tokens: cache_creation,
});
const tokens = (input, output, cache_read = 0, cache_creation = 0) => ({ input, output, cache_read, cache_creation });
const user = (text) => `${JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } })}\n`;
const toolUse = (name, input = {}) => ({ type: 'tool_use', name, input });

describe('telemetry — folding a transcript', () => {
  it('counts turns, tools, skills and subagents', () => {
    const text =
      assistant([toolUse('Read'), toolUse('Skill', { skill: 'speckit-doctor' })]) +
      assistant([toolUse('Read'), toolUse('Agent', { subagent_type: 'code-reviewer' })]) +
      user('ignored');
    const { record } = mergeTranscript(emptyRecord('s1'), text);
    assert.equal(record.turns, 2);
    assert.deepEqual(record.tools, { Read: 2, Skill: 1, Agent: 1 });
    assert.deepEqual(record.skills, { 'speckit-doctor': 1 });
    assert.deepEqual(record.agents, { 'code-reviewer': 1 });
  });

  it('sums the model usage blocks', () => {
    const text =
      assistant([], { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 100 }) +
      assistant([], { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 50 });
    const { record } = mergeTranscript(emptyRecord('s1'), text);
    assert.deepEqual(record.tokens, { input: 15, output: 5, cache_read: 100, cache_creation: 50 });
  });

  it('keeps first and last timestamps', () => {
    const text = assistant([], {}, '2026-09-12T10:00:00Z') + assistant([], {}, '2026-09-12T11:00:00Z');
    const { record } = mergeTranscript(emptyRecord('s1'), text);
    assert.equal(record.started, '2026-09-12T10:00:00Z');
    assert.equal(record.updated, '2026-09-12T11:00:00Z');
  });

  it('drops a partial trailing line and reports how much it consumed', () => {
    const whole = assistant([toolUse('Read')]);
    const { record, consumed } = mergeTranscript(emptyRecord('s1'), `${whole}{"type":"assis`);
    assert.equal(record.turns, 1);
    assert.equal(consumed, Buffer.byteLength(whole, 'utf8'));
  });

  it('folds the same session twice without double counting', () => {
    const first = assistant([toolUse('Read')]);
    const second = assistant([toolUse('Edit')]);
    const a = mergeTranscript(emptyRecord('s1'), first);
    const b = mergeTranscript(a.record, second);
    assert.equal(b.record.turns, 2);
    assert.deepEqual(b.record.tools, { Read: 1, Edit: 1 });
  });

  it('survives junk lines', () => {
    const { record } = mergeTranscript(emptyRecord('s1'), `not json\n\n${assistant([toolUse('Read')])}`);
    assert.equal(record.turns, 1);
  });
});

describe('telemetry — summarising', () => {
  it('adds up records and ranks by count', () => {
    const total = summarize([
      { turns: 1, tokens: { input: 1, output: 1, cache_read: 0, cache_creation: 0 }, skills: { a: 2 }, tools: {}, agents: {} },
      { turns: 2, tokens: { input: 3, output: 0, cache_read: 5, cache_creation: 0 }, skills: { a: 1, b: 4 }, tools: {}, agents: {} },
    ]);
    assert.equal(total.turns, 3);
    assert.equal(total.tokens.input, 4);
    assert.equal(total.tokens.cache_read, 5);
    assert.deepEqual(ranked(total.skills), [
      ['b', 4],
      ['a', 3],
    ]);
  });

  it('treats an empty ledger as zero, not as an error', () => {
    assert.equal(summarize([]).sessions, 0);
  });
});

describe('telemetry — the ledger on disk', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'telemetry-'));
    mkdirSync(join(repo, '.claude/skills/used-skill'), { recursive: true });
    mkdirSync(join(repo, '.claude/skills/dead-skill'), { recursive: true });
    mkdirSync(join(repo, '.claude/agents'), { recursive: true });
    writeFileSync(join(repo, '.claude/agents/dead-agent.md'), '---\nname: dead-agent\n---\n');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const runHook = (transcript, sessionId = 'sess-1') =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    });

  it('writes one ledger per session and re-reads only new bytes', () => {
    const transcript = join(repo, 'transcript.jsonl');
    writeFileSync(transcript, assistant([toolUse('Skill', { skill: 'used-skill' })]));
    assert.equal(runHook(transcript).status, 0);

    const file = join(repo, '.specify/telemetry/sess-1.json');
    assert.ok(existsSync(file));
    let record = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(record.turns, 1);
    assert.deepEqual(record.skills, { 'used-skill': 1 });

    writeFileSync(transcript, readFileSync(transcript, 'utf8') + assistant([toolUse('Edit')]));
    runHook(transcript);
    record = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(record.turns, 2, 'the first turn must not be counted twice');
    assert.equal(record.bytes_read, readFileSync(transcript).length);
  });

  it('records no message content', () => {
    const transcript = join(repo, 'transcript.jsonl');
    writeFileSync(transcript, user('my secret prompt') + assistant([{ type: 'text', text: 'my secret answer' }]));
    runHook(transcript);
    const ledger = readFileSync(join(repo, '.specify/telemetry/sess-1.json'), 'utf8');
    assert.doesNotMatch(ledger, /secret/);
  });

  it('exits quietly when the payload names no transcript', () => {
    const run = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: 'x' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    });
    assert.equal(run.status, 0);
    assert.equal(existsSync(join(repo, '.specify/telemetry')), false);
  });

  it('lists declared skills and agents that never fired', () => {
    const transcript = join(repo, 'transcript.jsonl');
    writeFileSync(transcript, assistant([toolUse('Skill', { skill: 'used-skill' })]));
    runHook(transcript);
    const gaps = unused(repo, loadRecords(repo));
    assert.deepEqual(gaps.skills, ['dead-skill']);
    assert.deepEqual(gaps.agents, ['dead-agent']);
    assert.equal(gaps.sessions, 1);
  });

  it('reads an empty telemetry directory as no data', () => {
    assert.deepEqual(loadRecords(repo), []);
  });
});

describe('telemetry — streamed messages and buckets', () => {
  it('counts a streamed message once, keeping its last usage', () => {
    const text =
      assistant([], used(2, 6, 100, 50), undefined, 'msg_1') +
      assistant([toolUse('Read')], used(2, 250, 100, 50), undefined, 'msg_1') +
      assistant([], used(2, 250, 100, 50), undefined, 'msg_1');
    const { record } = mergeTranscript(emptyRecord('s1'), text);
    assert.deepEqual(record.tokens, tokens(2, 250, 100, 50));
    assert.equal(record.turns, 1);
    assert.deepEqual(record.tools, { Read: 1 });
  });

  it('carries a streamed message across two reads', () => {
    const a = mergeTranscript(emptyRecord('s1'), assistant([], used(1, 5), undefined, 'msg_1'));
    const b = mergeTranscript(a.record, assistant([], used(1, 40), undefined, 'msg_1') + assistant([], used(3, 7), undefined, 'msg_2'));
    assert.deepEqual(b.record.tokens, tokens(4, 47));
    assert.equal(b.record.turns, 2);
  });

  it('puts new tokens under the (level, phase) bucket and leaves the earlier bucket alone', () => {
    const a = mergeTranscript(emptyRecord('s1'), assistant([], used(10, 1), undefined, 'm1'), { bucket: '1/implement' });
    const b = mergeTranscript(a.record, assistant([], used(20, 2), undefined, 'm2'), { bucket: '2/implement' });
    assert.deepEqual(b.record.buckets['1/implement'].tokens, tokens(10, 1));
    assert.deepEqual(b.record.buckets['2/implement'].tokens, tokens(20, 2));
    assert.deepEqual(b.record.tokens, tokens(30, 3));
  });

  it('counts a subagent transcript under its agent type, in the bucket and the total, without its tool calls', () => {
    const record = emptyRecord('s1');
    const cursor = { last_message_id: null, last_usage: null };
    mergeTranscript(record, assistant([toolUse('Grep')], used(5, 1), undefined, 'a1') + assistant([], used(5, 9), undefined, 'a1'), {
      bucket: '1/review',
      agentType: 'spec-reviewer',
      cursor,
    });
    assert.deepEqual(record.subagent_tokens, { 'spec-reviewer': tokens(5, 9) });
    assert.deepEqual(record.buckets['1/review'].subagent_tokens, tokens(5, 9));
    assert.deepEqual(record.tokens, tokens(5, 9));
    assert.deepEqual(record.tools, {}, 'a subagent tool call is not a session tool call');
    assert.equal(record.turns, 0);
    assert.equal(cursor.last_message_id, 'a1');
  });
});

describe('telemetry — the hook and the subagents folder', () => {
  let repo;
  let projects;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'telemetry-level-'));
    projects = mkdtempSync(join(tmpdir(), 'telemetry-projects-'));
    mkdirSync(join(repo, 'specs/042-small'), { recursive: true });
    writeFileSync(join(repo, 'specs/042-small/spec.md'), '# Spec\n');
    mkdirSync(join(repo, '.specify'), { recursive: true });
    writeFileSync(
      join(repo, '.specify/feature.json'),
      JSON.stringify({ feature_directory: 'specs/042-small', level: 1, level_for: 'specs/042-small' }),
    );
    writeFileSync(join(repo, '.specify/run-state.json'), JSON.stringify({ status: 'in-progress', phase: 'implement' }));
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(projects, { recursive: true, force: true });
  });

  const runHook = (transcript) =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: 'sess-9', transcript_path: transcript }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, SPECKIT_FEATURE_LEVEL: '' },
    });
  const ledger = () => JSON.parse(readFileSync(join(repo, '.specify/telemetry/sess-9.json'), 'utf8'));

  it('records the level and phase, and folds each subagent transcript once per message', () => {
    const transcript = join(projects, 'sess-9.jsonl');
    writeFileSync(transcript, assistant([], used(10, 1), undefined, 'm1'));
    const sub = join(projects, 'sess-9', 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sub, 'agent-abc.jsonl'),
      assistant([], used(2, 3), undefined, 's1') + assistant([], used(2, 30), undefined, 's1') + assistant([], used(2, 30), undefined, 's1'),
    );
    writeFileSync(join(sub, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'code-reviewer' }));
    writeFileSync(join(sub, 'agent-def.jsonl'), assistant([], used(1, 1), undefined, 's1'));
    assert.equal(runHook(transcript).status, 0);

    let r = ledger();
    assert.equal(r.level, 1);
    assert.equal(r.phase, 'implement');
    assert.deepEqual(r.subagent_tokens, { 'code-reviewer': tokens(2, 30), unknown: tokens(1, 1) });
    assert.deepEqual(r.buckets['1/implement'].tokens, tokens(13, 32));
    assert.deepEqual(r.buckets['1/implement'].subagent_tokens, tokens(3, 31));
    assert.deepEqual(r.tokens, tokens(13, 32));

    // A promotion, then one more turn: the new tokens land under level 2 only.
    writeFileSync(
      join(repo, '.specify/feature.json'),
      JSON.stringify({ feature_directory: 'specs/042-small', level: 2, level_for: 'specs/042-small' }),
    );
    writeFileSync(transcript, readFileSync(transcript, 'utf8') + assistant([], used(4, 4), undefined, 'm2'));
    runHook(transcript);
    r = ledger();
    assert.deepEqual(r.buckets['1/implement'].tokens, tokens(13, 32), 'the earlier bucket is not rewritten');
    assert.deepEqual(r.buckets['2/implement'].tokens, tokens(4, 4));
    assert.deepEqual(r.subagent_tokens['code-reviewer'], tokens(2, 30), 'a subagent transcript is not read twice');
  });

  it('skips an unreadable subagent transcript and still writes the session', () => {
    const transcript = join(projects, 'sess-9.jsonl');
    writeFileSync(transcript, assistant([], used(5, 5), undefined, 'm1'));
    const sub = join(projects, 'sess-9', 'subagents');
    mkdirSync(join(sub, 'agent-bad.jsonl'), { recursive: true });
    writeFileSync(join(sub, 'agent-ok.jsonl'), assistant([], used(1, 2), undefined, 's1'));
    assert.equal(runHook(transcript).status, 0);
    assert.deepEqual(ledger().tokens, tokens(6, 7));
  });

  it('buckets under phase none once the run is done, or when it is another feature\'s run', () => {
    const transcript = join(projects, 'sess-9.jsonl');
    writeFileSync(transcript, assistant([], used(1, 1), undefined, 'm1'));
    writeFileSync(join(repo, '.specify/run-state.json'), JSON.stringify({ status: 'done', phase: 'archive', feature: 'specs/042-small' }));
    runHook(transcript);
    assert.equal(ledger().phase, 'none');
    writeFileSync(join(repo, '.specify/run-state.json'), JSON.stringify({ status: 'in-progress', phase: 'plan', feature: 'specs/007-other' }));
    writeFileSync(transcript, readFileSync(transcript, 'utf8') + assistant([], used(1, 1), undefined, 'm2'));
    runHook(transcript);
    assert.equal(ledger().phase, 'none');
    assert.deepEqual(Object.keys(ledger().buckets), ['1/none']);
    writeFileSync(join(repo, '.specify/run-state.json'), JSON.stringify({ status: 'in-progress', phase: 'plan', feature: 'specs/042-small' }));
    writeFileSync(transcript, readFileSync(transcript, 'utf8') + assistant([], used(1, 1), undefined, 'm3'));
    runHook(transcript);
    assert.equal(ledger().phase, 'plan', 'this feature\'s live run');
  });

  it('leaves a partial trailing subagent line for the next Stop', () => {
    const transcript = join(projects, 'sess-9.jsonl');
    writeFileSync(transcript, '');
    const sub = join(projects, 'sess-9', 'subagents');
    mkdirSync(sub, { recursive: true });
    const whole = assistant([], used(1, 2), undefined, 's1');
    writeFileSync(join(sub, 'agent-x.jsonl'), `${whole}{"type":"assis`);
    runHook(transcript);
    assert.equal(ledger().subagents['agent-x.jsonl'].bytes_read, Buffer.byteLength(whole));
  });

  it('records no message content from a subagent transcript', () => {
    const transcript = join(projects, 'sess-9.jsonl');
    writeFileSync(transcript, '');
    const sub = join(projects, 'sess-9', 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'agent-x.jsonl'), user('secret brief') + assistant([{ type: 'text', text: 'secret finding' }], used(1, 1), undefined, 's1'));
    runHook(transcript);
    assert.doesNotMatch(readFileSync(join(repo, '.specify/telemetry/sess-9.json'), 'utf8'), /secret/);
  });

  it('folds a pending too-heavy mark into the ledger and removes the file', () => {
    const transcript = join(projects, 'sess-9.jsonl');
    writeFileSync(transcript, '');
    mkdirSync(join(repo, '.specify/telemetry'), { recursive: true });
    const mark = { feature: 'specs/042-small', level: 2, file: 'apps/web/src/x.ts', at: '2026-10-06T10:00:00Z' };
    writeFileSync(join(repo, '.specify/telemetry/pending.json'), JSON.stringify({ too_heavy: [mark] }));
    assert.equal(runHook(transcript).status, 0);
    assert.deepEqual(ledger().too_heavy, [mark]);
    assert.equal(existsSync(join(repo, '.specify/telemetry/pending.json')), false);
    assert.equal(loadRecords(repo).length, 1, 'pending.json is not a ledger');
  });

  it('exits 0 when the ledger directory cannot be written', () => {
    const transcript = join(projects, 'sess-9.jsonl');
    writeFileSync(transcript, assistant([], used(1, 1)));
    writeFileSync(join(repo, '.specify/telemetry'), 'a file where the directory should be');
    assert.equal(runHook(transcript).status, 0);
  });
});

describe('telemetry — by level', () => {
  const bucket = (t, s = tokens(0, 0)) => ({ tokens: t, subagent_tokens: s });

  it('totals per level with the subagent tokens, per phase under each level, and per feature', () => {
    const report = byLevel([
      { feature: '001-a', level: 1, tokens: tokens(10, 0), buckets: { '1/specify': bucket(tokens(4, 0)), '1/implement': bucket(tokens(6, 0), tokens(2, 0)) } },
      { feature: '001-a', level: 2, tokens: tokens(5, 0), buckets: { '2/plan': bucket(tokens(5, 0)) } },
      { feature: '002-b', level: 2, tokens: tokens(7, 0), buckets: { '2/implement': bucket(tokens(7, 0), tokens(7, 0)) } },
    ]);
    assert.equal(report.levels['1'].total, 10);
    assert.equal(report.levels['1'].subagents, 2);
    assert.equal(report.levels['1'].phases.implement.total, 6);
    assert.equal(report.levels['2'].total, 12);
    assert.equal(report.levels['2'].subagents, 7);
    assert.deepEqual(report.features['001-a'], { level: 2, total: 15 });
    assert.deepEqual(report.features['002-b'], { level: 2, total: 7 });
  });

  it('puts ledgers written before levels under unknown level', () => {
    const report = byLevel([{ feature: null, tokens: tokens(3, 4) }]);
    assert.equal(report.levels.unknown.total, 7);
  });

  it('lists a feature and file marked too heavy once, however many sessions marked it', () => {
    const mark = (at) => ({ feature: 'specs/002-b', level: 2, file: 'x.mjs', at });
    const report = byLevel([
      { tokens: tokens(0, 0), buckets: {}, too_heavy: [mark('t1')] },
      { tokens: tokens(0, 0), buckets: {}, too_heavy: [mark('t2'), { ...mark('t3'), file: 'y.mjs' }] },
    ]);
    assert.deepEqual(report.too_heavy.map((m) => m.file), ['x.mjs', 'y.mjs']);
  });

  it('lists the too-heavy marks', () => {
    const mark = { feature: 'specs/002-b', level: 2, file: 'x.mjs', at: 't' };
    assert.deepEqual(byLevel([{ tokens: tokens(0, 0), buckets: {}, too_heavy: [mark] }]).too_heavy, [mark]);
  });

  it('prints the report and exits 0 with no ledgers at all', () => {
    const empty = mkdtempSync(join(tmpdir(), 'telemetry-empty-'));
    try {
      const run = spawnSync(process.execPath, [new URL('./telemetry.mjs', import.meta.url).pathname, '--by-level'], {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: empty },
      });
      assert.equal(run.status, 0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// A main checkout and one linked worktree, in a scratch directory.
const gitWorld = () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'telemetry-git-')));
  const main = join(scratch, 'main');
  const linked = join(scratch, 'wt');
  mkdirSync(main);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd, stdio: 'pipe', encoding: 'utf8', env });
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'feature', linked);
  return { scratch, main, linked };
};

const hookLine = (durationMs, timestamp = '2026-10-21T10:00:30Z') =>
  `${JSON.stringify({ type: 'attachment', timestamp, attachment: { type: 'hook_success', hookName: 'PreToolUse:Bash', exitCode: 0, durationMs } })}\n`;
const stopSummary = (durations, timestamp = '2026-10-21T10:05:00Z') =>
  `${JSON.stringify({ type: 'system', subtype: 'stop_hook_summary', timestamp, hookInfos: [...durations.map((durationMs) => ({ command: 'x', durationMs })), { command: 'callback' }] })}\n`;

// @traces 1361-FR-009
describe('telemetry — subagent skills, bucket times and hook time', () => {
  it('counts the skills and subagents a subagent transcript invokes, per agent type, without its other tool calls', () => {
    const record = emptyRecord('s1');
    const text =
      assistant([toolUse('Skill', { skill: 'speckit-plan' }), toolUse('Read')], used(1, 1), undefined, 'p1') +
      assistant([toolUse('Skill', { skill: 'speckit-tasks' }), toolUse('Agent', { subagent_type: 'spec-reviewer' })], used(1, 1), undefined, 'p2') +
      assistant([toolUse('Task', { subagent_type: 'code-reviewer' })], used(1, 1), undefined, 'p3');
    mergeTranscript(record, text, { bucket: '2/plan', agentType: 'task-runner', cursor: { last_message_id: null, last_usage: null } });
    assert.deepEqual(record.skills, { 'speckit-plan': 1, 'speckit-tasks': 1 });
    assert.deepEqual(record.agents, { 'spec-reviewer': 1, 'code-reviewer': 1 });
    assert.deepEqual(record.subagent_skills, { 'task-runner': { 'speckit-plan': 1, 'speckit-tasks': 1 } });
    assert.deepEqual(record.tools, {}, 'a subagent tool call is still not a session tool call');
    assert.equal(record.turns, 0);
  });

  it('keeps a session skill out of subagent_skills', () => {
    const { record } = mergeTranscript(emptyRecord('s1'), assistant([toolUse('Skill', { skill: 'speckit-auto' })]), { bucket: '2/plan' });
    assert.deepEqual(record.skills, { 'speckit-auto': 1 });
    assert.deepEqual(record.subagent_skills, {});
  });

  it('stamps each bucket with the first and last time it was written, from session and subagent lines', () => {
    const record = emptyRecord('s1');
    mergeTranscript(record, assistant([], used(1, 1), '2026-10-21T10:00:00Z', 'm1') + assistant([], used(1, 1), '2026-10-21T10:20:00Z', 'm2'), {
      bucket: '2/plan',
    });
    mergeTranscript(record, assistant([], used(1, 1), '2026-10-21T09:58:00Z', 'a1') + assistant([], used(1, 1), '2026-10-21T10:30:00Z', 'a2'), {
      bucket: '2/plan',
      agentType: 'task-runner',
      cursor: { last_message_id: null, last_usage: null },
    });
    mergeTranscript(record, assistant([], used(1, 1), '2026-10-21T11:00:00Z', 'm3'), { bucket: '2/tasks' });
    assert.equal(record.buckets['2/plan'].first, '2026-10-21T09:58:00Z');
    assert.equal(record.buckets['2/plan'].last, '2026-10-21T10:30:00Z');
    assert.equal(record.buckets['2/tasks'].first, '2026-10-21T11:00:00Z');
    assert.equal(record.buckets['2/tasks'].last, '2026-10-21T11:00:00Z');
  });

  it('sums hook milliseconds from hook_success attachments and stop_hook_summary entries, per bucket and in all', () => {
    const record = emptyRecord('s1');
    mergeTranscript(record, hookLine(120) + assistant([], used(1, 1), undefined, 'm1') + stopSummary([100, 250]), { bucket: '2/plan' });
    mergeTranscript(record, hookLine(30), { bucket: '2/tasks' });
    assert.equal(record.buckets['2/plan'].hook_ms, 470);
    assert.equal(record.buckets['2/tasks'].hook_ms, 30);
    assert.equal(record.hook_ms, 500);
  });

  it('counts the hook time a subagent transcript records', () => {
    const record = emptyRecord('s1');
    mergeTranscript(record, hookLine(40), { bucket: '2/plan', agentType: 'task-runner', cursor: { last_message_id: null, last_usage: null } });
    assert.equal(record.hook_ms, 40);
    assert.equal(record.buckets['2/plan'].hook_ms, 40);
  });

  it('folds into a ledger written before these fields without throwing, and leaves it readable', () => {
    const old = { session_id: 'old', turns: 1, tools: {}, skills: { a: 1 }, agents: {}, tokens: tokens(1, 1), buckets: { '2/plan': { tokens: tokens(1, 1), subagent_tokens: tokens(0, 0) } } };
    mergeTranscript(old, hookLine(10) + assistant([toolUse('Skill', { skill: 'b' })], used(1, 1), '2026-10-21T10:00:00Z', 'm1'), {
      bucket: '2/plan',
      agentType: 'task-runner',
      cursor: { last_message_id: null, last_usage: null },
    });
    assert.equal(old.hook_ms, 10);
    assert.equal(old.buckets['2/plan'].hook_ms, 10);
    assert.equal(old.buckets['2/plan'].first, '2026-10-21T10:00:00Z');
    assert.equal(old.buckets['2/plan'].last, '2026-10-21T10:00:30Z');
    assert.deepEqual(old.subagent_skills, { 'task-runner': { b: 1 } });
    assert.equal(summarize([old, { session_id: 'older', turns: 2 }]).turns, 3, 'a ledger lacking every new field still sums');
  });
});

// @traces 1361-FR-010
describe('telemetry — the ledgers of the whole machine, read from a worktree', () => {
  let world;
  beforeEach(() => {
    world = gitWorld();
    for (const name of ['speckit-plan', 'speckit-tasks', 'never-run']) mkdirSync(join(world.linked, '.claude/skills', name), { recursive: true });
    mkdirSync(join(world.linked, '.claude/agents'), { recursive: true });
    writeFileSync(join(world.linked, '.claude/agents/spec-reviewer.md'), '---\nname: spec-reviewer\n---\n');
    const record = emptyRecord('s-main');
    mergeTranscript(record, assistant([toolUse('Skill', { skill: 'speckit-plan' }), toolUse('Agent', { subagent_type: 'spec-reviewer' })], used(1, 1), undefined, 'a1'), {
      bucket: '2/plan',
      agentType: 'task-runner',
      cursor: { last_message_id: null, last_usage: null },
    });
    mergeTranscript(record, assistant([toolUse('Skill', { skill: 'speckit-tasks' })], used(1, 1), undefined, 'm1'), { bucket: '2/tasks' });
    mkdirSync(join(world.main, '.specify/telemetry'), { recursive: true });
    writeFileSync(join(world.main, '.specify/telemetry/s-main.json'), JSON.stringify(record));
  });
  afterEach(() => rmSync(world.scratch, { recursive: true, force: true }));

  it('loadRecords reads the main checkout\'s ledgers from a worktree', () => {
    assert.deepEqual(loadRecords(world.linked).map((r) => r.session_id), ['s-main']);
  });

  it('counts a skill and an agent only a subagent invoked as used', () => {
    const gaps = unused(world.linked);
    assert.deepEqual(gaps.skills, ['never-run']);
    assert.deepEqual(gaps.agents, []);
  });

  it('--unused run from a worktree lists only what nobody ran', () => {
    const run = spawnSync(process.execPath, [new URL('./telemetry.mjs', import.meta.url).pathname, '--unused'], {
      cwd: world.linked,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: world.linked },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /skills never invoked \(1\): never-run/);
    assert.doesNotMatch(run.stdout, /speckit-plan|speckit-tasks/);
  });
});

// @traces 1361-FR-013
describe('telemetry — a feature\'s phases', () => {
  const ledger = (feature, buckets, subagent_skills = {}) => ({ session_id: `s-${Math.random()}`, feature, buckets, subagent_skills, tokens: tokens(0, 0) });
  const span = (first, last, hook_ms) => ({ tokens: tokens(1, 1), subagent_tokens: tokens(0, 0), first, last, ...(hook_ms === undefined ? {} : { hook_ms }) });

  it('lists each phase once across sessions and levels, in order, with its minutes and the skills each subagent ran', () => {
    const report = phases(
      [
        ledger('777-x', { '2/plan': span('2026-10-21T10:00:00Z', '2026-10-21T10:20:00Z', 60000) }, { 'task-runner': { 'speckit-plan': 1 } }),
        ledger('777-x', { '2/specify': span('2026-10-21T09:00:00Z', '2026-10-21T09:30:00Z'), '3/plan': span('2026-10-21T10:10:00Z', '2026-10-21T10:45:00Z', 30000) }, { 'task-runner': { 'speckit-plan': 1, 'speckit-tasks': 2 }, 'spec-reviewer': {} }),
        ledger('888-other', { '2/plan': span('2026-10-20T10:00:00Z', '2026-10-20T18:00:00Z') }, { 'task-runner': { 'speckit-archive': 1 } }),
      ],
      '777-x',
    );
    assert.deepEqual(report.phases, [
      { phase: 'specify', first: '2026-10-21T09:00:00Z', last: '2026-10-21T09:30:00Z', minutes: 30, hook_ms: 0 },
      { phase: 'plan', first: '2026-10-21T10:00:00Z', last: '2026-10-21T10:45:00Z', minutes: 45, hook_ms: 90000 },
    ]);
    assert.deepEqual(report.subagent_skills, { 'task-runner': { 'speckit-plan': 2, 'speckit-tasks': 2 }, 'spec-reviewer': {} });
  });

  it('shows a phase from a ledger written before bucket times with no minutes', () => {
    const report = phases([{ session_id: 'old', feature: '777-x', buckets: { '2/plan': { tokens: tokens(1, 1), subagent_tokens: tokens(0, 0) } } }], '777-x');
    assert.deepEqual(report.phases, [{ phase: 'plan', first: null, last: null, minutes: null, hook_ms: 0 }]);
    assert.deepEqual(report.subagent_skills, {});
  });

  it('--phases prints the table and exits 0, with or without ledgers', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'telemetry-phases-'));
    try {
      const cli = () =>
        spawnSync(process.execPath, [new URL('./telemetry.mjs', import.meta.url).pathname, '--phases', '777-x'], {
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_PROJECT_DIR: scratch },
        });
      assert.equal(cli().status, 0);
      mkdirSync(join(scratch, '.specify/telemetry'), { recursive: true });
      writeFileSync(
        join(scratch, '.specify/telemetry/s1.json'),
        JSON.stringify(ledger('777-x', { '2/plan': span('2026-10-21T10:00:00Z', '2026-10-21T10:20:00Z') }, { 'task-runner': { 'speckit-plan': 1 } })),
      );
      const run = cli();
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /plan/);
      assert.match(run.stdout, /20/);
      assert.match(run.stdout, /task-runner: speckit-plan/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
