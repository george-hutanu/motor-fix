import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// PR and check reads go over REST on the laptop as in the cloud, so
// the GraphQL quota is left to the Project writes. The docs agents read say so
// where they look: AGENTS.md's CI line and its cloud GitHub bullet, and the
// tracker-sync skill names `next` in place of `gh project item-list`.

const repo = join(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(join(repo, path), 'utf8').replace(/\s+/g, ' ');
const section = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

// @traces 1323-FR-007
describe('REST is the default for PR and check reads', () => {
  it('says so in the Agent replies CI line', () => {
    const ci = section(read('AGENTS.md'), '- CI: the background wait', '- Jest, Playwright');
    assert.match(ci, /reads over REST, as every PR and check read does on the laptop too/);
    assert.match(ci, /at most once a minute/);
  });

  it('says so in the cloud section, the laptop included', () => {
    const cloud = section(read('AGENTS.md'), '- **GitHub.** `GH_TOKEN`', '- **QA and merge.**');
    assert.match(cloud, /REST is the default for PR and check reads everywhere, the laptop included/);
    assert.doesNotMatch(cloud, /fall back to REST on their own/);
  });

  it('picks the next task by REST search, never by reading the whole Project', () => {
    const skill = read('.claude/skills/speckit-tracker-sync/SKILL.md');
    assert.match(skill, /tracker-sync\.mjs next \[--epic EP-<n>\]/);
    assert.match(skill, /never `gh project item-list`/);
  });
});
