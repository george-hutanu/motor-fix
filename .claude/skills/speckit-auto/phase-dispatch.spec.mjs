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

const pinOf = (skill) => {
  const text = readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf8');
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  return frontmatter.match(/^model:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1] ?? null;
};

const phase = (n) => {
  const start = auto.search(new RegExp(`^### ${n}\\. `, 'm'));
  assert.notEqual(start, -1, `no "### ${n}." subsection`);
  const body = auto.indexOf('\n', start) + 1;
  const rest = auto.slice(body);
  const next = rest.search(/^##+ /m);
  return auto.slice(start, next === -1 ? undefined : body + next);
};

const modelsIn = (text) => [...text.matchAll(/`model: ([a-z]+)`/g)].map((m) => m[1]);

describe('the phase agents of /speckit-auto', () => {
  const dispatched = { 2: 'speckit-specify', 5: 'speckit-plan', 6: 'speckit-checklist', 7: 'speckit-tasks' };

  for (const [n, skill] of Object.entries(dispatched)) {
    it(`dispatches phase ${n} on the pin of ${skill}`, () => {
      const text = phase(n);
      assert.deepEqual(modelsIn(text), [pinOf(skill)]);
      assert.match(text, /subagent_type: task-runner/);
      assert.match(text, /run_in_background: false/);
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
    assert.match(lead, /STATUS: success \| failure \| blocked \| partial/);
    assert.match(lead, /pin miss/);
  });
});
