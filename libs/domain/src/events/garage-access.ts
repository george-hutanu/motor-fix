import type { Permissions } from '../auth/capabilities';
import type { PrismaClient } from '../generated/prisma/client';

// Who may hear a garage's events, as one API copy last read it.
export interface GarageAccess {
  owners: Set<string>;
  receptionists: Set<string>;
  // By account id.
  mechanics: Map<string, Permissions>;
  // Feature keys the garage switched off; a feature with no row is on.
  off: Set<string>;
}

export type LoadGarageAccess = (garageId: string) => Promise<GarageAccess>;

export const loadGarageAccess =
  (prisma: PrismaClient): LoadGarageAccess =>
  async (garageId) => {
    const [members, mechanics, off] = await Promise.all([
      prisma.garageMember.findMany({
        select: { accountId: true, role: true },
        where: { garageId },
      }),
      prisma.mechanic.findMany({
        select: {
          accountId: true,
          canAnswerQuotes: true,
          canMoveBookings: true,
          canRecordFinalPrice: true,
        },
        where: { garageId },
      }),
      prisma.garageFeature.findMany({
        select: { key: true },
        where: { enabled: false, garageId },
      }),
    ]);
    const holding = (role: 'owner' | 'receptionist') =>
      new Set(members.filter((m) => m.role === role).map((m) => m.accountId));
    return {
      mechanics: new Map(
        mechanics.map(({ accountId, ...permissions }) => [
          accountId,
          permissions,
        ]),
      ),
      off: new Set(off.map((f) => f.key)),
      owners: holding('owner'),
      receptionists: holding('receptionist'),
    };
  };
