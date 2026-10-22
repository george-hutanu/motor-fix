import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { hookCandidates } from './gc-scan.mjs';

let repo;
const write = (rel, body) => {
  const file = join(repo, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof body === 'string' ? body : `${JSON.stringify(body)}\n`);
};
const paths = (found) => found.map((c) => c.path ?? c.file ?? c.target).sort();

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'gc-adv-')));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

// @traces 1359-FR-014
describe('hookCandidates against awkward hook directories', () => {

  it('returns nothing when the hooks directory holds only specs', () => {
    write('.claude/hooks/registry.json', { hooks: [] });
    write('.claude/hooks/a.spec.mjs', '');
    write('.claude/hooks/a.adversary.spec.mjs', '');
    write('.claude/hooks/b.spec.js', '');
    write('.claude/hooks/c.spec.sh', '');
    assert.deepEqual(hookCandidates(repo), []);
  });

  it('still proposes an orphan whose name merely contains the word spec', () => {
    write('.claude/hooks/registry.json', { hooks: [] });
    write('.claude/hooks/specimen.mjs', '');
    write('.claude/hooks/inspect.sh', '');
    write('.claude/hooks/spec.mjs', '');
    assert.equal(hookCandidates(repo).length, 3);
  });

  it('still proposes an orphan next to a spec for it', () => {
    write('.claude/hooks/registry.json', { hooks: [] });
    write('.claude/hooks/orphan.mjs', '');
    write('.claude/hooks/orphan.spec.mjs', '');
    const found = hookCandidates(repo);
    assert.equal(found.length, 1);
    assert.match(JSON.stringify(found[0]), /orphan\.mjs/);
    assert.doesNotMatch(JSON.stringify(found[0]), /orphan\.spec\.mjs/);
  });

  it('does not throw on an unparseable registry and still skips specs', () => {
    write('.claude/hooks/registry.json', '{ nope');
    write('.claude/hooks/a.spec.mjs', '');
    assert.doesNotThrow(() => hookCandidates(repo));
    assert.equal(JSON.stringify(hookCandidates(repo)).includes('a.spec.mjs'), false);
  });


});
