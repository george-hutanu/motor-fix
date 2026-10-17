import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// @traces 204-FR-012

const MIGRATIONS = join(__dirname, '..', 'prisma', 'migrations');
// The migration that created the checks and gave every earlier file its own.
const CHECKS_CREATED = '20261007140000_verification_check';

const later = () =>
  readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name > CHECKS_CREATED)
    .map((entry) => ({
      name: entry.name,
      sql: readFileSync(join(MIGRATIONS, entry.name, 'migration.sql'), 'utf8'),
    }));

// SQL without its comments, so a remark naming the table does not count.
const statements = (sql: string) =>
  sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the checks of a file decided before they existed', () => {
  it('are read after the migration that created them', () => {
    expect(later().length).toBeGreaterThan(0);
  });

  it('are never deleted or rewritten by a later migration', () => {
    const touching = later()
      .filter(({ sql }) =>
        /\b(DELETE\s+FROM|UPDATE|TRUNCATE)\s+(TABLE\s+)?"?verification_check"?(\s|;|$)/i.test(
          statements(sql),
        ),
      )
      .map(({ name }) => name);

    expect(touching).toEqual([]);
  });
});
