import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('the skills name one lifecycle.mjs call per step', () => {
  const auto = read('.claude/skills/speckit-auto/SKILL.md');
  const commit = read('.claude/skills/speckit-git-commit/SKILL.md');

  it('speckit-git-commit opens the PR with lifecycle.mjs open, not the recipe', () => {
    assert.match(commit, /node \.claude\/scripts\/lifecycle\.mjs open --title/);
    assert.doesNotMatch(commit, /gh pr create --draft/);
    assert.doesNotMatch(commit, /git commit --allow-empty/);
  });

  it('speckit-auto takes the PR to ready with lifecycle.mjs ready, not the recipe', () => {
    assert.match(auto, /node \.claude\/scripts\/lifecycle\.mjs ready --body-file/);
    assert.doesNotMatch(auto, /gh pr edit <branch> --body-file/);
    assert.doesNotMatch(auto, /gh pr ready <branch>/);
  });

  it('speckit-auto merges and finishes with lifecycle.mjs merge, not the recipe', () => {
    assert.match(auto, /node \.claude\/scripts\/lifecycle\.mjs merge/);
    assert.doesNotMatch(auto, /git checkout -- specs\/<feature>\/notion-sync\.md/);
  });
});
