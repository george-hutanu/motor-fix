import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Each spec-kit phase runs on the model its skill names, whatever model the
// session is on. null means the skill deliberately follows the session: the
// orchestrators, whose work happens in skills and subagents that carry their
// own model, and the constitution, which is run rarely and on purpose. A new
// speckit skill has to be placed here, or it silently inherits the session.
const MODELS = {
  'speckit-specify': 'fable',
  'speckit-plan': 'fable',
  'speckit-correct-course': 'fable',
  'speckit-retro': 'fable',

  'speckit-clarify': 'opus',
  'speckit-analyze': 'opus',
  'speckit-tests': 'opus',
  'speckit-implement': 'opus',
  'speckit-converge': 'opus',
  'speckit-harden': 'opus',
  'speckit-bug-assess': 'opus',
  'speckit-bug-fix': 'opus',
  'speckit-elicit': 'opus',
  'speckit-roundtable': 'opus',

  'speckit-size': 'sonnet',
  'speckit-checklist': 'sonnet',
  'speckit-tasks': 'sonnet',
  'speckit-design-check': 'sonnet',
  'speckit-context': 'sonnet',
  'speckit-notion-sync': 'sonnet',
  'speckit-agent-context-update': 'sonnet',
  'speckit-archive': 'sonnet',
  'speckit-doctor': 'sonnet',
  'speckit-learn': 'sonnet',
  'speckit-evolve': 'sonnet',
  'speckit-config-gc': 'sonnet',
  'speckit-assess-decide': 'sonnet',
  'speckit-assess-define': 'sonnet',
  'speckit-assess-intake': 'sonnet',
  'speckit-assess-research': 'sonnet',
  'speckit-assess-shape': 'sonnet',
  'speckit-bug-test': 'sonnet',
  'speckit-taskstoissues': 'sonnet',

  'speckit-git-commit': 'haiku',
  'speckit-git-feature': 'haiku',
  'speckit-git-initialize': 'haiku',
  'speckit-git-remote': 'haiku',
  'speckit-git-validate': 'haiku',

  'speckit-auto': null,
  'speckit-review': null,
  'speckit-pr-test': null,
  'speckit-constitution': null,
};

const skillsDir = import.meta.dirname;

const modelOf = (skill) => {
  const text = readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf8');
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const models = [...frontmatter.matchAll(/^model:\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  // YAML keeps the last of a repeated key, so a second model line would win
  // over the first while reading as the first here.
  return models.length > 1 ? `${models.length} model lines` : (models[0] ?? null);
};

describe('the model each spec-kit phase runs on', () => {
  it('places every speckit skill, and only those', () => {
    const skills = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('speckit-'))
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(skills, Object.keys(MODELS).sort());
  });

  it('pins each skill to its model, or leaves it on the session model', () => {
    const wrong = Object.entries(MODELS)
      .filter(([skill, model]) => modelOf(skill) !== model)
      .map(([skill, model]) => `${skill}: expected ${model}, found ${modelOf(skill)}`);
    assert.deepEqual(wrong, []);
  });
});
