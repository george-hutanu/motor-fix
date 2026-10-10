import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main, parseDeferred, taskFor } from './debt-tasks.mjs';

const STORY = 'https://github.com/george-hutanu/motor-fix-specs/issues/story1';
const EPIC = 'https://github.com/george-hutanu/motor-fix-specs/issues/epic1';
const PR = 'https://github.com/george-hutanu/motor-fix/pull/9';
const base = { story: STORY, pr: PR, storyId: 'ST-9' };
const entry = parseDeferred('- **medium** — `a.mjs:1` — a follow-up (code-reviewer)')[0];
const decision = parseDeferred('- Open question for the owner (spec-reviewer LOW): roles.')[0];

describe('a debt task for a story with no epic', () => {
  it('omits Epic for every falsy or blank epic value, never an empty relation', () => {
    for (const epic of [undefined, null, '', ' ', '\t\n', 0, false]) {
      const t = taskFor(entry, { ...base, epic });
      assert.equal('Epic' in t.properties, false, `epic ${JSON.stringify(epic)}`);
    }
  });

  it('never serialises a null or an empty list anywhere in the properties', () => {
    const t = taskFor(entry, { ...base, epic: undefined });
    assert.equal(JSON.stringify(t.properties).includes('[null]'), false);
    assert.equal(JSON.stringify(t.properties).includes('[]'), false);
  });

  it('keeps the Feature relation when there is a feature but no epic', () => {
    const t = taskFor(entry, { ...base, feature: 'https://github.com/george-hutanu/motor-fix-specs/issues/f1' });
    assert.deepEqual(JSON.parse(t.properties.Feature), ['https://github.com/george-hutanu/motor-fix-specs/issues/f1']);
    assert.equal('Epic' in t.properties, false);
  });

  it('files a Decision with no epic the same way', () => {
    const t = taskFor(decision, base);
    assert.equal(t.properties['Issue type'], 'Decision');
    assert.equal('Epic' in t.properties, false);
  });

  it('gives the same task as with an epic apart from the Epic property', () => {
    const withEpic = taskFor(entry, { ...base, epic: EPIC });
    const without = taskFor(entry, base);
    const { Epic, ...rest } = withEpic.properties;
    assert.deepEqual(JSON.parse(Epic), [EPIC]);
    assert.deepEqual(without.properties, rest);
    assert.equal(without.content, withEpic.content);
  });

  it('does not mutate the context it is given', () => {
    const ctx = Object.freeze({ ...base });
    assert.doesNotThrow(() => taskFor(entry, ctx));
  });
});

describe('plan on the command line without an epic', () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  const fileWith = (text) => {
    const dir = mkdtempSync(join(tmpdir(), 'debt-adv-'));
    dirs.push(dir);
    const file = join(dir, 'deferred.md');
    writeFileSync(file, text);
    return file;
  };
  const plan = (argv) => {
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((l) => out.push(l));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = main(argv);
    return { code, plan: out.length ? JSON.parse(out.at(-1)) : null };
  };

  it('prints an empty plan and exits 0 for a file with no bullets', () => {
    const r = plan(['plan', fileWith('# Deferred\n'), '--story', STORY, '--pr', PR, '--id', 'ST-9']);
    assert.equal(r.code, 0);
    assert.deepEqual(r.plan, []);
  });

  it('plans every pending bullet with no Epic and keeps already filed ones out', () => {
    const file = fileWith('- **low** — `a.mjs` — one (code-reviewer)\n- **low** — `b.mjs` — two (code-reviewer) — Issue: https://github.com/george-hutanu/motor-fix-specs/issues/x\n- **low** — `c.mjs` — three (code-reviewer)\n');
    const r = plan(['plan', file, '--story', STORY, '--pr', PR, '--id', 'ST-9']);
    assert.equal(r.code, 0);
    assert.equal(r.plan.length, 2);
    assert.ok(r.plan.every((t) => !('Epic' in t.properties)));
  });

  it('treats a trailing --epic with no value as no epic', () => {
    const file = fileWith('- **low** — `a.mjs` — one (code-reviewer)\n');
    const r = plan(['plan', file, '--story', STORY, '--pr', PR, '--id', 'ST-9', '--epic']);
    assert.equal(r.code, 0);
    assert.equal('Epic' in r.plan[0].properties, false);
  });

  it('does not take the next flag as the epic url', () => {
    const file = fileWith('- **low** — `a.mjs` — one (code-reviewer)\n');
    const r = plan(['plan', file, '--story', STORY, '--epic', '--pr', PR, '--id', 'ST-9']);
    assert.equal(r.code, 0);
    assert.equal(JSON.stringify(r.plan).includes('"--pr"'), false);
  });

  it('still sends the epic when it is given', () => {
    const file = fileWith('- **low** — `a.mjs` — one (code-reviewer)\n');
    const r = plan(['plan', file, '--story', STORY, '--epic', EPIC, '--pr', PR, '--id', 'ST-9']);
    assert.deepEqual(JSON.parse(r.plan[0].properties.Epic), [EPIC]);
  });

  it('refuses a missing --story, --pr or --id with the usage exit code, with or without an epic', () => {
    const file = fileWith('- **low** — `a.mjs` — one (code-reviewer)\n');
    const all = { story: STORY, pr: PR, id: 'ST-9' };
    for (const missing of Object.keys(all)) {
      for (const extra of [[], ['--epic', EPIC]]) {
        const argv = ['plan', file, ...Object.entries(all).filter(([k]) => k !== missing).flatMap(([k, v]) => [`--${k}`, v]), ...extra];
        assert.equal(plan(argv).code, 64, `without --${missing} ${extra.length ? 'with' : 'no'} epic`);
      }
    }
  });
});
