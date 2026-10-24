import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The repo carries no YAML parser, so the shape is read from the text, as
// pr-qa-workflow.spec.mjs does: one key per line, two-space indentation.
const file = fileURLToPath(new URL('../../../.github/workflows/dependabot-review.yml', import.meta.url));
const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
const code = text
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

describe('dependabot-review.yml: the workflow that writes a Dependabot PR\'s agent-review', () => {
  // @traces 961-FR-001
  // @traces 961-FR-003
  it('runs the base branch\'s copy on pull_request_target, or by hand for a PR number', () => {
    assert.match(code, /^on:\n {2}pull_request_target:\n {4}types: \[opened, synchronize, reopened\]\n {2}workflow_dispatch:\n {4}inputs:\n {6}pr:/m);
    assert.doesNotMatch(code, /^ {2}pull_request:/m);
  });

  // @traces 961-FR-001
  it('asks for no more than writing a status and reading the PR', () => {
    assert.match(code, /^permissions:\n {2}contents: read\n {2}pull-requests: read\n {2}statuses: write\n(?! )/m);
  });

  // @traces 961-FR-001
  it('runs the job only for a PR Dependabot opened, or a hand run', () => {
    assert.match(code, /if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
  });

  // @traces 961-FR-001
  it('never checks out or runs the PR\'s code: one sparse checkout of the base, no install', () => {
    assert.equal((code.match(/uses: actions\/checkout@/g) ?? []).length, 1);
    assert.match(code, /sparse-checkout: \.claude\/scripts\n/);
    assert.match(code, /persist-credentials: false/);
    assert.doesNotMatch(code, /ref:|head\.sha|head\.ref|github\.head_ref/);
    assert.doesNotMatch(code, /npm (ci|install)|npx /);
    assert.match(code, /run: node \.claude\/scripts\/pr-test\/dependabot-review\.mjs "\$PR"/);
  });
});
