import { Prisma, type PrismaClient } from '../../generated/prisma/client';

// Every `id: { in: [...] }` list inside a read's arguments.
function idListsIn(value: unknown): string[][] {
  if (Array.isArray(value)) return value.flatMap(idListsIn);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => {
    const list = (inner as { in?: unknown } | null)?.in;
    return key === 'id' && Array.isArray(list)
      ? [list as string[]]
      : idListsIn(inner);
  });
}

// Watches the garage reads of a client: which carried a list of ids, and
// the raw statements it ran, so a case can tell an area read from a read
// of ids an earlier area read found.
export function watchGarageReads(prisma: PrismaClient) {
  const count = jest.spyOn(prisma.garage, 'count');
  const findMany = jest.spyOn(prisma.garage, 'findMany');
  const raw = jest.spyOn(prisma, '$queryRaw');
  return {
    counted: () => count.mock.calls.flatMap(([args]) => idListsIn(args)),
    listed: () => findMany.mock.calls.flatMap(([args]) => idListsIn(args)),
    restore: () => {
      count.mockRestore();
      findMany.mockRestore();
      raw.mockRestore();
    },
    statements: () =>
      raw.mock.calls.map(([first, ...values]) =>
        first instanceof Prisma.Sql
          ? first
          : Prisma.sql(first as readonly string[], ...(values as unknown[])),
      ),
  };
}
