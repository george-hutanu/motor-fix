import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A passing lap with findings ends QA: the rule lives in the constitution and
// in the prose every lifecycle agent reads. These checks keep that prose saying
// the same thing, and keep a lap with a blocker or high finding failing.

const root = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\s+/g, ' ');
const constitution = read('.specify/memory/constitution.md');
const seven = constitution.slice(constitution.indexOf('### VII.'), constitution.indexOf('### ', constitution.indexOf('### VII.') + 8));
const card = read('.specify/memory/constitution-card.md');
const agents = read('AGENTS.md');
const tail = read('.claude/skills/speckit-auto/tail.md');
const prTest = read('.claude/skills/speckit-pr-test/SKILL.md');
const trackerSync = read('.claude/skills/speckit-tracker-sync/SKILL.md');

describe('the constitution ends QA on a lap with no blocker or high finding', () => {
  // @traces 1362-FR-009
  it('is at 5.0.0, a MAJOR amendment with its Sync Impact Report', () => {
    assert.match(constitution, /\*\*Version\*\*: 5\.0\.0 \|/);
    assert.match(constitution, /Sync Impact Report \(v5\.0\.0\) - Version change: 4\.1\.1 → 5\.0\.0 \(MAJOR/);
    assert.match(card, /^# Constitution card — v5\.0\.0/);
    assert.match(read('CLAUDE.local.md'), /Constitution v5\.0\.0/);
  });

  // @traces 1362-FR-009
  it('states the passing lap in Principle VII and in the merge gate\'s Enforcement row', () => {
    assert.match(seven, /lap with neither ends the testing/);
    assert.match(seven, /no repair lap is counted and no lap runs again/);
    assert.match(seven, /carried from <sha>: QA fixes/);
    assert.match(seven, /Fixed after QA/);
    const row = readFileSync(join(root, '.specify/memory/constitution.md'), 'utf8').split('\n').find((l) => l.startsWith('| VII QA before merge |'));
    assert.match(row, /QA fixes/);
  });

  // @traces 1362-FR-006 1362-FR-009
  it('keeps a lap with a blocker or high finding failing, counted toward the cap', () => {
    assert.match(seven, /lap with a blocker or high finding fails/);
    assert.match(seven, /SPECKIT_MAX_REPAIR_ITERATIONS/);
    assert.match(agents, /A blocker or high finding fails the lap/);
    assert.match(agents, /each such lap counts toward `SPECKIT_MAX_REPAIR_ITERATIONS`/);
  });

  // @traces 1362-FR-009
  it('says the same in AGENTS.md, tail.md, the PR tester and the tracker sync', () => {
    assert.match(agents, /A lap with neither ends the testing/);
    assert.match(agents, /no lap is counted/);
    assert.match(tail, /A passing lap with findings/);
    assert.match(tail, /## Fixed after QA/);
    assert.match(prTest, /## Fixed after QA/);
    assert.match(trackerSync, /`## Fixed after QA`/);
  });
  // @traces 1362-FR-001
  it('has the tail fix a passing lap\'s findings tests first, then carry it without a repair lap or a new run', () => {
    const passing = tail.slice(tail.indexOf('**A passing lap with findings**'), tail.indexOf('**A failing lap**'));
    assert.match(passing, /`No blocking findings; <N> in all`, N >= 1/);
    assert.match(passing, /Fix each medium and low finding, tests first/);
    assert.match(passing, /lifecycle\.mjs check/);
    assert.match(passing, /pr-test\/carry\.mjs <n>/);
    assert.match(passing, /No `run-state\.mjs repair`, no dispatch/);
    assert.match(passing, /NEXT: merge #<n> after CI/);
  });
  // @traces 1362-FR-009
  it('adds the passing lap to the card\'s VII line without rewording its other clauses', () => {
    const vii = card.slice(card.indexOf('**VII.'), card.indexOf('Gates:', card.indexOf('**VII.')));
    assert.match(vii, /draft PR linked on its GitHub issue in Project MotorFix;/);
    assert.match(vii, /no blocker or high ends QA, the rest fixed;/);
    assert.match(vii, /one stage label and the type label; the main checkout holds no edits to tracked files and is fast-forwarded after each merge\./);
  });
});
