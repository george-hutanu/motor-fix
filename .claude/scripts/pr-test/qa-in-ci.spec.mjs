import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The PR tester's boot, sweep, flows, API calls and tests run on GitHub Actions
// (pr-qa.yml); the agent dispatches the run, reads the artifact and does the
// LLM half (the review) locally. Booting on the laptop is the --local fallback.
const read = (rel) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');
const agent = read('.claude/agents/pr-tester.md');
const skill = read('.claude/skills/speckit-pr-test/SKILL.md');
const agents = read('AGENTS.md');
const watchSkill = read('.claude/skills/speckit-watch/SKILL.md');

/** `## ` sections of a Markdown file: [{ heading, body }]. */
const sections = (md) =>
  md
    .split(/^## /m)
    .slice(1)
    .map((s) => ({ heading: s.split('\n')[0], body: s }));
const frontmatter = (md) => md.split('---')[1];
const RUN = 'node .claude/scripts/pr-test/run.mjs';
const DISPATCH = 'node .claude/scripts/pr-test/dispatch.mjs';

describe('pr-tester agent dispatches the run to GitHub Actions', () => {
  it('says so in its description, which is what the caller reads', () => {
    assert.match(frontmatter(agent), /GitHub Actions/);
    assert.doesNotMatch(frontmatter(agent), /boots the change in its own worktree/);
  });

  it('runs dispatch.mjs, which dispatches pr-qa.yml, waits with gh run watch and downloads the artifact', () => {
    assert.ok(agent.includes(DISPATCH));
    const dispatch = read('.claude/scripts/pr-test/dispatch.mjs');
    assert.match(dispatch, /"workflow", "run", WORKFLOW/);
    assert.match(dispatch, /"run", "watch"/);
    assert.match(dispatch, /"run", "download"/);
  });

  it('boots locally only in the --local fallback, behind the heavy lock', () => {
    const local = sections(agent).filter((s) => s.body.includes(RUN));
    assert.ok(local.length > 0, 'the --local fallback is documented');
    for (const s of local) assert.match(s.heading, /--local/, `run.mjs appears outside the --local section: "${s.heading}"`);
    assert.match(local.map((s) => s.body).join('\n'), /heavy/);
    assert.ok(agent.indexOf(DISPATCH) < agent.indexOf(RUN), 'dispatch comes first');
  });

  it('still reviews the diff against the spec and the constitution, and posts with post.mjs', () => {
    assert.match(agent, /spec\.md/);
    assert.match(agent, /constitution/);
    assert.ok(agent.includes('node .claude/scripts/pr-test/post.mjs'));
  });
});

describe('speckit-pr-test skill', () => {
  it('takes --local and no longer needs Docker or local PostgreSQL to run', () => {
    assert.match(frontmatter(skill), /argument-hint: "[^"]*--local/);
    const compatibility = frontmatter(skill).split('\n').find((l) => l.startsWith('compatibility:'));
    assert.match(compatibility, /GitHub Actions/);
    // Docker or local servers are named only as what --local needs.
    assert.ok(compatibility.indexOf('--local') !== -1 && compatibility.indexOf('--local') < compatibility.indexOf('Docker'));
  });

  it('runs the tester on GitHub Actions by default and boots locally only with --local', () => {
    assert.match(skill, /pr-qa\.yml/);
    assert.match(skill, /`--local`[^\n]*heavy|heavy[^\n]*`--local`/);
    assert.doesNotMatch(skill, /runs `\.claude\/scripts\/pr-test\/run\.mjs` \(one heavy slot/);
  });

  it('keeps the screenshots out of git', () => {
    assert.match(skill, /Never commit the screenshots/);
  });
});

describe('AGENTS.md and the watcher', () => {
  it('drops the laptop limit on QA runs', () => {
    assert.doesNotMatch(agents, /At most four PRs in QA at once/);
    assert.doesNotMatch(agents, /Up to 4 QA runs/);
    assert.doesNotMatch(watchSkill, /4 QA/);
  });

  it('keeps the four sizes, both schemes and both languages, now swept in CI', () => {
    const screens = sections(agents).find((s) => s.heading.startsWith('Reviewing a change that has screens'));
    assert.ok(screens);
    for (const word of ['320 px', '390 px', 'tablet', 'desktop', 'light', 'dark', 'Romanian', 'English', 'pr-qa.yml']) assert.ok(screens.body.includes(word), word);
  });

  it('makes walking the screens in the built-in browser optional: the artifact screenshots are the evidence', () => {
    const screens = sections(agents).find((s) => s.heading.startsWith('Reviewing a change that has screens'));
    assert.match(screens.body, /built-in browser[^.]*optional|optional[^.]*built-in browser/i);
    assert.match(screens.body, /artifact/);
  });
});
