import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PRISMA = join(__dirname, '../../prisma');

// Every column typed with the job's status, as `Model.field`.
function statusColumns() {
  const dir = join(PRISMA, 'schema');
  return readdirSync(dir)
    .filter((file) => file.endsWith('.prisma'))
    .flatMap((file) => {
      const text = readFileSync(join(dir, file), 'utf8');
      return [...text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].flatMap(
        ([, model, body]) =>
          [...body.matchAll(/^\s+(\w+)\s+JobStatus\b/gm)].map(
            ([, field]) => `${model}.${field}`,
          ),
      );
    })
    .sort();
}

// @traces 122-FR-001 122-FR-014
describe('the job’s one status', () => {
  it('is stored on the job alone, its history aside', () => {
    expect(statusColumns()).toEqual([
      'Job.status',
      'JobStageEntry.fromStatus',
      'JobStageEntry.toStatus',
    ]);
  });

  it('is never copied into a view', () => {
    const dir = join(PRISMA, 'migrations');
    const views = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) =>
        /\bCREATE\s+(OR\s+REPLACE\s+)?(MATERIALIZED\s+)?VIEW\b/i.test(
          readFileSync(join(dir, entry.name, 'migration.sql'), 'utf8'),
        ),
      )
      .map((entry) => entry.name);

    expect(views).toEqual([]);
  });
});
