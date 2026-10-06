import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyRecord, mergeTranscript, tokenTotal } from './lib/telemetry.mjs';
import { byLevel, loadRecords } from './telemetry.mjs';

const HOOK = new URL('../hooks/session-telemetry.mjs', import.meta.url).pathname;
const REPORT = new URL('./telemetry.mjs', import.meta.url).pathname;

const assistant = (usage, id, blocks = []) =>
  `${JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T10:00:00Z', message: { ...(id ? { id } : {}), usage, content: blocks } })}\n`;
const used = (input, output, cache_read = 0, cache_creation = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cache_read,
  cache_creation_input_tokens: cache_creation,
});
const tokens = (input, output, cache_read = 0, cache_creation = 0) => ({ input, output, cache_read, cache_creation });
const sum = (list) => list.reduce((a, t) => a + tokenTotal(t), 0);

describe('tokenTotal', () => {
  it('is zero for nothing, an empty object and null', () => {
    assert.equal(tokenTotal(undefined), 0);
    assert.equal(tokenTotal(null), 0);
    assert.equal(tokenTotal({}), 0);
  });

  it('adds all four fields', () => {
    assert.equal(tokenTotal(tokens(1, 2, 4, 8)), 15);
  });
});

describe('folding subagent usage', () => {
  const fold = (text, agentType, bucket = '1/implement', record = emptyRecord('s')) => {
    mergeTranscript(record, text, { bucket, agentType, cursor: { last_message_id: null, last_usage: null } });
    return record;
  };

  it('counts the same message id in two different subagent transcripts once each', () => {
    const record = emptyRecord('s');
    fold(assistant(used(2, 3), 'dup'), 'code-reviewer', '1/implement', record);
    fold(assistant(used(2, 3), 'dup'), 'spec-reviewer', '1/implement', record);
    assert.deepEqual(record.tokens, tokens(4, 6));
    assert.deepEqual(record.subagent_tokens, { 'code-reviewer': tokens(2, 3), 'spec-reviewer': tokens(2, 3) });
  });

  it('adds two transcripts of the same agent type into one entry', () => {
    const record = emptyRecord('s');
    fold(assistant(used(1, 1), 'a'), 'code-reviewer', '1/implement', record);
    fold(assistant(used(5, 5), 'b'), 'code-reviewer', '1/implement', record);
    assert.deepEqual(record.subagent_tokens['code-reviewer'], tokens(6, 6));
  });

  it('counts a streamed subagent message once across two reads with one cursor', () => {
    const record = emptyRecord('s');
    const cursor = { last_message_id: null, last_usage: null };
    mergeTranscript(record, assistant(used(1, 5), 'm'), { bucket: '1/x', agentType: 'a', cursor });
    mergeTranscript(record, assistant(used(1, 40), 'm') + assistant(used(1, 40), 'm'), { bucket: '1/x', agentType: 'a', cursor });
    assert.deepEqual(record.tokens, tokens(1, 40));
  });

  it('ignores lines without usage and junk lines', () => {
    const record = fold(`garbage\n${JSON.stringify({ type: 'assistant', message: { id: 'z', content: [] } })}\n{"type":"user"}\n${assistant(used(3, 3), 'ok')}`, 'a');
    assert.deepEqual(record.tokens, tokens(3, 3));
  });

  it('keeps the session total equal to the sum of the buckets across mixed session and subagent folds', () => {
    const record = emptyRecord('s');
    mergeTranscript(record, assistant(used(10, 1, 5, 2), 'm1'), { bucket: '1/specify' });
    fold(assistant(used(3, 3, 1, 1), 's1'), 'x', '1/specify', record);
    mergeTranscript(record, assistant(used(7, 7), 'm2'), { bucket: '2/plan' });
    fold(assistant(used(2, 2), 's2'), 'y', '2/plan', record);
    assert.equal(tokenTotal(record.tokens), sum(Object.values(record.buckets).map((b) => b.tokens)));
    assert.equal(sum(Object.values(record.subagent_tokens)), sum(Object.values(record.buckets).map((b) => b.subagent_tokens)));
  });
});

describe('the Stop hook with levels and subagents', () => {
  let repo;
  let projects;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'adv-tel-'));
    projects = mkdtempSync(join(tmpdir(), 'adv-tel-proj-'));
    mkdirSync(join(repo, 'specs/042-small'), { recursive: true });
    writeFileSync(join(repo, 'specs/042-small/spec.md'), '# Spec\n');
    mkdirSync(join(repo, '.specify'), { recursive: true });
    writeFileSync(join(repo, '.specify/feature.json'), JSON.stringify({ feature_directory: 'specs/042-small', level: 1, level_for: 'specs/042-small' }));
    writeFileSync(join(repo, '.specify/run-state.json'), JSON.stringify({ status: 'in-progress', phase: 'implement' }));
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(projects, { recursive: true, force: true });
  });

  const transcript = () => join(projects, 'sess-1.jsonl');
  const subdir = () => {
    const dir = join(projects, 'sess-1', 'subagents');
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const run = () =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: 'sess-1', transcript_path: transcript() }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, SPECKIT_FEATURE_LEVEL: '' },
    });
  const ledger = () => JSON.parse(readFileSync(join(repo, '.specify/telemetry/sess-1.json'), 'utf8'));

  it('is idempotent: a second Stop with nothing new changes no total', () => {
    writeFileSync(transcript(), assistant(used(10, 1), 'm1'));
    writeFileSync(join(subdir(), 'agent-a.jsonl'), assistant(used(2, 2), 's1'));
    run();
    const first = ledger();
    run();
    run();
    const again = ledger();
    assert.deepEqual(again.tokens, first.tokens);
    assert.deepEqual(again.buckets, first.buckets);
    assert.deepEqual(again.subagent_tokens, first.subagent_tokens);
  });

  it('counts a subagent message streamed across two Stops once', () => {
    writeFileSync(transcript(), '');
    const file = join(subdir(), 'agent-a.jsonl');
    writeFileSync(file, assistant(used(1, 5), 's1'));
    run();
    writeFileSync(file, readFileSync(file, 'utf8') + assistant(used(1, 50), 's1'));
    run();
    assert.deepEqual(ledger().tokens, tokens(1, 50));
  });

  it('counts a new message that follows on the next Stop', () => {
    writeFileSync(transcript(), '');
    const file = join(subdir(), 'agent-a.jsonl');
    writeFileSync(file, assistant(used(1, 5), 's1'));
    run();
    writeFileSync(file, readFileSync(file, 'utf8') + assistant(used(2, 2), 's2'));
    run();
    assert.deepEqual(ledger().tokens, tokens(3, 7));
  });

  it('counts the same message id in two subagent files once each', () => {
    writeFileSync(transcript(), '');
    writeFileSync(join(subdir(), 'agent-a.jsonl'), assistant(used(4, 4), 'same'));
    writeFileSync(join(subdir(), 'agent-b.jsonl'), assistant(used(4, 4), 'same'));
    run();
    assert.deepEqual(ledger().tokens, tokens(8, 8));
  });

  it('reads a missing meta file as agent type unknown and a corrupt one the same', () => {
    writeFileSync(transcript(), '');
    writeFileSync(join(subdir(), 'agent-a.jsonl'), assistant(used(1, 1), 's'));
    writeFileSync(join(subdir(), 'agent-b.jsonl'), assistant(used(2, 2), 's'));
    writeFileSync(join(subdir(), 'agent-b.meta.json'), '{not json');
    writeFileSync(join(subdir(), 'agent-c.jsonl'), assistant(used(4, 4), 's'));
    writeFileSync(join(subdir(), 'agent-c.meta.json'), JSON.stringify({ other: 1 }));
    assert.equal(run().status, 0);
    assert.deepEqual(ledger().subagent_tokens, { unknown: tokens(7, 7) });
  });

  it('exits 0 and records the session alone when there is no subagents folder', () => {
    writeFileSync(transcript(), assistant(used(3, 3), 'm'));
    assert.equal(run().status, 0);
    assert.deepEqual(ledger().tokens, tokens(3, 3));
    assert.deepEqual(ledger().subagent_tokens ?? {}, {});
  });

  it('exits 0 with an empty subagent file and a binary one', () => {
    writeFileSync(transcript(), assistant(used(3, 3), 'm'));
    writeFileSync(join(subdir(), 'agent-a.jsonl'), '');
    writeFileSync(join(subdir(), 'agent-b.jsonl'), Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x0a, 0x00, 0xc3, 0x28, 0x0a]));
    assert.equal(run().status, 0);
    assert.deepEqual(ledger().tokens, tokens(3, 3));
  });

  it('reads a UTF-16 subagent file without throwing and without counting it', () => {
    writeFileSync(transcript(), '');
    writeFileSync(join(subdir(), 'agent-a.jsonl'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(assistant(used(9, 9), 'u'), 'utf16le')]));
    assert.equal(run().status, 0);
    assert.deepEqual(ledger().tokens, tokens(0, 0));
  });

  it('survives a subagents path that is a file, not a folder', () => {
    writeFileSync(transcript(), assistant(used(1, 1), 'm'));
    mkdirSync(join(projects, 'sess-1'), { recursive: true });
    writeFileSync(join(projects, 'sess-1', 'subagents'), 'oops');
    assert.equal(run().status, 0);
    assert.deepEqual(ledger().tokens, tokens(1, 1));
  });

  it('survives a corrupt pending.json and a pending.json with no marks', () => {
    writeFileSync(transcript(), assistant(used(1, 1), 'm'));
    mkdirSync(join(repo, '.specify/telemetry'), { recursive: true });
    writeFileSync(join(repo, '.specify/telemetry/pending.json'), '{broken');
    assert.equal(run().status, 0);
    writeFileSync(join(repo, '.specify/telemetry/pending.json'), '{}');
    assert.equal(run().status, 0);
  });

  it('does not duplicate a too-heavy mark on a second Stop', () => {
    writeFileSync(transcript(), '');
    mkdirSync(join(repo, '.specify/telemetry'), { recursive: true });
    const mark = { feature: 'specs/042-small', level: 2, file: 'a.ts', at: 't' };
    writeFileSync(join(repo, '.specify/telemetry/pending.json'), JSON.stringify({ too_heavy: [mark] }));
    run();
    run();
    assert.deepEqual(ledger().too_heavy, [mark]);
  });

  it('records the phase as none when there is no run state', () => {
    rmSync(join(repo, '.specify/run-state.json'));
    writeFileSync(transcript(), assistant(used(6, 6), 'm'));
    run();
    const r = ledger();
    assert.equal(r.phase, 'none');
    assert.deepEqual(r.buckets['1/none'].tokens, tokens(6, 6));
  });

  it('records the phase as none when the run state is corrupt', () => {
    writeFileSync(join(repo, '.specify/run-state.json'), '{nope');
    writeFileSync(transcript(), assistant(used(6, 6), 'm'));
    assert.equal(run().status, 0);
    assert.deepEqual(ledger().buckets['1/none'].tokens, tokens(6, 6));
  });

  it('buckets by the new phase after the run state moves on', () => {
    writeFileSync(transcript(), assistant(used(1, 1), 'm1'));
    run();
    writeFileSync(join(repo, '.specify/run-state.json'), JSON.stringify({ status: 'in-progress', phase: 'review' }));
    writeFileSync(transcript(), readFileSync(transcript(), 'utf8') + assistant(used(2, 2), 'm2'));
    run();
    const r = ledger();
    assert.deepEqual(r.buckets['1/implement'].tokens, tokens(1, 1));
    assert.deepEqual(r.buckets['1/review'].tokens, tokens(2, 2));
  });

  it('keeps the session total equal to the buckets after several Stops with a promotion', () => {
    writeFileSync(transcript(), assistant(used(10, 1, 3, 4), 'm1'));
    writeFileSync(join(subdir(), 'agent-a.jsonl'), assistant(used(2, 2, 1, 1), 's1'));
    run();
    writeFileSync(join(repo, '.specify/feature.json'), JSON.stringify({ feature_directory: 'specs/042-small', level: 2, level_for: 'specs/042-small' }));
    writeFileSync(transcript(), readFileSync(transcript(), 'utf8') + assistant(used(5, 5), 'm2'));
    writeFileSync(join(subdir(), 'agent-a.jsonl'), readFileSync(join(subdir(), 'agent-a.jsonl'), 'utf8') + assistant(used(7, 7), 's2'));
    run();
    const r = ledger();
    assert.equal(tokenTotal(r.tokens), sum(Object.values(r.buckets).map((b) => b.tokens)));
    assert.equal(sum(Object.values(r.subagent_tokens)), sum(Object.values(r.buckets).map((b) => b.subagent_tokens)));
    assert.equal(tokenTotal(r.tokens), 10 + 1 + 3 + 4 + 2 + 2 + 1 + 1 + 5 + 5 + 7 + 7);
  });

  it('writes no subagent prompt, message text or file path into the ledger', () => {
    writeFileSync(transcript(), '');
    const secret = { type: 'assistant', message: { id: 's', usage: used(1, 1), content: [{ type: 'text', text: 'TOPSECRET' }, { type: 'tool_use', name: 'Read', input: { file_path: '/etc/TOPSECRET' } }] } };
    writeFileSync(join(subdir(), 'agent-a.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'TOPSECRET brief' } })}\n${JSON.stringify(secret)}\n`);
    writeFileSync(join(subdir(), 'agent-a.meta.json'), JSON.stringify({ agentType: 'code-reviewer', description: 'TOPSECRET' }));
    run();
    assert.doesNotMatch(readFileSync(join(repo, '.specify/telemetry/sess-1.json'), 'utf8'), /TOPSECRET/);
  });
});

const ledgerFile = (repo, name, record) => {
  mkdirSync(join(repo, '.specify/telemetry'), { recursive: true });
  writeFileSync(join(repo, '.specify/telemetry', `${name}.json`), typeof record === 'string' ? record : JSON.stringify(record));
};
const bucket = (t, s = tokens(0, 0)) => ({ tokens: t, subagent_tokens: s });

describe('the by-level report', () => {
  it('returns a report for no ledgers at all', () => {
    const report = byLevel([]);
    assert.deepEqual(report.too_heavy ?? [], []);
    assert.deepEqual(Object.keys(report.levels ?? {}), []);
  });

  it('makes the levels add up to the sum of the ledger totals', () => {
    const records = [
      { feature: 'a', level: 1, tokens: tokens(30, 10), buckets: { '1/x': bucket(tokens(30, 10)) } },
      { feature: 'b', level: 2, tokens: tokens(5, 5, 5, 5), buckets: { '2/y': bucket(tokens(5, 5, 5, 5), tokens(1, 1)) } },
      { feature: 'c', tokens: tokens(9, 1) },
    ];
    const report = byLevel(records);
    assert.equal(Object.values(report.levels).reduce((a, l) => a + l.total, 0), 40 + 20 + 10);
  });

  it('counts the tokens of a ledger with no buckets under unknown level even when it names a feature', () => {
    const report = byLevel([{ feature: 'old-feature', tokens: tokens(8, 2) }]);
    assert.equal(report.levels.unknown.total, 10);
  });

  it('keeps unknown-level tokens apart from level 1 when ledgers are mixed', () => {
    const report = byLevel([
      { feature: 'a', level: 1, tokens: tokens(10, 0), buckets: { '1/x': bucket(tokens(10, 0)) } },
      { feature: 'b', tokens: tokens(99, 0) },
    ]);
    assert.equal(report.levels['1'].total, 10);
    assert.equal(report.levels.unknown.total, 99);
  });

  it('sums a feature across several sessions', () => {
    const report = byLevel([
      { feature: 'a', level: 1, tokens: tokens(10, 0), buckets: { '1/x': bucket(tokens(10, 0)) } },
      { feature: 'a', level: 1, tokens: tokens(20, 0), buckets: { '1/x': bucket(tokens(20, 0)) } },
    ]);
    assert.equal(report.features.a.total, 30);
    assert.equal(report.levels['1'].phases.x.total, 30);
  });

  it('lists a too-heavy mark from every ledger that holds one', () => {
    const m1 = { feature: 'a', level: 2, file: 'x', at: 't' };
    const m2 = { feature: 'b', level: 2, file: 'y', at: 't' };
    const report = byLevel([{ tokens: tokens(0, 0), too_heavy: [m1] }, { tokens: tokens(0, 0), too_heavy: [m2] }]);
    assert.deepEqual(report.too_heavy, [m1, m2]);
  });

  it('does not throw for a ledger with null buckets, null tokens or an unparseable bucket key', () => {
    assert.doesNotThrow(() => byLevel([{ tokens: null, buckets: null }, { tokens: tokens(1, 1), buckets: { weird: bucket(tokens(1, 1)) } }, {}]));
  });
});

describe('telemetry --by-level on the command line', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'adv-report-'));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));
  const report = (...args) => spawnSync(process.execPath, [REPORT, '--by-level', ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });

  it('exits 0 with no telemetry directory and with an empty one', () => {
    assert.equal(report().status, 0);
    mkdirSync(join(repo, '.specify/telemetry'), { recursive: true });
    assert.equal(report().status, 0);
  });

  it('prints unknown level for ledgers from before levels and exits 0', () => {
    ledgerFile(repo, 's1', { session_id: 's1', feature: 'old', tokens: tokens(5, 5), turns: 1 });
    const run = report();
    assert.equal(run.status, 0);
    assert.match(run.stdout, /unknown level/i);
    assert.match(run.stdout, /10/);
  });

  it('prints each level, its phases, each feature with its total and the too-heavy feature', () => {
    ledgerFile(repo, 's1', {
      session_id: 's1',
      feature: 'specs/001-a',
      level: 1,
      tokens: tokens(100, 0),
      buckets: { '1/specify': bucket(tokens(40, 0)), '1/implement': bucket(tokens(60, 0), tokens(25, 0)) },
      too_heavy: [{ feature: 'specs/001-a', level: 1, file: 'only/file.ts', at: 't' }],
    });
    ledgerFile(repo, 's2', { session_id: 's2', feature: 'specs/002-b', level: 2, tokens: tokens(7, 0), buckets: { '2/plan': bucket(tokens(7, 0)) } });
    const out = report().stdout;
    for (const needle of ['specify', 'implement', 'plan', 'specs/001-a', 'specs/002-b', 'only/file.ts']) assert.ok(out.includes(needle), `${needle} in\n${out}`);
    assert.match(out, /too heavy/i);
    assert.match(out, /\b100\b/);
    assert.match(out, /\b25\b/);
  });

  it('exits 0 when one ledger file is corrupt and still reports the others', () => {
    ledgerFile(repo, 'bad', '{nope');
    ledgerFile(repo, 'good', { session_id: 'g', feature: 'f', level: 1, tokens: tokens(11, 0), buckets: { '1/x': bucket(tokens(11, 0)) } });
    const run = report();
    assert.equal(run.status, 0);
    assert.match(run.stdout, /\b11\b/);
  });

  it('does not treat pending.json as a ledger', () => {
    ledgerFile(repo, 'pending', { too_heavy: [{ feature: 'f', level: 2, file: 'x', at: 't' }] });
    assert.equal(loadRecords(repo).length, 0);
    assert.equal(report().status, 0);
  });

  it('leaves the ledgers untouched', () => {
    ledgerFile(repo, 's1', { session_id: 's1', tokens: tokens(5, 5) });
    const before = readFileSync(join(repo, '.specify/telemetry/s1.json'), 'utf8');
    report();
    assert.equal(readFileSync(join(repo, '.specify/telemetry/s1.json'), 'utf8'), before);
    assert.equal(existsSync(join(repo, '.specify/telemetry/pending.json')), false);
  });
});
