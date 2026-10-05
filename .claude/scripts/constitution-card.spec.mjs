import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

  it('exists', () => assert.ok(existsSync(CARD), 'constitution-card.md is missing'));

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

  it('stays a card', () => {
    const bytes = Buffer.byteLength(readFileSync(CARD, 'utf8'));
    assert.ok(bytes <= MAX_BYTES, `${bytes} bytes, above ${MAX_BYTES}`);
  });
});
