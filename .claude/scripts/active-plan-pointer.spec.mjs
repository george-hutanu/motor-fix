import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// /speckit-plan's agent-context update rewrote one line of the tracked
// CLAUDE.local.md ("Active plan …: specs/<feature>/plan.md"), so with several
// feature branches open every merge to main made the others conflict on it.
// The pointer now comes from .specify/feature.json at session start
// (session-context.mjs), and nothing spec-kit runs writes it into a tracked file.

const root = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const ignored = (rel) => {
  try {
    git('check-ignore', '-q', '--no-index', rel);
    return true;
  } catch {
    return false;
  }
};

const CONFIG = '.specify/extensions/agent-context/agent-context-config.yml';

/** The files the agent-context extension writes: context_files, else context_file. */
function contextTargets(yml) {
  const list = yml.match(/^context_files:\s*\[(.*)\]\s*$/m)?.[1] ?? '';
  const files = [...list.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  if (files.length) return files;
  const one = yml.match(/^context_file:\s*["']?([^"'\n#]*?)["']?\s*(#.*)?$/m)?.[1]?.trim();
  return one ? [one] : [];
}

/** Each `- extension: agent-context` hook entry in extensions.yml, as its text. */
function agentContextHooks(yml) {
  return yml
    .split(/\n(?=\s*- extension: )/)
    .filter((entry) => /^\s*- extension: agent-context\s*$/m.test(entry) && /command:/.test(entry));
}

describe('the active plan pointer stays out of tracked files', () => {
  it('CLAUDE.local.md carries no managed Spec Kit block', () => {
    const text = read('CLAUDE.local.md');
    assert.doesNotMatch(text, /<!-- SPECKIT START -->/);
    assert.doesNotMatch(text, /^Active plan \(stack, structure, commands\):/m);
  });

  it('the agent-context extension writes only git-ignored files', () => {
    const targets = contextTargets(read(CONFIG));
    // An empty config is not safe: the extension then self-seeds CLAUDE.md.
    assert.ok(targets.length > 0, 'no context file configured');
    for (const file of targets) assert.ok(ignored(file), `${file} is not git-ignored`);
  });

  it('no spec-kit hook runs the agent-context update', () => {
    const hooks = agentContextHooks(read('.specify/extensions.yml'));
    assert.ok(hooks.length > 0, 'expected the after_specify and after_plan entries');
    for (const entry of hooks) assert.match(entry, /^\s*enabled: false\s*$/m, entry);
  });
});
