import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'config-protection.mjs');
const dirs = [];

const withRegistry = (registry) => {
  const repo = mkdtempSync(join(tmpdir(), 'cp-adv-'));
  dirs.push(repo);
  mkdirSync(join(repo, '.claude/hooks'), { recursive: true });
  if (registry !== undefined) {
    writeFileSync(join(repo, '.claude/hooks/registry.json'), typeof registry === 'string' ? registry : JSON.stringify(registry));
  }
  return repo;
};
const edit = (repo, rel) =>
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { file_path: join(repo, rel), content: '// x' } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

// @traces 1359-FR-010
describe('config-protection re-bless reminder against a hostile registry', () => {
  const quiet = (registry) => {
    const repo = withRegistry(registry);
    const out = edit(repo, '.claude/hooks/some-gate.mjs');
    assert.deepEqual([out.status, out.stderr], [0, '']);
  };

  it('stays quiet and passes when the registry file is missing', () => quiet(undefined));
  it('stays quiet and passes for the JSON value null', () => quiet('null'));
  it('stays quiet and passes when hooks is an object instead of a list', () => quiet({ hooks: { script: 'some-gate.mjs' } }));
  it('stays quiet and passes when a list holds null and entries without a script', () =>
    quiet({ hooks: [null, {}, { script: 42 }], helpers: [null] }));

  it('still reminds for a valid entry that sits after a malformed one', () => {
    const repo = withRegistry({ hooks: [null, { script: 'some-gate.mjs' }] });
    const out = edit(repo, '.claude/hooks/some-gate.mjs');
    assert.equal(out.status, 0);
    assert.match(out.stderr, /re-bless the registry/);
  });

  it('reminds for a script listed only under helpers', () => {
    const repo = withRegistry({ hooks: [], helpers: [{ script: 'lib-thing.sh' }] });
    assert.match(edit(repo, '.claude/hooks/lib-thing.sh').stderr, /re-bless the registry/);
  });

  it('does not remind for a file that merely shares a prefix with a registered script', () => {
    const repo = withRegistry({ hooks: [{ script: 'gate.mjs' }] });
    assert.equal(edit(repo, '.claude/hooks/gate.mjs.bak').stderr, '');
    assert.equal(edit(repo, '.claude/hooks/gate.mjs/extra').stderr, '');
  });

});
