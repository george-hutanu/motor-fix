import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The watch is kept by one background wait that polls the gate outside the
// model, not by a cron prompt that wakes the model every 15 minutes.

const root = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\s+/g, ' ');
const skill = read('.claude/skills/speckit-watch/SKILL.md');
const scheduling = skill.slice(skill.indexOf('## Keeping it scheduled'), skill.indexOf('## Limits'));
const bullet = read('AGENTS.md').match(/ - Parallel work is watched:.*?(?= - Every API route)/)[0];

describe('the watch schedule', () => {
  it('arms one background wait within the background limit, never a cron prompt', () => {
    assert.match(scheduling, /node \.claude\/scripts\/watch\.mjs --wait/);
    assert.match(scheduling, /run_in_background: true/);
    assert.match(scheduling, /timeout: 7200000/);
    assert.match(scheduling, /never a second/);
    assert.doesNotMatch(skill, /CronCreate/);
    assert.doesNotMatch(skill, /\* \* \* \*/);
  });

  it('says what each ending of the wait means, by its printed line', () => {
    assert.match(scheduling, /exit 2[^\n]*full pass[\s\S]*re-arm/i);
    assert.match(scheduling, /; re-arm the wait`/);
    assert.match(scheduling, /`already armed`/);
    assert.match(scheduling, /exit 1/i);
  });

  it('deletes an old /speckit-watch cron job once the wait is armed', () => {
    assert.match(scheduling, /CronDelete/);
  });

  it('is armed from the main checkout once two worktrees are active, never from a worktree session', () => {
    assert.match(scheduling, /two or more tasks or worktrees/);
    assert.match(scheduling, /worktree never arms/);
  });

  it('still runs a pass with --fix and ends an empty one in one line', () => {
    assert.match(skill, /watch\.mjs --fix --json/);
    assert.match(skill, /`watch: N worktrees, none stale`/);
  });

  it('is described the same way in AGENTS.md', () => {
    assert.match(bullet, /watch\.mjs --wait/);
    assert.match(bullet, /--gate/);
    assert.doesNotMatch(bullet, /CronList|\* \* \* \*/);
    assert.match(bullet, /session:start:watch-reminder/);
  });
});
