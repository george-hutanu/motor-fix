// @traces 1174-FR-004
import { createPrisma } from './auth/prisma';

// Every environment boots the repository's own database image
// (infra/postgres/Dockerfile): a suite run against any other server fails
// here first, before a migration that needs PostGIS fails somewhere stranger.
const prisma = createPrisma(
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
);

afterAll(() => prisma.$disconnect());

describe('the database image', () => {
  it('is PostgreSQL 18', async () => {
    const [{ version }] = await prisma.$queryRaw<
      { version: string }[]
    >`SELECT current_setting('server_version_num') AS version`;

    expect(Math.floor(Number(version) / 10000)).toBe(18);
  });

  it('offers PostGIS 3.6 to install', async () => {
    const rows = await prisma.$queryRaw<
      { default_version: string }[]
    >`SELECT default_version FROM pg_available_extensions WHERE name = 'postgis'`;

    expect(rows).toHaveLength(1);
    expect(rows[0].default_version).toMatch(/^3\.6\./);
  });

  it('preloads pg_stat_statements', async () => {
    const [{ preload }] = await prisma.$queryRaw<
      { preload: string }[]
    >`SELECT current_setting('shared_preload_libraries') AS preload`;

    expect(preload.split(',').map((name) => name.trim())).toContain(
      'pg_stat_statements',
    );
  });
});
