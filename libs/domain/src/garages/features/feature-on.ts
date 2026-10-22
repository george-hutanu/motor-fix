import type { Prisma } from '../../generated/prisma/client';

// A garage with no row for a feature has it on.
export async function featureOn(
  db: Pick<Prisma.TransactionClient, 'garageFeature'>,
  garageId: string,
  key: string,
): Promise<boolean> {
  const row = await db.garageFeature.findUnique({
    select: { enabled: true },
    where: { garageId_key: { garageId, key } },
  });
  return row?.enabled ?? true;
}
