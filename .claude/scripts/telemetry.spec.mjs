import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyRecord, mergeTranscript, ranked, summarize } from './lib/telemetry.mjs';
import { loadRecords, unused } from './telemetry.mjs';

// The usage ledger. Two things matter beyond the counting: it must fold a
// transcript incrementally (a session's transcript is re-read every turn), and
// it must never record message content.

const HOOK = new URL('../hooks/session-telemetry.mjs', import.meta.url).pathname;

const assistant = (blocks, usage = {}, timestamp = '2026-09-12T10:00:00Z') =>
  `${JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { usage, content: blocks },
  })}\n`;
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
