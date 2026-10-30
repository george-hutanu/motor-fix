import { localDay } from '../../../bucharest';
import { quotesApp } from '../../../quotes/quotes-api.testing';
import { CarHistoryModule } from '../../history/history.module';
import { ClientRepairsModule } from '../client-repairs.module';

export const list = (accountId: string) =>
  `/admin/accounts/${accountId}/repairs`;
export const one = (id: string) => `/admin/repairs/${id}`;
export const missing = '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80';
export const version = (repair: { updatedAt: Date }) =>
  repair.updatedAt.toISOString();

type Over = {
  carId?: string;
  costBani?: number | null;
  createdAt?: Date;
  deletedAt?: Date | null;
  doneOn?: string;
  garageId?: string | null;
  garageName?: string;
  shared?: boolean;
  source?: 'logged' | 'motorfix';
  updatedByRole?: 'owner' | 'admin' | 'driver' | null;
  what?: string;
};

// The admin's repair routes over a test database, and a scene to call them on.
export function adminRepairsApp() {
  const app = quotesApp([ClientRepairsModule, CarHistoryModule]);
  const { bearer, team, world } = app;
  const { prisma } = world;

  // A driver's car with logged repairs naming Garaj Nordic, an admin, and a
  // signed-in caller of every other role.
  async function scene() {
    const staff = await team('Garaj Nordic');
    const driverId = await world.account('Andrei Ion Marin');
    const car = await world.car(driverId);
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: car.brandId },
    });
    // A repair done through MotorFix carries its own job, as the table's
    // check requires.
    const motorFixJob = async () => {
      const { booking } = await world.chain(driverId, staff.garage.id);
      await prisma.quoteRequest.update({
        data: { carId: car.id },
        where: { id: booking.requestId },
      });
      return (await world.job(booking.id, 'done')).id;
    };
    const repair = async (over: Over = {}) => {
      const { shared, ...rest } = over;
      const jobId = rest.source === 'motorfix' ? await motorFixJob() : null;
      return prisma.repair.create({
        data: {
          carId: car.id,
          costBani: 45_000,
          doneOn: new Date('2026-10-01T00:00:00Z'),
          garageId: staff.garage.id,
          garageName: 'Garaj Nordic',
          jobId,
          odometerKm: 151_000,
          source: 'logged',
          what: 'Schimb ulei',
          ...rest,
          ...(rest.doneOn && {
            doneOn: new Date(`${rest.doneOn}T00:00:00Z`),
          }),
          sharedWithGarage: shared ?? true,
        },
      });
    };
    const adminId = await world.account('Admin', ['admin']);
    const auth = {
      admin: bearer(adminId, 'admin'),
      driver: bearer(driverId, 'driver'),
      mechanic: bearer(staff.plain, 'mechanic'),
      owner: bearer(staff.owner, 'garage'),
      receptionist: bearer(staff.receptionist, 'receptionist'),
    };
    return {
      ...staff,
      adminId,
      auth,
      car,
      carName: { brandName: brand.name, model: 'Cooper S', year: 2019 },
      driverId,
      notAdmins: [auth.driver, auth.owner, auth.receptionist, auth.mechanic],
      repair,
    };
  }

  const reread = (id: string) =>
    prisma.repair.findUniqueOrThrow({ where: { id } });

  // The car's open ownership closed today, as a sale closes it.
  const closeOwnership = (carId: string) =>
    prisma.carOwnership.updateMany({
      data: {
        access: 'former_owner_read_only',
        closedAt: new Date(),
        toDate: new Date(`${localDay(new Date())}T00:00:00Z`),
      },
      where: { carId, toDate: null },
    });

  return { ...app, closeOwnership, prisma, reread, scene };
}
