import type { EventPort } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';

// A deleted account leaves every team it works on. Its mechanic card stays,
// detached, off the profile and marked removed (out of the team list), so its
// reviews, rating and bookings keep a name; its memberships go. An owner never reaches here: the deletion
// refuses an account that owns a garage.
export async function leaveTeams(
  tx: Prisma.TransactionClient,
  events: EventPort,
  accountId: string,
) {
  const mechanic = await tx.mechanic.findUnique({
    select: { garageId: true, id: true, onProfile: true },
    where: { accountId },
  });
  if (mechanic) {
    await tx.mechanic.update({
      data: { accountId: null, onProfile: false, removedAt: new Date() },
      where: { id: mechanic.id },
    });
    await events.record(tx, {
      // As the owner's removal: the public streams hear it while the card
      // was still on the profile (056-FR-014).
      audience: {
        garageId: mechanic.garageId,
        mechanicId: mechanic.id,
        public: mechanic.onProfile,
        type: 'mechanic',
      },
      kind: 'mechanic.removed',
      payload: {
        from: 'account_deleted',
        garageId: mechanic.garageId,
        mechanicId: mechanic.id,
      },
      subjectId: mechanic.id,
    });
  }
  const memberships = await tx.garageMember.findMany({
    select: { garageId: true },
    where: { accountId, role: { not: 'owner' } },
  });
  await tx.garageMember.deleteMany({
    where: { accountId, role: { not: 'owner' } },
  });
  for (const { garageId } of memberships) {
    await events.record(tx, {
      audience: { garageIds: [garageId], type: 'garage' },
      kind: 'member.removed',
      payload: { accountId, garageId },
      subjectId: garageId,
    });
  }
}
