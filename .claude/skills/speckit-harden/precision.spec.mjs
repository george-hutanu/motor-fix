import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The prose half of red-first and harden precision: the skills, agents, the
// CI step and the eval cases that the scripts' own specs cannot see.

const REPO = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

describe('red-first: the eval cases and the build phase say the same as the hook', () => {
  // @traces 1359-FR-002
  it('pins a red-first spec to exit 0 with the note and an existing failing spec to exit 2', () => {
    const cases = JSON.parse(read('.claude/evals/cases/post-edit-check.json'));
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    const note = byId['leaves-a-red-first-spec-unrun'];
    const real = byId['runs-an-existing-spec-that-fails'];
    assert.equal(note.expect.exit, 0);
    assert.match(note.expect.stdout, /red-first/);
    assert.equal(real.expect.exit, 2);
    assert.equal(note.env.SPECKIT_BASE_REF, 'HEAD~1');
  });

  // @traces 1359-FR-003
  it('tells phase 9 that a failure dump means the imports resolve', () => {
    const text = read('.claude/skills/speckit-auto/phases-build.md');
    assert.match(text, /answers a red-first spec[\s\S]*?with a note/);
    assert.match(text, /failure\s+dump instead means the spec's imports resolve/);
    assert.doesNotMatch(text, /Expect `post-edit-check\.sh` to report failures/);
  });
});

describe('harden precision: the adversary skips only covered cases and runs as a delta', () => {
  // @traces 1359-FR-006
  it('gives the adversary one skip rule and a Covered already report line', () => {
    const text = read('.claude/agents/test-adversary.md');
    assert.match(text, /\*\*One skip rule\.\*\* Skip a case only when a colocated spec already asserts\s+the same concrete input and the same concrete outcome/);
    assert.match(text, /No other reason skips a case\./);
    assert.match(text, /^Covered already: <file>:<line> — <case>/m);
    const skipBullet = text.match(/^- \*\*One skip rule\.\*\*[\s\S]*?(?=^- )/m)[0];
    assert.doesNotMatch(skipBullet, /src\//);
    assert.match(text, /^- \*\*`\*\.spec\.ts` only\.\*\*[^]*?You never touch `src\/` bodies[^]*?^- \*\*One skip rule/m);
  });

  // @traces 1359-FR-007
  it('names adversary files by subject and lists the ones on the branch before a harden run', () => {
    assert.match(read('.claude/skills/speckit-tests/SKILL.md'), /`<subject>\.adversary\.spec\.ts`/);
    const harden = read('.claude/skills/speckit-harden/SKILL.md');
    assert.ok(harden.includes("git diff --name-only --diff-filter=A <merge-base> -- '*.adversary.spec.*'"));
    assert.match(harden, /An empty list means a full run/);
    assert.doesNotMatch(harden, /parameter-property DI/);
  });
});

describe('harden reads the adversary result instead of dispatching it', () => {
  // @traces 1363-FR-006
  it('has step 2 read the adversary result of the review dispatch, with no test-adversary call of its own', () => {
    const harden = read('.claude/skills/speckit-harden/SKILL.md');
    const step2 = harden.slice(harden.indexOf('### 2. Adversarial tests'), harden.indexOf('### 3.')).replace(/\s+/g, ' ');
    assert.match(step2, /reads the adversary's result/);
    assert.doesNotMatch(step2, /subagent_type: test-adversary/);
    assert.doesNotMatch(step2, /Invoke the `test-adversary` subagent/);
    assert.match(step2, /levels 2–3/);
  });
});

describe('harness catch rate: CI, templates and the reviewer say what the gates do', () => {
  // @traces 1359-FR-009
  it('runs doctor and the eval cases in the Harness step after the existing commands', () => {
    const ci = read('.github/workflows/ci.yml');
    const step = ci.slice(ci.indexOf('- name: Harness'), ci.indexOf('- name: Compose stack'));
    const order = ['npm run test:harness', 'npm run test:mods', 'node .claude/scripts/doctor.mjs --check', 'node .claude/scripts/harness-eval.mjs --check'].map((c) => step.indexOf(c));
    assert.ok(order.every((i) => i > 0), 'every command is in the step');
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  // @traces 1359-FR-012
  it('has /speckit-tasks require tests per story', () => {
    const text = read('.claude/skills/speckit-tasks/SKILL.md');
    assert.doesNotMatch(text, /if requested|Tests are OPTIONAL|If tests requested/);
    assert.match(text, /\*\*Tests are REQUIRED\*\*/);
  });

  // @traces 1359-FR-013
  it('says the code reviewer runs in the review, not in harden', () => {
    const line3 = read('.claude/agents/code-reviewer.md').split('\n')[2];
    assert.match(line3, /Invoked by \/speckit-review and by \/speckit-auto's review phase/);
    assert.doesNotMatch(line3, /Invoked by \/speckit-harden/);
  });
});

// Tests are required here (Constitution II), so the tasks template /speckit-tasks
// fills must not call them optional. The override sits where the template
// resolver looks first.
describe('the tasks template override', () => {
  const file = join(REPO, '.specify/templates/overrides/tasks-template.md');

  // @traces 1359-FR-011
  it('exists, never calls tests optional, and gives every story a required tests block', () => {
    assert.ok(existsSync(file), 'override missing');
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /OPTIONAL/);
    const stories = text.match(/^## Phase \d+: User Story \d+/gm) ?? [];
    const blocks = text.match(/^### Tests for User Story \d+ \(REQUIRED/gm) ?? [];
    assert.ok(stories.length >= 3);
    assert.equal(blocks.length, stories.length);
  });
  // @traces 1359-FR-011
  it('fills into a tasks.md that artifact-lint --check finds no defect in (SC-005)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tasks-template-'));
    const feature = join(dir, 'specs', '020-a-feature');
    mkdirSync(join(dir, '.specify'), { recursive: true });
    mkdirSync(feature, { recursive: true });
    writeFileSync(join(dir, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/020-a-feature', level: 2 }));
    writeFileSync(
      join(feature, 'spec.md'),
      ['## Requirements', '', '- **FR-001**: One.', '- **FR-002**: Two.', '- **FR-003**: Three.', ''].join('\n'),
    );
    writeFileSync(join(feature, 'plan.md'), '# Plan\n');
    let n = 0;
    const tasks = readFileSync(file, 'utf8').replace(/^(- \[ \] T\d{3} \[P\] \[US(\d)\] Contract test for) \[endpoint\]/gm, (_, head, story) => {
      n += 1;
      return `${head} FR-00${story}`;
    });
    assert.equal(n, 3, 'one contract test task per story');
    writeFileSync(join(feature, 'tasks.md'), tasks);
    const result = spawnSync(process.execPath, [join(REPO, '.claude/scripts/artifact-lint.mjs'), '--check'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, SPECKIT_JEV: '0' },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /ERROR|WARN/);
  });
});
