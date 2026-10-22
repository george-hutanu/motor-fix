import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble, auditLine } from './session-context.mjs';

const HOOK = new URL('./session-context.mjs', import.meta.url).pathname;
const SETTINGS = new URL('../settings.json', import.meta.url).pathname;
const AUDIT = /^context-audit: .*; run node \.claude\/scripts\/context-audit\.mjs$/;

let repo;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'session-adv-'));
  mkdirSync(join(repo, '.specify/contexts'), { recursive: true });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const baseline = (lines) => writeFileSync(join(repo, '.specify/context-baseline.json'), JSON.stringify({ lines }));
const rules = (n) => Array.from({ length: n }, (_, i) => `rule ${i} that changes behaviour`).join('\n') + '\n';
const hook = (env = {}) => spawnSync(process.execPath, [HOOK], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env } });

describe('auditLine: the size boundary', () => {
  // @traces 1360-FR-007
  it('is silent at exactly the baseline and names +1 one line past it', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), rules(5));
    baseline(5);
    assert.equal(auditLine(repo), '');
    baseline(4);
    assert.match(auditLine(repo), /^context-audit: CLAUDE\.local\.md grew from 4 to 5 non-empty lines \(\+1\); run node/);
  });

  // @traces 1360-FR-007
  it('is silent when the file shrank below its baseline', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), rules(2));
    baseline(50);
    assert.equal(auditLine(repo), '');
  });

  // @traces 1360-FR-007
  it('is silent for an empty context file and a zero baseline', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), '');
    baseline(0);
    assert.equal(auditLine(repo), '');
  });

  // @traces 1360-FR-007
  it('counts only non-empty lines, so blank padding is not growth', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), rules(3).split('\n').join('\n\n\n\n'));
    baseline(3);
    assert.equal(auditLine(repo), '');
  });

  // @traces 1360-FR-007
  it('stays one line when a huge file grew by thousands of lines', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), rules(100_000));
    baseline(1);
    const out = auditLine(repo);
    assert.match(out, AUDIT);
    assert.doesNotMatch(out, /\n/);
    assert.match(out, /grew from 1 to 100000 non-empty lines \(\+99999\)/);
  });
});

describe('auditLine: unreadable inputs stay silent and never throw', () => {
  const baselines = [['a string', '"abc"'], ['null', 'null'], ['an array', '[]'], ['a negative count', '{"lines":-5}'], ['a text count', '{"lines":"many"}'], ['an empty file', '']];
  for (const [name, raw] of baselines) {
    // @traces 1360-FR-007
    it(`returns a string for a baseline that is ${name}`, () => {
      writeFileSync(join(repo, 'CLAUDE.local.md'), 'one stable rule\n');
      writeFileSync(join(repo, '.specify/context-baseline.json'), raw);
      const out = auditLine(repo);
      assert.equal(typeof out, 'string');
      assert.ok(out === '' || AUDIT.test(out), out);
    });
  }

  // @traces 1360-FR-007
  it('returns nothing for a repo root that does not exist', () => {
    assert.equal(auditLine(join(repo, 'missing')), '');
  });

  // @traces 1360-FR-007
  it('returns nothing when the context file is a directory', () => {
    mkdirSync(join(repo, 'CLAUDE.local.md'));
    baseline(1);
    assert.equal(auditLine(repo), '');
  });

  // @traces 1360-FR-007
  it('returns one line or nothing for a Latin-1 context file', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), Buffer.concat([Buffer.from('r\xe9gle un\n', 'latin1'), Buffer.from(rules(3))]));
    baseline(1);
    const out = auditLine(repo);
    assert.match(out, AUDIT);
  });

  // @traces 1360-FR-007
  it('returns one line or nothing for a UTF-16 file with a byte order mark', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rules(3), 'utf16le')]));
    baseline(1);
    const out = auditLine(repo);
    assert.ok(out === '' || AUDIT.test(out), out);
  });

  // @traces 1360-FR-007
  it('survives a binary context file', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), Buffer.alloc(2_000_000, 0));
    baseline(1);
    const out = auditLine(repo);
    assert.ok(out === '' || AUDIT.test(out), out);
  });

  // @traces 1360-FR-007
  it('reads a context file that is a symlink to a file outside the repo without throwing', () => {
    const outside = mkdtempSync(join(tmpdir(), 'session-outside-'));
    try {
      writeFileSync(join(outside, 'real.md'), rules(4));
      symlinkSync(join(outside, 'real.md'), join(repo, 'CLAUDE.local.md'));
      baseline(1);
      assert.equal(typeof auditLine(repo), 'string');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('the hook with a broken audit', () => {
  // @traces 1360-FR-007
  it('still prints the mode and the gate list when the baseline is not JSON', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), rules(3));
    writeFileSync(join(repo, '.specify/context-baseline.json'), '{not json');
    const r = hook();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /mode: planning/);
    assert.doesNotMatch(r.stdout, /context-audit:/);
  });

  // @traces 1360-FR-007
  it('still prints the mode when the context file is a directory', () => {
    mkdirSync(join(repo, 'CLAUDE.local.md'));
    baseline(1);
    const r = hook();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /mode: planning/);
  });

  // @traces 1360-FR-007
  it('prints the audit line once, before the mode guidance, however small the budget', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), rules(6));
    baseline(1);
    const out = hook({ SPECKIT_CONTEXT_MAX_CHARS: '1' }).stdout;
    assert.equal(out.split('\n').filter((l) => l.startsWith('context-audit:')).length, 1);
  });

  // @traces 1360-FR-007
  it('prints no audit line when the context is switched off', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), rules(6));
    baseline(1);
    assert.equal(hook({ SPECKIT_CONTEXT_OFF: '1' }).stdout, '');
  });
});

describe('instincts leave the session start', () => {
  // @traces 1360-FR-009
  it('ignores instincts handed to assemble', () => {
    const out = assemble({ head: 'HEAD', mode: 'MODE', tail: 'TAIL', max: 1000, instincts: 'INSTINCT-TEXT' });
    assert.deepEqual(out.split('\n\n'), ['HEAD', 'MODE', 'TAIL']);
  });

  // @traces 1360-FR-009
  it('injects nothing from a malformed instincts folder and still starts', () => {
    mkdirSync(join(repo, '.specify/memory/instincts'), { recursive: true });
    writeFileSync(join(repo, '.specify/memory/instincts/bad.md'), '---\nconfidence: 0.99\n');
    writeFileSync(join(repo, '.specify/memory/instincts/high.md'), '---\nid: h\ntrigger: when high\nconfidence: 1\nstatus: active\n---\nact on HIGHMARK\n');
    const r = hook();
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /HIGHMARK|when high|nstinct/);
  });

  // @traces 1360-FR-009
  it('imports nothing from instincts.mjs', () => {
    assert.doesNotMatch(readFileSync(HOOK, 'utf8'), /^\s*import\b[^\n]*instincts/m);
  });

  // @traces 1360-FR-009
  it('settings.json grants no instincts.mjs command and no context-audit --jev', () => {
    const text = readFileSync(SETTINGS, 'utf8');
    assert.doesNotMatch(text, /instincts\.mjs/);
    assert.doesNotMatch(text, /context-audit\.mjs --jev/);
  });
});
