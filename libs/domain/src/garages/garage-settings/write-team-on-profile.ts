import type { AuditChange, AuditPort } from '../../audit/audit.port';
import type { EventPort } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';

// The garage's current cards: the public pages a change of the team switch
// shows or hides.
export async function teamCardIds(
  tx: Pick<Prisma.TransactionClient, 'mechanic'>,
  garageId: string,
) {
  const rows = await tx.mechanic.findMany({
    select: { id: true },
    where: { garageId, removedAt: null },
  });
  return rows.map((row) => row.id);
}

// Step 4's switch written onto the garage, inside the caller's transaction.
// A garage being created records the value it starts with as a field of its
// creation, and has no public page to tell, so `events` is left out. A garage
// already live gets one history entry when the switch moves, and hears it
// through `garage.updated`.
export async function writeTeamOnProfile(
  tx: Prisma.TransactionClient,
  change: Omit<AuditChange, 'subjectId' | 'subjectType'> & {
    garageId: string;
  },
  on: boolean,
  ports: { audit: AuditPort; events?: EventPort },
): Promise<void> {
  const { garageId } = change;
  const { teamOnProfile } = await tx.garage.findUniqueOrThrow({
    select: { teamOnProfile: true },
    where: { id: garageId },
  });
  if (!ports.events) {
    if (teamOnProfile !== on) {
      await tx.garage.update({
        data: { teamOnProfile: on },
        where: { id: garageId },
      });
    }
    await ports.audit.record(tx, {
      ...change,
      action: 'create',
      field: 'team_on_profile',
      newValue: on,
      subjectId: garageId,
      subjectType: 'garage',
    });
    return;
  }
  if (teamOnProfile === on) return;
  await tx.garage.update({
    data: { teamOnProfile: on },
    where: { id: garageId },
  });
  await ports.audit.recordChanges(
    tx,
    { ...change, subjectId: garageId, subjectType: 'garage' },
    { team_on_profile: teamOnProfile },
    { team_on_profile: on },
  );
  await ports.events.record(tx, {
    audience: {
      garageId,
      mechanicIds: await teamCardIds(tx, garageId),
      results: false,
      type: 'public_garage',
    },
    kind: 'garage.updated',
    payload: { fields: ['team_on_profile'], garageId },
    subjectId: garageId,
  });
}
