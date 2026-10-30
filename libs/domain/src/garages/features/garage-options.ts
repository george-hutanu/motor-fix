import type { Prisma } from '../../generated/prisma/client';

type Db = Pick<
  Prisma.TransactionClient,
  'garage' | 'garageFeature' | 'mechanic'
>;

// Whether the garage schedules its lifts and its team; a garage with no row
// for a switch has it on.
export async function switchesOf(
  db: Pick<Db, 'garageFeature'>,
  garageId: string,
) {
  const rows = await db.garageFeature.findMany({
    where: { garageId, key: { in: ['team_mechanics', 'lift_schedule'] } },
  });
  const on = (key: string) =>
    rows.find((row) => row.key === key)?.enabled ?? true;
  return { lifts: on('lift_schedule'), team: on('team_mechanics') };
}

// The lifts and the current cards a booking or a block may take: none of
// either while its switch is off.
export async function garageOptions(db: Db, garageId: string) {
  const [garage, switches] = await Promise.all([
    db.garage.findUniqueOrThrow({
      select: { liftCount: true },
      where: { id: garageId },
    }),
    switchesOf(db, garageId),
  ]);
  const mechanics = switches.team
    ? await db.mechanic.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
        where: { garageId, removedAt: null },
      })
    : [];
  return {
    liftCount: switches.lifts ? garage.liftCount : 0,
    mechanics,
    team: switches.team,
  };
}
