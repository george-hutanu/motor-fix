import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Authors read the card, not the 26 KB constitution; reviewers read the card
// and only their principles' sections. The card is only safe while it names the
// same principles and version.

const memory = join(import.meta.dirname, '..', '..', '.specify', 'memory');
const CARD = join(memory, 'constitution-card.md');
const MAX_BYTES = 3000;

const principlesOf = (text, pattern) => [...text.matchAll(pattern)].map((m) => `${m[1]}. ${m[2].trim()}`);
const versionOf = (text, pattern) => text.match(pattern)?.[1];
/** The constitution is at `major.minor` or later. */
const atLeast = (text, major, minor) => {
  const [, a, b] = text.match(/^\*\*Version\*\*: (\d+)\.(\d+)\.\d+/m);
  return Number(a) > major || (Number(a) === major && Number(b) >= minor);
};

describe('the constitution card', () => {
  const full = readFileSync(join(memory, 'constitution.md'), 'utf8');

  it('names every principle of the constitution, in order', () => {
    const card = readFileSync(CARD, 'utf8');
    const expected = principlesOf(full, /^### ([IVX]+)\. (.+)$/gm);
    assert.ok(expected.length > 0, 'no principle headings in constitution.md');
    assert.deepEqual(principlesOf(card, /^- \*\*([IVX]+)\. ([^*]+)\*\*/gm), expected);
  });

  it('carries the constitution version', () => {
    const card = readFileSync(CARD, 'utf8');
    const version = versionOf(full, /^\*\*Version\*\*: (\d+\.\d+\.\d+)/m);
    assert.ok(version, 'no version line in constitution.md');
    assert.equal(versionOf(card, /\bv(\d+\.\d+\.\d+)\b/), version);
  });

  it('states the folder rules under principle IV, in the constitution and the card', () => {
    const card = readFileSync(CARD, 'utf8');
    const fourth = full.slice(full.indexOf('### IV.'), full.indexOf('### V.'));
    const cardLine = card.split('\n').find((line) => line.startsWith('- **IV.'));
    for (const text of [fourth, cardLine]) {
      assert.match(text, /subfolder/);
      assert.match(text, /<name>\.html/);
      assert.match(text, /structure-check/);
    }
    assert.ok(atLeast(full, 1, 9));
  });

  // @traces 1035-FR-009
  it('states the main checkout rule under principle VII, in the constitution and the card', () => {
    const card = readFileSync(CARD, 'utf8');
    const start = full.indexOf('### VII.');
    const seventh = full.slice(start, full.indexOf('\n## ', start));
    const cardLine = card.split('\n').find((line) => line.startsWith('- **VII.'));
    for (const text of [seventh, cardLine]) {
      assert.match(text, /main checkout/);
      assert.match(text, /main-checkout-gate|fast-forward/);
    }
    assert.match(cardLine, /main-checkout-gate\.mjs/);
    assert.match(full, /\| VII main checkout \|[^\n]*main-checkout-gate\.mjs/);
    assert.ok(atLeast(full, 1, 12));
  });

  // @traces 1036-FR-017
  it('tracks the task on its GitHub issue under principle VII, in the constitution and the card', () => {
    const card = readFileSync(CARD, 'utf8');
    const start = full.indexOf('### VII.');
    const seventh = full.slice(start, full.indexOf('\n## ', start));
    const cardLine = card.split('\n').find((line) => line.startsWith('- **VII.'));
    for (const text of [seventh, cardLine]) {
      assert.match(text, /GitHub issue|issue in the private/);
    }
    assert.match(seventh, /Project "MotorFix" \(#11\)/);
    assert.ok(atLeast(full, 2, 0));
  });

  // @traces 1324-FR-002
  it('retires the ready label under principle VII, at 4.0 or later, and CLAUDE.local.md names the same version', () => {
    const start = full.indexOf('### VII.');
    const seventh = full.slice(start, full.indexOf('\n## ', start));
    assert.doesNotMatch(seventh, /ready[ ]to[ ]work/i);
    assert.ok(atLeast(full, 4, 0));
    const local = readFileSync(join(memory, '..', '..', 'CLAUDE.local.md'), 'utf8');
    assert.equal(versionOf(local, /Constitution v(\d+\.\d+\.\d+)/), versionOf(full, /^\*\*Version\*\*: (\d+\.\d+\.\d+)/m));
  });

  // @traces 1344-FR-007
  it('keeps mutation out of every task under principle II, at 4.1 or later, in the constitution and the card', () => {
    const start = full.indexOf('### II.');
    const second = full.slice(start, full.indexOf('\n### ', start + 1)).replace(/\s+/g, ' ');
    assert.match(second, /Mutation testing is never part of a task's lifecycle/);
    assert.ok(atLeast(full, 4, 1));
    assert.match(readFileSync(CARD, 'utf8'), /\*\*II\. Test Discipline\*\*[^\n]*no mutation run in a task/);
  });

  // @traces 1363-FR-003
  it('has the tail own the wait under principle VII step 4, at 5.1 or later, in the constitution and the card', () => {
    const card = readFileSync(CARD, 'utf8');
    const start = full.indexOf('### VII.');
    const seventh = full.slice(start, full.indexOf('\n## ', start));
    const step4 = seventh.slice(seventh.indexOf('\n4. '), seventh.indexOf('\n5. ')).replace(/\s+/g, ' ');
    assert.match(step4, /the tail agent waits for CI and the QA run itself/);
    assert.match(step4, /one task being built per session/);
    const cardLine = card.split('\n').find((line) => line.startsWith('- **VII.'));
    assert.match(cardLine, /the tail waits for CI and QA itself/);
    assert.match(cardLine, /one task being built per session/);
    assert.ok(atLeast(full, 5, 1));
    assert.match(full, /^\*\*Version\*\*: 5\.1\.0 \| \*\*Ratified\*\*: 2026-10-03 \| \*\*Last Amended\*\*: 2026-10-23$/m);
  });

  // @traces 1363-FR-007 1363-FR-010
  it('lists the adversary-keep gate and the merge-of-main carry in the Enforcement table', () => {
    const table = full.slice(full.indexOf('## Enforcement'), full.indexOf('## Agent Execution Rules'));
    assert.match(table, /\| [^|\n]*\| `adversary-keep-gate\.mjs` \(PreToolUse, `pre:edit:adversary-keep`\) \|[^\n]*`\*\.adversary\.spec\.\*`/);
    assert.match(table, /\| VII QA before merge \|[^\n]*merge of `origin\/main`[^\n]*\(`merge of main`, `carry\.mjs`\)/);
  });

  it('names the spec that keeps it in step with the constitution', () => {
    assert.match(readFileSync(CARD, 'utf8').replace(/\s+/g, ' '), /`constitution-card\.spec\.mjs` checks it/);
  });

  it('stays a card', () => {
    const bytes = Buffer.byteLength(readFileSync(CARD, 'utf8'));
    assert.ok(bytes <= MAX_BYTES, `${bytes} bytes, above ${MAX_BYTES}`);
  });
});

describe('the author skills', () => {
  const skills = join(import.meta.dirname, '..', 'skills');
  const AUTHORS = ['specify', 'clarify', 'plan', 'checklist', 'tasks', 'analyze', 'implement', 'converge'];
  const FALLBACK =
    "Open a principle's section in `.specify/memory/constitution.md` only when a decision turns on its exact wording.";
  const allowed = (line) =>
    line.trim() === 'Full text: `.specify/memory/constitution.md`.' ||
    line.trimStart().startsWith('**Constitution Authority**') ||
    (line.includes(FALLBACK) &&
      line.includes('constitution-card.md') &&
      line.split('.specify/memory/constitution.md').length === 2);

  it.each(AUTHORS)('speckit-%s loads the card, not the full constitution', (name) => {
    const text = readFileSync(join(skills, `speckit-${name}`, 'SKILL.md'), 'utf8');
    assert.ok(text.includes('.specify/memory/constitution-card.md'), `speckit-${name} never names the card`);
    const loads = text
      .split('\n')
      .map((line, i) => ({ line, at: i + 1 }))
      .filter(({ line }) => line.includes('.specify/memory/constitution.md') && !allowed(line))
      .map(({ line, at }) => `speckit-${name}/SKILL.md:${at}: ${line.trim()}`);
    assert.deepEqual(loads, []);
  });

  // @traces 1175-FR-011
  it('names Valkey as the store in principles II, III, IV and VI, in the constitution and the card', () => {
    const card = readFileSync(CARD, 'utf8');
    const full = readFileSync(join(memory, 'constitution.md'), 'utf8');
    const section = (n, next) => full.slice(full.indexOf(`### ${n}.`), full.indexOf(`### ${next}.`));
    for (const text of [section('II', 'III'), section('III', 'IV'), section('IV', 'V'), section('VI', 'VII')]) {
      assert.match(text, /Valkey/);
    }
    for (const n of ['II', 'III', 'VI']) {
      assert.match(card.split('\n').find((line) => line.startsWith(`- **${n}.`)), /Valkey/);
    }
    assert.ok(atLeast(full, 3, 3));
  });
});

// @traces 1355-FR-009
describe('the agent definitions', () => {
  const agents = join(import.meta.dirname, '..', 'agents');
  // A line that names the full constitution must name the sections it reads.
  const sectioned = (line) => !line.includes('constitution.md') || /### (?:[IVX]+|<numeral>)\.|grep -n '\^##/.test(line);

  it('refuses a line that names the whole constitution', () => {
    assert.equal(sectioned('- `.specify/memory/constitution.md`, Principle I first'), false);
    assert.equal(sectioned('- the card, then `### I.` of `.specify/memory/constitution.md`'), true);
    assert.equal(sectioned("(`grep -n '^##' .specify/memory/constitution.md` for the lines)"), true);
  });

  it.each(readdirSync(agents).filter((name) => name.endsWith('.md')))('%s reads the constitution by section only', (name) => {
    const text = readFileSync(join(agents, name), 'utf8');
    const whole = text
      .split('\n')
      .map((line, i) => ({ line, at: i + 1 }))
      .filter(({ line }) => !sectioned(line))
      .map(({ line, at }) => `${name}:${at}: ${line.trim()}`);
    assert.deepEqual(whole, []);
  });

  it.each(['spec-reviewer', 'code-reviewer', 'pr-tester', 'spec-challenger'])('%s reads the card', (name) => {
    assert.match(readFileSync(join(agents, `${name}.md`), 'utf8'), /\.specify\/memory\/constitution-card\.md/);
  });
});
