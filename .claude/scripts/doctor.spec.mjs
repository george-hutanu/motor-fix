import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blessHooks,
  checkCommands,
  checkFeatureState,
  checkHooks,
  checkSkillsAndAgents,
} from './doctor.mjs';

// Doctor is the check that catches a gate which stopped firing. These build a
// throwaway repo skeleton and break one thing at a time — the real repo is
// never touched (constitution III: integration tests use temp dirs).

let repo;
const write = (rel, body) => {
  const file = join(repo, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
  return file;
};
const status = (results, name) => results.find((r) => r.name === name)?.status;
const detail = (results, name) => results.find((r) => r.name === name)?.detail ?? '';

const registryFor = (fingerprint) => ({
  hooks: [
    {
      id: 'pre:bash:guard',
      event: 'PreToolUse',
      matcher: 'Bash',
      script: 'guard.mjs',
      profiles: ['standard'],
      description: 'a test gate that guards something',
      fingerprint,
    },
  ],
});
const settingsWith = (ids) => ({
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: ids.map((id) => ({ type: 'command', command: `node run-hook.mjs ${id}` })) }],
  },
});

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'doctor-'));
  write('.claude/hooks/guard.mjs', '// gate\n');
  write('.claude/hooks/run-hook.mjs', '// wrapper\n');
  // 5b1a... is the fingerprint of the guard body above; blessHooks records the real one.
  write('.claude/hooks/registry.json', registryFor('deadbeefcafe'));
  blessHooks(repo);
  write('.claude/settings.json', settingsWith(['pre:bash:guard']));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('doctor — hooks', () => {
  it('passes a registry that matches disk and settings', () => {
    const results = checkHooks(repo);
    assert.equal(status(results, 'hooks/scripts'), 'ok');
    assert.equal(status(results, 'hooks/fingerprints'), 'ok');
    assert.equal(status(results, 'hooks/wiring'), 'ok');
    assert.equal(status(results, 'hooks/orphans'), 'ok');
  });

  it('fails when a gate script changed since it was reviewed', () => {
    writeFileSync(join(repo, '.claude/hooks/guard.mjs'), '// gate, but weakened\n');
    const results = checkHooks(repo);
    assert.equal(status(results, 'hooks/fingerprints'), 'fail');
    assert.match(detail(results, 'hooks/fingerprints'), /pre:bash:guard/);
  });

  it('fails when a registered gate has no script', () => {
    rmSync(join(repo, '.claude/hooks/guard.mjs'));
    assert.equal(status(checkHooks(repo), 'hooks/scripts'), 'fail');
  });

  it('fails when settings and the registry disagree in either direction', () => {
    write('.claude/settings.json', settingsWith([]));
    assert.match(detail(checkHooks(repo), 'hooks/wiring'), /registered but not wired/);
    write('.claude/settings.json', settingsWith(['pre:bash:guard', 'ghost:gate']));
    assert.match(detail(checkHooks(repo), 'hooks/wiring'), /wired but unknown: ghost:gate/);
  });

  it('warns about a hook script nothing registers', () => {
    write('.claude/hooks/forgotten.sh', '#!/bin/sh\n');
    assert.equal(status(checkHooks(repo), 'hooks/orphans'), 'warn');
  });

  it('reports a missing registry as a failure, not a crash', () => {
    rmSync(join(repo, '.claude/hooks/registry.json'));
    assert.equal(checkHooks(repo)[0].status, 'fail');
  });

  it('re-blesses only what changed', () => {
    assert.deepEqual(blessHooks(repo), []);
    writeFileSync(join(repo, '.claude/hooks/guard.mjs'), '// reviewed change\n');
    const changed = blessHooks(repo);
    assert.equal(changed.length, 1);
    assert.match(changed[0], /pre:bash:guard/);
    assert.equal(status(checkHooks(repo), 'hooks/fingerprints'), 'ok');
    assert.match(readFileSync(join(repo, '.claude/hooks/registry.json'), 'utf8'), /"fingerprint"/);
  });
});

describe('doctor — feature state', () => {
  it('fails a feature pointer with no spec behind it', () => {
    write('.specify/feature.json', { feature_directory: 'specs/003-ghost' });
    assert.equal(status(checkFeatureState(repo), 'feature/pointer'), 'fail');
  });

  it('accepts a pointer that resolves', () => {
    write('specs/003-real/spec.md', '# spec\n');
    write('.specify/feature.json', { feature_directory: 'specs/003-real' });
    const results = checkFeatureState(repo);
    assert.equal(status(results, 'feature/pointer'), 'ok');
    assert.match(detail(results, 'feature/active'), /003-real/);
  });

  it('accepts a pointer to specs/<feature> in an old clone past the move, and an exemption found there', () => {
    write('specs/specs/003-real/spec.md', '# spec\n');
    write('.specify/feature.json', { feature_directory: 'specs/003-real' });
    write('.specify/trace-baseline.json', { grandfathered: ['003-real'], artifact_legacy: [] });
    const results = checkFeatureState(repo);
    assert.equal(status(results, 'feature/pointer'), 'ok');
    assert.equal(status(results, 'feature/baseline'), 'ok');
    assert.match(detail(results, 'feature/active'), /003-real/);
  });

  it('warns about an exemption for a feature that no longer exists', () => {
    write('.specify/trace-baseline.json', { grandfathered: ['004-deleted'], artifact_legacy: [] });
    const results = checkFeatureState(repo);
    assert.equal(status(results, 'feature/baseline'), 'warn');
    assert.match(detail(results, 'feature/baseline'), /dead gate holes/);
  });
});

describe('doctor — skills and agents', () => {
  it('fails a skill whose frontmatter name does not match its directory', () => {
    write('.claude/skills/speckit-thing/SKILL.md', '---\nname: other-thing\ndescription: does a thing\n---\n');
    assert.match(detail(checkSkillsAndAgents(repo), 'skills/frontmatter'), /other-thing/);
  });

  it('fails a skill directory with no SKILL.md', () => {
    mkdirSync(join(repo, '.claude/skills/empty'), { recursive: true });
    assert.equal(status(checkSkillsAndAgents(repo), 'skills/frontmatter'), 'fail');
  });

  it('fails an agent missing its description', () => {
    write('.claude/agents/reviewer.md', '---\nname: reviewer\n---\n');
    assert.equal(status(checkSkillsAndAgents(repo), 'agents/frontmatter'), 'fail');
  });

  it('passes well-formed skills and agents', () => {
    write('.claude/skills/speckit-thing/SKILL.md', '---\nname: speckit-thing\ndescription: does a thing\n---\n');
    write('.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: reviews\ntools: Read\n---\n');
    const results = checkSkillsAndAgents(repo);
    assert.equal(status(results, 'skills/frontmatter'), 'ok');
    assert.equal(status(results, 'agents/frontmatter'), 'ok');
  });
});

describe('doctor — commands', () => {
  const fullPackage = {
    scripts: { test: 'x', lint: 'x', trace: 'x', 'trace:check': 'x', 'test:mutation': 'x' },
  };
  const templates = () => {
    for (const t of ['spec', 'plan', 'tasks', 'checklist', 'constitution'])
      write(`.specify/templates/${t}-template.md`, '# t\n');
  };

  it('fails when a documented npm script is gone', () => {
    write('package.json', { scripts: { test: 'x' } });
    assert.match(detail(checkCommands(repo), 'commands/npm'), /lint/);
  });

  it('warns about a pre-approved command whose script was deleted', () => {
    write('package.json', fullPackage);
    write('.claude/settings.json', {
      ...settingsWith(['pre:bash:guard']),
      permissions: { allow: ['Bash(node scripts/gone.mjs)', 'Bash(npm test)'] },
    });
    const results = checkCommands(repo);
    assert.equal(status(results, 'commands/permissions'), 'warn');
    assert.match(detail(results, 'commands/permissions'), /gone\.mjs/);
  });

  it('reads a prefix rule (`:*`) as the script it names, so a script still there is no warning', () => {
    write('package.json', fullPackage);
    write('scripts/here.mjs', '');
    write('.claude/settings.json', {
      ...settingsWith(['pre:bash:guard']),
      permissions: { allow: ['Bash(node scripts/here.mjs:*)', 'Bash(node scripts/gone.mjs:*)'] },
    });
    const results = checkCommands(repo);
    assert.match(detail(results, 'commands/permissions'), /gone\.mjs/);
    assert.doesNotMatch(detail(results, 'commands/permissions'), /here\.mjs/);
  });

  it('finds mutation owners by their Nx target, including the root scripts project', () => {
    write('package.json', fullPackage);
    write('libs/contracts/stryker.config.json', { thresholds: { break: 0 } });
    write('libs/contracts/project.json', { targets: { 'test:mutation': {} } });
    write('scripts/stryker.config.json', { thresholds: { break: 0 } });
    write('scripts/project.json', { targets: { 'test:mutation': {} } });
    const results = checkCommands(repo);
    assert.equal(status(results, 'commands/mutation'), 'ok');
    assert.match(detail(results, 'commands/mutation'), /^2 /);
  });

  it('warns about a stryker config whose project has no test:mutation target', () => {
    write('package.json', fullPackage);
    write('apps/api/stryker.config.json', { thresholds: { break: 0 } });
    write('apps/api/project.json', { targets: {} });
    const results = checkCommands(repo);
    assert.equal(status(results, 'commands/mutation'), 'warn');
    assert.match(detail(results, 'commands/mutation'), /apps\/api/);
  });

  it('fails when a spec-kit template is missing', () => {
    write('package.json', fullPackage);
    assert.equal(status(checkCommands(repo), 'commands/templates'), 'fail');
    templates();
    assert.equal(status(checkCommands(repo), 'commands/templates'), 'ok');
  });
});
