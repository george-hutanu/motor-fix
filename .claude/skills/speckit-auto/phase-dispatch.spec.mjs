import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A skill's `model:` pin is not applied when the skill runs inside a story
// agent's own turn: the API keeps serving the agent's model. So /speckit-auto
// dispatches each phase whose pin differs from Opus as its own agent with
// `model` set, and this spec keeps each dispatch line equal to the pin.

const skillsDir = join(import.meta.dirname, '..');
const auto = readFileSync(join(import.meta.dirname, 'SKILL.md'), 'utf8');
// Phase 0 and the run order stay in SKILL.md; phases 1-17 sit in the phase files beside it.
const phases = ['phases-plan.md', 'phases-build.md', 'phases-close.md']
  .map((f) => readFileSync(join(import.meta.dirname, f), 'utf8'))
  .join('\n');

const pinOf = (skill) => {
  const text = readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf8');
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  return frontmatter.match(/^model:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1] ?? null;
};

const phase = (n) => {
  const start = phases.search(new RegExp(`^### ${n}\\. `, 'm'));
  assert.notEqual(start, -1, `no "### ${n}." subsection`);
  const body = phases.indexOf('\n', start) + 1;
  const rest = phases.slice(body);
  const next = rest.search(/^#+ /m);
  return phases.slice(start, next === -1 ? undefined : body + next);
};

const modelsIn = (text) => [...text.matchAll(/`model: ([a-z]+)`/g)].map((m) => m[1]);

describe('the phase agents of /speckit-auto', () => {
  const dispatched = { 2: 'speckit-specify', 5: 'speckit-plan', 6: 'speckit-checklist', 7: 'speckit-tasks' };

  for (const [n, skill] of Object.entries(dispatched)) {
    it(`dispatches phase ${n} on the pin of ${skill}`, () => {
      assert.notEqual(pinOf(skill), 'opus', 'an Opus pin runs inline: move this phase to the inline list');
      assert.deepEqual(modelsIn(phase(n)), [pinOf(skill)]);
    });
  }

  it('runs clarify and analyze inline, their pin being the run model', () => {
    for (const [n, skill] of [
      [4, 'speckit-clarify'],
      [8, 'speckit-analyze'],
    ]) {
      assert.equal(pinOf(skill), 'opus');
      assert.deepEqual(modelsIn(phase(n)), []);
      assert.match(phase(n), /inline/);
    }
  });

  it('keeps context and the building phases on the run model', () => {
    for (const n of [3, 9, 10, 11, 12, 13]) assert.deepEqual(modelsIn(phase(n)), [], `phase ${n}`);
  });

  it('says how a phase agent reports and what a failed one means', () => {
    const lead = auto.slice(auto.indexOf('## Phases'), auto.search(/^### 0\. /m));
    assert.match(lead, /phases 2, 5, 6 and 7/);
    assert.match(lead, /subagent_type: task-runner/);
    assert.match(lead, /run_in_background: false/);
    assert.match(lead, /STATUS: success \| failure \| blocked \| partial/);
    assert.match(lead, /pin miss/);
  });
});
