import { createPrisma } from './prisma';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';

// The Prisma adapter sends and reads timestamps as UTC wall-clock text, so a
// session in any other time zone would store every instant shifted by its
// offset and make SQL on now() disagree with what Prisma wrote. A server set
// to Europe/Bucharest is stood in for by PGOPTIONS, which pg reads when the
// connection names no options of its own.
describe('createPrisma', () => {
  const before = process.env['PGOPTIONS'];
  let prisma: ReturnType<typeof createPrisma>;

  beforeAll(() => {
    process.env['PGOPTIONS'] = '-c TimeZone=Europe/Bucharest';
    prisma = createPrisma(databaseUrl);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (before === undefined) delete process.env['PGOPTIONS'];
    else process.env['PGOPTIONS'] = before;
  });

  it('keeps an instant whole on a server in another time zone', async () => {
    const at = new Date('2026-07-01T09:30:00.000Z');

    const [row] = await prisma.$queryRaw<{ ms: number }[]>`
      SELECT (extract(epoch FROM ${at}::timestamptz) * 1000)::float8 AS ms`;

    expect(row?.ms).toBe(at.getTime());
  });

  it('answers now() as the instant it is', async () => {
    const [row] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;

    expect(Math.abs((row?.now.getTime() ?? 0) - Date.now())).toBeLessThan(
      60_000,
    );
  });
});
