import type { Prisma, PrismaClient } from './generated/prisma/client';

// A transaction that holds its writes, and the locks they take, until it is
// released, as a save running at the same time would.
export function heldOpen(
  prisma: PrismaClient,
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  let release = () => {};
  let started = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const done = prisma.$transaction(async (tx) => {
    await write(tx);
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  return { done, ready, release: () => release() };
}

// Resolves once some session waits on a row or key lock (a held-open write's,
// say), so a race test releases the holder only after its rival has met it.
// The serial-database turn's advisory waits are not counted.
export async function lockWaited(prisma: PrismaClient, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_locks
       WHERE NOT granted AND locktype <> 'advisory'`;
    if (waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no session waited on a lock within ${ms} ms`);
}
