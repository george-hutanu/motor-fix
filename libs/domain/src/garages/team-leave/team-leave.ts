import type { AuditPort } from '../../audit/audit.port';
import type { EventPort } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';
import { removeMechanicBlocks } from '../../workshop/time-blocks/time-blocks';

// A deleted account leaves every team it works on. Its mechanic card stays,
// detached, off the profile and marked removed (out of the team list), so its
// reviews, rating and bookings keep a name; its memberships go. An owner never reaches here: the deletion
// refuses an account that owns a garage. The card's blocks still to come go
// with it, recorded on behalf of `actorId`, who deleted the account.
export async function leaveTeams(
  tx: Prisma.TransactionClient,
  ports: { audit: AuditPort; events: EventPort },
  accountId: string,
  actorId: string | null = accountId,
) {
  const { events } = ports;
  const mechanic = await tx.mechanic.findUnique({
    select: { garageId: true, id: true, onProfile: true },
    where: { accountId },
  });
  if (mechanic) {
    await tx.mechanic.update({
      data: { accountId: null, onProfile: false, removedAt: new Date() },
      where: { id: mechanic.id },
    });
    await removeMechanicBlocks(tx, ports, {
      actorId,
      garageId: mechanic.garageId,
      mechanicId: mechanic.id,
    });
    await events.record(tx, {
      // As the owner's removal: the public streams hear it while the card
      // was still on the profile.
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
