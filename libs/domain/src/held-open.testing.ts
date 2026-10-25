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
