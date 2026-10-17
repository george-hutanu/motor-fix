import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const repo = join(__dirname, '../../../../..');
const ROOTS = ['libs/domain/src', 'apps/api/src', 'apps/worker/src'];
const WRITES = /\bsystemLog\.write\(|\bwriteJobFailed\(/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sources(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

// The log records what the platform does, never what a person changes: the
// writer is called only by the platform's own sources (status checks, final
// job failures, provider errors, server errors, backups, deploys).
// @traces 297-FR-013
describe('who writes the system status log', () => {
  it('is the platform alone: no service a person acts through writes to it', () => {
    const writers = ROOTS.flatMap((root) => sources(join(repo, root)))
      .filter((path) => WRITES.test(readFileSync(path, 'utf8')))
      .map((path) => relative(repo, path))
      .sort();

    expect(writers).toEqual([
      'apps/api/src/problem.filter.ts',
      'libs/domain/src/admin/system-log/system-log.module.ts',
      'libs/domain/src/cars/reminders/reminders.module.ts',
      'libs/domain/src/garages/photos/listing-photos/listing-photos.worker.ts',
      'libs/domain/src/job-failures.ts',
      'libs/domain/src/notifications/brevo/brevo.ts',
      'libs/domain/src/places/lookup/places/places.controller.ts',
      'libs/domain/src/status/run.ts',
    ]);
  });

  it('writes no audit history row for an entry', () => {
    for (const file of ['system-log.ts', 'system-log.module.ts', 'purge.ts']) {
      expect(readFileSync(join(__dirname, file), 'utf8')).not.toMatch(/audit/i);
    }
  });
});
