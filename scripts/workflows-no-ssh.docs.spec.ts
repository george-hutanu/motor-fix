import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The how-to pages live in the private specs clone, which CI does not check
// out; on a checkout that has it, they must describe what the workflows do.
const docs = join(__dirname, '../.motor-fix-specs/docs/how-to');
const release = join(docs, 'release.md');
const backup = join(docs, 'back-up-and-restore-the-database.md');
const docsIt = existsSync(release) && existsSync(backup) ? it : it.skip;

// @traces 1371-FR-010
describe('the release and backup how-to pages', () => {
  docsIt('describe the staging seed in the api pre-deploy step', () => {
    const page = readFileSync(release, 'utf8');
    expect(page).toContain('SEED_ONLY=1 sh scripts/reset-staging.sh');
    expect(page).toContain('variableUpsert');
    expect(page).toMatch(/pre-deploy/);
  });

  docsIt('describe the sandbox route for the backup and the drill', () => {
    const page = readFileSync(backup, 'utf8');
    expect(page).toMatch(/sandbox/i);
    expect(page).toContain('railway-sandbox.ts open');
    expect(page).toContain('sandbox-backup.sh');
  });
});
