import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The hand-off and the finish log are prose in skills. These checks keep it
// wired: a story's agent ends at ready with a note and `NEXT: tail`, a fresh
// tail agent takes the PR from there, and a feature's records ride in its own
// PR, with what follows the merge in a comment on it, never a docs PR.

const root = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const section = (text, heading) => {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `no "${heading}" section`);
  // hand-off.md and tail.md are read as one text: tail.md's `# ` title ends the hand-off as a `## ` would.
  const next = text.slice(start + heading.length).search(/\n##? /);
  return text.slice(start, next === -1 ? undefined : start + heading.length + next);
};

// speckit-auto keeps the hand-off and the tail beside SKILL.md, read when the run reaches them.
const auto = ['hand-off.md', 'tail.md'].map((f) => read(`.claude/skills/speckit-auto/${f}`)).join('\n');

// @traces 317-FR-004
describe('section()', () => {
  it('ends at the next level-1 heading, so tail.md\'s title and intro never join the hand-off', () => {
    const joined = ['## Hand-off', 'lifecycle.mjs ready --body-file', '# speckit-auto: the wait and the tail', 'gh pr merge', '## The wait', 'waits'].join('\n');
    const handoff = section(joined, '## Hand-off');
    assert.doesNotMatch(handoff, /gh pr merge/);
    assert.match(handoff, /lifecycle\.mjs ready/);
  });

  it('still ends at the next level-2 heading and keeps its level-3 ones', () => {
    const text = ['## The tail', '### What the tail needs', 'repair', '## Next', 'other'].join('\n');
    assert.equal(section(text, '## The tail'), '## The tail\n### What the tail needs\nrepair');
  });
});

// @traces 317-FR-006
describe('the repair count rides the note', () => {
  it('shows the note\'s Repair iterations line and says handoff rewrites it from run state', () => {
    const handoff = section(auto, '## Hand-off');
    assert.match(handoff, /- Repair iterations: <n>/);
    assert.match(handoff, /`handoff --pr <n>` rewrites it from run state/);
  });

  it('says the tail\'s restore puts the count back into run state from every page of comments', () => {
    const tail = section(auto, '## The tail');
    assert.match(tail, /every page of the PR's comments/);
    assert.match(tail, /raises run\s+state's `repair_iterations` to the note's count/);
  });
});

describe('the hand-off', () => {

  it('ends the story agent at ready with a hand-off note and NEXT: tail', () => {
    const handoff = section(auto, '## Hand-off');
    assert.match(handoff, /lifecycle\.mjs ready --body-file/);
    assert.match(handoff, /tracker's\s+`qa`/);
    assert.match(handoff, /handoff\.md/);
    assert.match(handoff, /NEXT: tail #<n>/);
    // Run in the owner's session, nobody reads that NEXT: the run sends its own tail.
    assert.match(handoff, /dispatch the tail yourself/);
    assert.doesNotMatch(handoff, /gh pr merge|lifecycle\.mjs merge/);
  });

  it('gives the tail lifecycle steps 5-7, on the default model', () => {
    const tail = section(auto, '## The tail');
    for (const step of [/run_in_background/, /\/speckit-pr-test <n>/, /run-state\.mjs repair/, /lifecycle\.mjs merge --pr <n>/, /tracker's `finish`/, /worktree-remove\.mjs/])
      assert.match(tail, step);
    assert.match(tail, /stays on Opus/);
    assert.doesNotMatch(tail, /model: "sonnet"/);
  });

  it('is dispatched by the watcher as its tail fix', () => {
    const watch = read('.claude/skills/speckit-watch/SKILL.md');
    assert.match(watch, /\| `tail` \|/);
    assert.match(watch, /`tail`, `rerun-qa` and\s+`fix-ci` write or judge code and keep the default model/);
  });

  it('is stated in AGENTS.md, and the note never reaches git', () => {
    const agents = read('AGENTS.md');
    assert.match(agents, /tail agent/);
    assert.match(agents, /NEXT: tail #<n>/);
    // specs is a link into .motor-fix-specs (a folder in CI), which git will not look past:
    // the public repo ignores specs whole, and the clone's own .gitignore the note.
    execFileSync('git', ['check-ignore', '--no-index', '-q', 'specs'], { cwd: root });
    const clone = join(root, '.motor-fix-specs');
    if (existsSync(join(clone, '.git'))) execFileSync('git', ['check-ignore', '--no-index', '-q', 'specs/901-x/handoff.md'], { cwd: clone });
  });
});

// the feature folder lives in the private motor-fix-specs repo, so each
// record is pushed there through specs-repo.mjs instead of riding on the branch.
describe('the feature records go to the specs repo', () => {
  const viaSpecsRepo = /specs-repo\.mjs commit/;

  it('pushes the log through the specs repo and comments it on the PR after the merge', () => {
    const step = section(read('.claude/skills/speckit-tracker-sync/SKILL.md'), '## 5. Record it');
    assert.match(step, viaSpecsRepo);
    assert.match(step, /gh pr comment/);
    assert.match(step, /After the merge/);
  });

  // @traces 1324-FR-009
  it('archives before ready and finishes after the merge, with no ready check', () => {
    const phase = section(read('.claude/skills/speckit-archive/SKILL.md'), '## Phase 4');
    assert.match(phase, /before the feature's PR goes ready/);
    assert.match(phase, viaSpecsRepo);
    assert.match(phase, /speckit-tracker-sync finish/);
    assert.doesNotMatch(phase, /tracker\/ready\.mjs/);
  });

  it('commits a retrospective and every QA lap report to the specs repo, never the branch', () => {
    assert.match(read('.claude/skills/speckit-retro/SKILL.md'), viaSpecsRepo);
    const evidence = section(read('.claude/skills/speckit-pr-test/SKILL.md'), '## Evidence');
    assert.match(evidence, viaSpecsRepo);
    assert.match(evidence, /no new head/);
  });
});

describe('no agent holds its context across the CI and QA wait', () => {
  const steps = (text) => text.split(/\n(?=\d+\. )/);

  it('starts the QA run at hand-off without waiting, records it in the note and ends', () => {
    const handoff = section(auto, '## Hand-off');
    assert.match(handoff, /dispatch\.mjs <n> --no-wait/);
    assert.match(handoff, /- QA run: <id> · head <sha> · lap <n> · <url>/);
    assert.match(handoff, /NEXT: tail #<n> after QA run <id>/);
    assert.match(handoff, /\.specify\/\.cache\/qa-flows-<n>\.mjs/);
    assert.doesNotMatch(handoff, /--watch|gh run watch/);
  });

  // @traces 1363-FR-003
  it('has the session dispatch the tail at once, and the tail hold its own background wait', () => {
    const wait = section(auto, '## The wait');
    assert.match(wait, /run_in_background/);
    // gh pr checks --watch ends at once on a head whose checks have not started.
    assert.match(wait, /ci-wait\.mjs <n> --run <id>/);
    assert.doesNotMatch(wait, /gh pr checks <n> --watch/);
    assert.match(wait, /watch\.mjs claim <worktree> tail/);
    assert.match(wait, /The tail holds its own waits; the session holds none\./);
    assert.match(wait, /dispatches the tail \(below\) at once/);
  });

  // @traces 1171-FR-001 1171-FR-002 1363-FR-003
  it('waits for the QA run only before the review, and for CI only before the merge', () => {
    const wait = section(auto, '## The wait');
    assert.match(wait, /QA run only/);
    assert.match(wait, /ci-wait\.mjs <n>(?! --run)/);
    assert.match(wait, /watch\.mjs claim <worktree> merge/);
    assert.doesNotMatch(wait, /The session then holds the CI wait/);
  });

  // @traces 1171-FR-002 1363-FR-003
  it('reviews the run while a check is pending, and holds the CI wait itself after a passing lap', () => {
    const read = steps(section(auto, '## The tail')).find((s) => s.includes('Read CI'));
    assert.match(read, /pending/);
    assert.match(read, /does not hold the review/);
    assert.doesNotMatch(section(auto, '## The tail'), /the session's CI wait/);
    assert.match(read, /ci-wait\.mjs <n>/);
  });

  // @traces 1171-FR-006
  it('merges origin/main with the merge helper, never a bare git merge', () => {
    const tail = section(auto, '## The tail');
    assert.match(tail, /merge-main\.mjs/);
    assert.doesNotMatch(tail, /git merge --no-edit origin\/main/);
  });

  it('runs the tester on the finished run, and ends a fix lap with a new run instead of waiting', () => {
    const tail = section(auto, '## The tail');
    assert.match(tail, /RUN/);
    assert.match(tail, /--no-wait/);
    assert.match(tail, /run-state\.mjs repair/);
    assert.match(tail, /NEXT: tail #<n> after QA run <id>/);
    assert.match(tail, /--missing/);
    // The only wait a tail holds is CI on a docs-only head, which runs two short jobs.
    for (const step of steps(tail).filter((s) => /--watch|gh run watch/.test(s))) assert.match(step, /docs-only/);
  });
});

// @traces 749-FR-002 749-FR-003
describe('the hand-off survives a cloud session resumed on a fresh VM', () => {
  it('posts the note as a marked PR comment whenever its QA run line is written', () => {
    assert.match(section(auto, '## Hand-off'), /lifecycle\.mjs handoff --pr <n>/);
    assert.match(section(auto, '## Hand-off'), /<!-- speckit-handoff -->/);
    const tail = section(auto, '## The tail');
    assert.match(tail, /lifecycle\.mjs handoff --pr <n>/);
  });

  it('has the tail and the watcher\'s tail fix restore a missing note before reading it', () => {
    assert.match(section(auto, '## The tail'), /lifecycle\.mjs handoff --restore --pr <n>/);
    assert.match(read('.claude/skills/speckit-watch/SKILL.md'), /lifecycle\.mjs handoff --restore --pr <n>/);
  });
});

// @traces 749-FR-005
describe('the cloud how-to (moved from AGENTS.md to speckit-auto/cloud.md) says how to run in a cloud session', () => {
  const cloudSection = () => section(read('.claude/skills/speckit-auto/cloud.md'), '## Cloud sessions');

  it('names the setup script, the environment and the network it needs', () => {
    const cloud = cloudSection();
    for (const fact of [/scripts\/cloud-setup\.sh/, /CLAUDE_CODE_REMOTE/, /\bJEV\b/, /\.env\.example/, /api\.typesafe\.ai/, /proxy-injected/])
      assert.match(cloud, fact);
  });

  it('keeps a cloud session to one repo and one story, never arming the watcher', () => {
    const cloud = cloudSection();
    assert.match(cloud, /single-repo/i);
    assert.match(cloud, /one story/i);
    assert.match(cloud, /watch\.mjs/);
  });

  it('names the fallbacks', () => {
    const cloud = cloudSection();
    assert.match(cloud, /Workflow/);
    assert.match(cloud, /Artifact/);
    assert.match(read('.claude/skills/speckit-review/SKILL.md'), /Workflow tool is not available/);
  });
});

// The tail owns both waits; the session that received the hand-off waits for and relays nothing.
describe('the tail, not the session, waits for CI and the QA run', () => {
  const flat = (text) => text.replace(/\s+/g, ' ');

  // @traces 1363-FR-003
  it('says so in tail.md, hand-off.md, lifecycle.md, task-runner.md and AGENTS.md', () => {
    for (const rel of ['.claude/skills/speckit-auto/tail.md', '.claude/skills/speckit-auto/hand-off.md', '.claude/skills/speckit-auto/lifecycle.md', '.claude/agents/task-runner.md', 'AGENTS.md'])
      assert.match(flat(read(rel)), /waits for nothing and relays nothing/, rel);
  });

  // @traces 1363-FR-003
  it('has the tail run ci-wait.mjs itself, and the hand-off keep its NEXT and drop the session wait', () => {
    const tail = flat(read('.claude/skills/speckit-auto/tail.md'));
    assert.match(tail, /ci-wait\.mjs <n> --run <id>/);
    assert.match(tail, /ci-wait\.mjs <n>(?! --run)/);
    const handoff = flat(section(auto, '## Hand-off'));
    assert.match(handoff, /NEXT: tail #<n> after QA run <id>/);
    assert.doesNotMatch(handoff, /hold the wait/);
    const runner = flat(read('.claude/agents/task-runner.md'));
    assert.match(runner, /ci-wait\.mjs <n> --run <id>/);
    assert.match(runner, /run_in_background/);
  });

  // @traces 1363-FR-003
  it('drops the session wait from lifecycle.md and AGENTS.md step 4', () => {
    const lifecycle = flat(read('.claude/skills/speckit-auto/lifecycle.md'));
    assert.doesNotMatch(lifecycle, /session holds one background wait/);
    assert.doesNotMatch(lifecycle, /the session waits for CI/);
    const ci = flat(section(read('.claude/skills/speckit-auto/lifecycle.md'), '## CI, tests and release'));
    assert.match(ci, /ci-wait\.mjs <n> --run <id>/);
    const agents = flat(read('AGENTS.md'));
    assert.doesNotMatch(agents, /The session waits for that run in the background/);
    assert.match(agents, /dispatches a fresh \*\*tail agent\*\* at once/);
  });
});

describe('the hand-off brings main in first, only when needed', () => {
  const flat = (text) => text.replace(/\s+/g, ' ');

  // @traces 1363-FR-009
  it('runs merge-main.mjs --needed before ready and the QA dispatch', () => {
    const handoff = flat(section(auto, '## Hand-off'));
    const needed = handoff.indexOf('merge-main.mjs --needed');
    assert.notEqual(needed, -1);
    assert.ok(needed < handoff.indexOf('lifecycle.mjs ready --body-file'), 'before ready');
    assert.ok(needed < handoff.indexOf('dispatch.mjs <n> --no-wait'), 'before the QA dispatch');
    assert.match(handoff, /never a rebase/);
    assert.match(handoff, /green CI/);
  });

  // @traces 1363-FR-009
  it('has lifecycle step 5 say it also runs at hand-off', () => {
    const lifecycle = read('.claude/skills/speckit-auto/lifecycle.md');
    const five = flat(lifecycle.slice(lifecycle.indexOf('  5. Get CI green'), lifecycle.indexOf('  6. QA')));
    assert.match(five, /also at hand-off/);
  });
});

describe('a merge of main touching none of the PR\'s files keeps the verdict', () => {
  const flat = (text) => text.replace(/\s+/g, ' ');

  // @traces 1363-FR-010
  it('has tail step 1 carry the verdict over a disjoint merge of main', () => {
    const one = flat(section(auto, '## The tail').split(/\n(?=\d+\. )/).find((s) => s.startsWith('1. ')));
    assert.match(one, /node \.claude\/scripts\/pr-test\/carry\.mjs <n>/);
    assert.match(one, /merge of main/);
  });

  // @traces 1363-FR-010
  it('states the carry in AGENTS.md step 6 and constitution VII step 6', () => {
    const agents = read('AGENTS.md');
    const six = flat(agents.slice(agents.indexOf('  6. QA'), agents.indexOf('  7. Merge')));
    assert.match(six, /merge of `origin\/main`/);
    assert.match(six, /carry/);
    const constitution = read('.specify/memory/constitution.md');
    const start = constitution.indexOf('### VII.');
    const vii = constitution.slice(start, constitution.indexOf('\n## ', start));
    const step6 = flat(vii.slice(vii.indexOf('\n6. '), vii.indexOf('\n\nThe tracker is GitHub')));
    assert.match(step6, /merge of `origin\/main`/);
    assert.match(step6, /merge of main/);
  });
});

describe('the flows proof is optional and local boots use the worktree\'s ports', () => {
  const flat = (text) => text.replace(/\s+/g, ' ');
  const numbered = (text, n) => flat(text.split(/\n(?=\s*\d+\. )/).find((s) => s.trimStart().startsWith(`${n}. `)) ?? '');

  // @traces 1363-FR-005
  it('makes the proof opt-in in hand-off step 1 and tail step 3, booting on the port set', () => {
    for (const text of [numbered(section(auto, '## Hand-off'), 1), numbered(section(auto, '## The tail'), 3)]) {
      assert.match(text, /`--proof` only when the story changed flows/);
      assert.match(text, /eval "\$\(node scripts\/test-services\.ts ports\)"/);
      assert.match(text, /node scripts\/test-services\.ts restart <api\|worker\|web>/);
      assert.doesNotMatch(text, /There is no flag that dispatches without the proof/);
    }
  });

  // @traces 1363-FR-005
  it('names WEB_PORT and API_PORT instead of fixed localhost ports', () => {
    for (const rel of ['.claude/skills/speckit-auto/hand-off.md', '.claude/skills/speckit-auto/tail.md', '.claude/skills/speckit-pr-test/SKILL.md', '.claude/agents/pr-tester.md']) {
      const text = read(rel);
      assert.doesNotMatch(text, /localhost:4200|localhost:3000/, rel);
    }
    for (const rel of ['.claude/skills/speckit-pr-test/SKILL.md', '.claude/agents/pr-tester.md']) {
      const text = read(rel);
      assert.match(text, /WEB_PORT/, rel);
      assert.match(text, /API_PORT/, rel);
    }
  });

  // @traces 1363-FR-007
  it('tells the test-adversary to append or add a file, never rewrite or delete a test', () => {
    const text = flat(read('.claude/agents/test-adversary.md'));
    assert.match(text, /append to an existing adversary spec or add a new file, never rewrite or delete a test/);
    assert.match(text, /pre:edit:adversary-keep/);
  });
});
