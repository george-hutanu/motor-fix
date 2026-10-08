import type { PrismaClient } from '../generated/prisma/client';

// The newest outbox row's id: the rows a test writes afterwards are above it.
// A row's created_at comes from the app's clock and a time read from the
// database comes from the database's, which drift apart by milliseconds.
export async function outboxMark(prisma: PrismaClient): Promise<bigint> {
  const { _max } = await prisma.outboxEvent.aggregate({ _max: { id: true } });
  return _max.id ?? 0n;
}
