import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('the skills name one lifecycle.mjs call per step', () => {
  const auto = ['hand-off.md', 'tail.md'].map((f) => read(`.claude/skills/speckit-auto/${f}`)).join('\n');
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
    assert.doesNotMatch(auto, /git checkout -- specs\/<feature>\/tracker-sync\.md/);
  });

  // @traces 1355-FR-001
  it('the commit protocol and the tail run lifecycle.mjs check before a push', () => {
    for (const f of ['commit-protocol.md', 'tail.md']) assert.match(read(`.claude/skills/speckit-auto/${f}`), /node \.claude\/scripts\/lifecycle\.mjs check/, f);
  });
});

// @traces 1363-throughput-fixes-FR-014
describe('the draft carries the claim label through tracker-sync pr', () => {
  const lifecycle = read('.claude/scripts/lifecycle.mjs');
  const sync = read('.claude/scripts/tracker-sync.mjs');

  it('lifecycle.mjs open runs tracker-sync pr right after opening the draft', () => {
    assert.match(lifecycle, /ctx\.track\(\[\["start", "--pr", String\(pr\)\], \["pr", String\(pr\)\]\], rerun\)/);
    assert.match(lifecycle, /const labels = \["planning", typeLabel\(title\), bang && "breaking", `scope: \$\{scope\}`\]/);
  });

  it('tracker-sync pr copies the claim label onto the PR', () => {
    assert.match(sync, /"--add-label", claim/);
  });
});
