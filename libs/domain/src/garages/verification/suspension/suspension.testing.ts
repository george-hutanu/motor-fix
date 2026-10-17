import { randomUUID } from 'node:crypto';

import type { Role } from '../../../auth/capabilities';
import type { PrismaClient } from '../../../generated/prisma/client';

type NewAccount = (
  name: string,
  roles?: Role[],
  options?: { language?: 'ro' | 'en' },
) => Promise<string>;

// An approved garage with an owner, a receptionist, a mechanic with an
// account, and a driver who belongs to none of it.
export async function staffedGarage(
  prisma: PrismaClient,
  account: NewAccount,
  name = 'Atelier Dinamo',
) {
  const garage = await prisma.garage.create({
    data: {
      approvedAt: new Date(),
      name,
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
    },
  });
  const tag = garage.id.slice(0, 8);
  const ownerId = await account(`Mihai ${tag}`, ['garage']);
  const receptionistId = await account(`Ana ${tag}`, ['receptionist']);
  const mechanicId = await account(`Vlad ${tag}`, ['mechanic']);
  const driverId = await account(`Radu ${tag}`, ['driver']);
  await prisma.garageMember.createMany({
    data: [
      { accountId: ownerId, garageId: garage.id, role: 'owner' },
      { accountId: receptionistId, garageId: garage.id, role: 'receptionist' },
    ],
  });
  await prisma.mechanic.create({
    data: { accountId: mechanicId, garageId: garage.id, name: 'Vlad' },
  });
  return {
    driverId,
    id: garage.id,
    mechanicId,
    name: garage.name,
    ownerId,
    receptionistId,
    slug: garage.slug,
  };
}
