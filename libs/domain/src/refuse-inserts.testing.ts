import type { PrismaClient } from './generated/prisma/client';

// Every insert into `table` for which `when` (SQL over NEW) holds fails until
// the returned undo runs, as a write lost inside a transaction would.
export async function refuseInserts(
  prisma: PrismaClient,
  table: string,
  when: string,
) {
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION refuse_test_write() RETURNS trigger AS $$
     BEGIN
       IF ${when} THEN RAISE EXCEPTION 'refused'; END IF;
       RETURN NEW;
     END $$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER refuse_test_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION refuse_test_write()`,
  );
  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS refuse_test_write ON ${table}`,
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS refuse_test_write()',
    );
  };
}
