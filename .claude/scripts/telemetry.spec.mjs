import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyRecord, mergeTranscript, ranked, summarize } from './lib/telemetry.mjs';
import { byLevel, loadRecords, unused } from './telemetry.mjs';

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
