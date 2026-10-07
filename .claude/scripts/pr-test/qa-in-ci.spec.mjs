import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The PR tester's boot, sweep, flows and API calls run on GitHub Actions
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

describe('the tester leaves the unit and end-to-end suites to CI', () => {
  it('neither the agent nor the skill says the run executes them', () => {
    for (const md of [agent, skill]) assert.doesNotMatch(md, /affected[\s\n]+tests|nx affected -t test|and the e2e suite|tests and e2e/);
  });
});

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

describe('the tester names the API health routes the API serves', () => {
  const scripts = readdirSync(fileURLToPath(new URL('.', import.meta.url))).filter((f) => f.endsWith('.mjs') && !f.endsWith('.spec.mjs'));
  const sources = [
    ['.claude/agents/pr-tester.md', agent],
    ['.claude/skills/speckit-pr-test/SKILL.md', skill],
    ['.github/workflows/pr-qa.yml', read('.github/workflows/pr-qa.yml')],
    ...scripts.map((f) => [f, read(`.claude/scripts/pr-test/${f}`)]),
  ];

  it('nowhere names a bare /health route, which the API does not serve', () => {
    for (const [name, text] of sources) assert.doesNotMatch(text, /(?<![\w/])\/health(?!\/(live|ready)\b)/, name);
  });

  it('tells the agent its flows get health() and ready() for /health/live and /health/ready', () => {
    const flows = sections(agent).find((s) => s.heading.includes('Write the flows'));
    assert.ok(flows);
    for (const word of ['health()', 'ready()', '/health/live', '/health/ready']) assert.ok(flows.body.includes(word), word);
  });

  it('run.mjs checks the routes from HEALTH and hands health and ready to the flows', () => {
    const run = read('.claude/scripts/pr-test/run.mjs');
    assert.ok(!run.includes('/health/'), 'run.mjs spells a health route instead of reading HEALTH');
    assert.match(run, /HEALTH\.live/);
    assert.match(run, /HEALTH\.ready/);
    assert.match(run, /flow\.default\(flowArgs\(\{/);
    assert.match(run, /export const flowArgs = [^;]*\.\.\.apiHealth\(apiURL\)/);
  });
});

describe('the tester reads a finished run instead of waiting on one', () => {
  it('pr-tester takes RUN, downloads it with --run and checks the flows that were sent', () => {
    assert.match(agent, /\bRUN\b/);
    assert.match(agent, /dispatch\.mjs <PR> --run <RUN>/);
    assert.match(agent, /flow not run/);
    assert.match(agent, /\.specify\/\.cache\/qa-flows-<PR>\.mjs/);
  });

  it('the skill dispatches with --no-wait and reviews with --run', () => {
    assert.match(skill, /--no-wait/);
    assert.match(skill, /--run <id>/);
  });

  it('the watcher waits on a handed-off PR until CI and its QA run have finished', () => {
    assert.match(watchSkill, /`waiting`/);
    assert.match(agents, /--no-wait/);
    assert.match(agents, /`waiting`/);
  });
});

describe('a cloud session tests and merges with no laptop', () => {
  const cloud = sections(agents).find((s) => s.heading === 'Cloud sessions')?.body ?? '';

  it('AGENTS.md says QA starts by itself on ready or a push and sets agent-review', () => {
    assert.match(cloud, /QA starts by itself/);
    assert.match(cloud, /pull_request/);
    assert.match(cloud, /`agent-review`/);
    assert.match(cloud, /dispatch\.mjs <n> --no-wait/);
  });

  it('AGENTS.md says the merge goes over REST, through the same gate', () => {
    assert.match(cloud, /gh api -X PUT repos\/\{owner\}\/\{repo\}\/pulls\/<n>\/merge -f merge_method=merge/);
    assert.match(cloud, /lifecycle\.mjs merge --pr <n>/);
    assert.match(cloud, /merge gate/);
  });

  it('the pr-tester agent knows the workflow, not post.mjs, sets the status in the cloud', () => {
    assert.match(agent, /CLAUDE_CODE_REMOTE=true[\s\S]{0,400}no `agent-review` status/);
  });

  it('the skill names the workflow as a writer of agent-review', () => {
    assert.match(skill, /Never set `agent-review` by hand; only the PR QA workflow/);
  });
});
