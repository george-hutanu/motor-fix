import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Railway refuses `railway ssh keys add` to both of the repository's tokens,
// so nothing reaches a Railway service over SSH: the backup, the staging
// reset and the point-in-time drill open a short-lived sandbox on the
// environment's private network instead (scripts/railway-sandbox.ts). Read
// as text, like the other workflow specs: the workflows only run on GitHub.
const dir = join(__dirname, '..', '.github', 'workflows');
const read = (name: string) => readFileSync(join(dir, name), 'utf8');

const workflows = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));

// Every step of the job that starts at `job:` (two-space indent), split at
// each `- name:` or `- uses:`.
function steps(text: string, job: string) {
  const start = text.indexOf(`\n  ${job}:\n`);
  const rest = text.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const body = end === -1 ? rest : rest.slice(0, end + 1);
  return body.split(/\n(?= {6}- )/).slice(1);
}

const sandboxed = [
  ['backup.yml', 'backup', 'postgres'],
  ['reset-staging.yml', 'reset', 'api'],
  ['pitr-drill.yml', 'staging', 'postgres'],
] as const;

// @traces 1371-workflows-no-ssh-FR-001
describe('no workflow reaches Railway over SSH', () => {
  it.each(workflows)('%s registers no key and runs no railway ssh', (name) => {
    const text = read(name);
    expect(text).not.toMatch(/railway ssh|ssh keys|ssh-keygen|~\/\.ssh/);
  });

  it('reads the three workflows that used to, and the release', () => {
    for (const [name] of sandboxed) expect(workflows).toContain(name);
    expect(workflows).toContain('release.yml');
  });
});

// @traces 1371-workflows-no-ssh-FR-001, 1371-workflows-no-ssh-FR-002
describe.each(sandboxed)('%s, job %s', (name, job, kind) => {
  const text = read(name);
  const all = steps(text, job);
  const at = (needle: string) => all.findIndex((s) => s.includes(needle));
  const open = at(`railway-sandbox.ts open `);
  const close = at('railway-sandbox.ts close');

  it(`opens a ${kind} sandbox with the helper, which records its id`, () => {
    expect(open).toBeGreaterThan(-1);
    expect(all[open]).toMatch(/id: sandbox\b/);
    expect(all[open]).toMatch(
      new RegExp(`railway-sandbox\\.ts open \\S+ ${kind}\\b`),
    );
  });

  it('closes it in an always step, after every other step that uses it', () => {
    expect(close).toBeGreaterThan(open);
    expect(all[close]).toMatch(/if: always\(\)/);
    expect(all[close]).toContain("steps.sandbox.outputs.id != ''");
    for (const [i, step] of all.entries()) {
      if (
        step.includes('railway-sandbox.ts exec') ||
        step.includes('SANDBOX_ID')
      ) {
        if (i !== close) expect(i).toBeLessThan(close);
      }
    }
  });

  it('pins the Railway CLI that has sandboxes', () => {
    expect(text).toContain('npm install --global @railway/cli@5.64.2');
    expect(text).not.toMatch(/@railway\/cli(@latest)?\s*$/m);
  });

  it('masks the secrets it hands over before it opens the sandbox', () => {
    const mask = at('railway-sandbox.ts mask');
    if (kind === 'postgres' && name === 'pitr-drill.yml') {
      // The drill hands no secret to the sandbox: its markers are plain SQL.
      expect(mask).toBe(-1);
      return;
    }
    expect(mask).toBeGreaterThan(-1);
    expect(mask).toBeLessThan(open);
  });
});

// @traces 1371-workflows-no-ssh-FR-006
describe('reset-staging.yml', () => {
  const text = read('reset-staging.yml');

  it('is bound to the staging environment, with no input naming another', () => {
    expect(text).toMatch(/^on: workflow_dispatch$/m);
    expect(text).toMatch(/^ {4}environment: staging$/m);
    expect(text).not.toMatch(/inputs:/);
    expect(text).not.toMatch(/production/i);
  });
});
