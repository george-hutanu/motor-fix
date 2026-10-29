import { fromPreviousOwner, repairWhere } from './history';
import { serialDatabase } from '../../auth/serial-db.testing';
import { databaseUrl } from '../../notifications/notifications.testing';
import { transfersWorld } from '../transfers/transfers.testing';

// @traces 1265-FR-010, 1265-FR-013

const world = transfersWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

afterAll(() => prisma.$disconnect());
beforeEach(() => world.reset());

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const at = (value: string) => new Date(value);

// A car Andrei held from 2026-01-10 and sold on 2026-06-15 at noon to Maria,
// ticking `ticked` on the transfer.
async function sold() {
  const andrei = await world.driver('Andrei Marin');
  const maria = await world.driver('Maria Ionescu');
  const car = await world.car(andrei.id);
  await prisma.carOwnership.updateMany({
    data: { fromDate: day('2026-01-10'), openedAt: at('2026-01-10T08:00:00Z') },
    where: { carId: car.id },
  });
  const repair = (
    what: string,
    doneOn: string,
    createdAt: string,
    source: 'logged' | 'motorfix' = 'logged',
    deletedAt: Date | null = null,
  ) =>
    prisma.repair.create({
      data: {
        carId: car.id,
        createdAt: at(createdAt),
        deletedAt,
        doneOn: day(doneOn),
        garageName: 'Service Popescu',
        source,
        what,
      },
    });
  const before = await repair('Before', '2025-12-01', '2026-01-09T10:00:00Z');
  const ticked = await repair('Ticked', '2026-03-01', '2026-03-01T10:00:00Z');
  const kept = await repair('Kept', '2026-04-01', '2026-04-01T10:00:00Z');
  const motorfix = await repair(
    'MotorFix',
    '2026-05-01',
    '2026-05-01T10:00:00Z',
    'motorfix',
  );
  const deleted = await repair(
    'Deleted',
    '2026-05-02',
    '2026-05-02T10:00:00Z',
    'logged',
    at('2026-05-03T10:00:00Z'),
  );
  const transfer = await prisma.carTransfer.create({
    data: {
      buyerId: maria.id,
      buyerPhone: '+40722123456',
      carId: car.id,
      expiresAt: at('2026-06-20T00:00:00Z'),
      repairs: { create: [{ repairId: ticked.id }] },
      saleDate: day('2026-06-15'),
      sellerId: andrei.id,
      status: 'accepted',
      tokenHash: `hash-${car.id}`,
    },
  });
  const closedAt = at('2026-06-15T12:00:00Z');
  await prisma.carOwnership.updateMany({
    data: {
      access: 'former_owner_read_only',
      closedAt,
      toDate: day('2026-06-15'),
    },
    where: { carId: car.id },
  });
  await prisma.carOwnership.create({
    data: {
      access: 'owner',
      accountId: maria.id,
      carId: car.id,
      fromDate: day('2026-06-15'),
      openedAt: closedAt,
      transferId: transfer.id,
    },
  });
  await prisma.car.update({
    data: { ownerId: maria.id },
    where: { id: car.id },
  });
  // After the sale: Maria logs one, a MotorFix one lands, and one logged later
  // is backdated to before the sale.
  const hers = await repair('Hers', '2026-07-01', '2026-07-01T10:00:00Z');
  const lateMotorfix = await repair(
    'Late MotorFix',
    '2026-07-02',
    '2026-07-02T10:00:00Z',
    'motorfix',
  );
  const backdated = await repair(
    'Backdated',
    '2026-06-01',
    '2026-07-03T10:00:00Z',
  );
  const [seller, buyer] = await world.ownerships(car.id);
  return {
    buyer: buyer!,
    car,
    ids: {
      backdated,
      before,
      deleted,
      hers,
      kept,
      lateMotorfix,
      motorfix,
      ticked,
    },
    seller: seller!,
  };
}

const visible = async (where: ReturnType<typeof repairWhere>) =>
  (
    await prisma.repair.findMany({
      orderBy: [{ doneOn: 'desc' }, { createdAt: 'desc' }],
      where,
    })
  ).map((r) => r.what);

describe('repairWhere', () => {
  it('lets the open row read every MotorFix repair, the ticked ones and what was logged since, never a deleted one', async () => {
    const { buyer } = await sold();

    expect(await visible(repairWhere(buyer))).toEqual([
      'Late MotorFix',
      'Hers',
      'Backdated',
      'MotorFix',
      'Ticked',
    ]);
  });

  it('cuts the closed row at the sale date and the closing instant, for every source', async () => {
    const { seller } = await sold();

    expect(await visible(repairWhere(seller))).toEqual([
      'MotorFix',
      'Kept',
      'Ticked',
    ]);
  });

  it('lets an original owner’s open row read everything not deleted', async () => {
    const andrei = await world.driver('Andrei Marin');
    const car = await world.car(andrei.id);
    await world.logged(car.id, { what: 'Logged' });
    await world.logged(car.id, { deleted: true, what: 'Gone' });
    await world.throughMotorFix(andrei.id, car.id);
    const [row] = await world.ownerships(car.id);

    expect((await visible(repairWhere(row!))).sort()).toEqual([
      'Logged',
      'Schimb ulei',
    ]);
  });
});

describe('fromPreviousOwner', () => {
  it('flags what was created before the row opened', async () => {
    const { buyer, ids, seller } = await sold();

    expect(fromPreviousOwner(ids.ticked, buyer)).toBe(true);
    expect(fromPreviousOwner(ids.motorfix, buyer)).toBe(true);
    expect(fromPreviousOwner(ids.hers, buyer)).toBe(false);
    expect(fromPreviousOwner(ids.kept, seller)).toBe(false);
    expect(fromPreviousOwner(ids.before, seller)).toBe(true);
  });
});
