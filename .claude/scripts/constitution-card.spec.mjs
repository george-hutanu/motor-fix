import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Authors read the card, not the 26 KB constitution; reviewers read the full
// file. The card is only safe while it names the same principles and version.

const memory = join(import.meta.dirname, '..', '..', '.specify', 'memory');
const CARD = join(memory, 'constitution-card.md');
const MAX_BYTES = 3000;

const principlesOf = (text, pattern) => [...text.matchAll(pattern)].map((m) => `${m[1]}. ${m[2].trim()}`);
const versionOf = (text, pattern) => text.match(pattern)?.[1];

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
    const [, minor] = full.match(/^\*\*Version\*\*: 1\.(\d+)\.\d+/m);
    assert.ok(Number(minor) >= 9);
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
});
