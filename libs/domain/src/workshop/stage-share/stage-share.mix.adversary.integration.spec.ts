import { stageShare } from './stage-share';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { AuditActorRole } from '../../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

beforeEach(() => world.reset());

const ZERO = {
  admin: 0,
  auto: 0,
  driver: 0,
  mechanic: 0,
  owner: 0,
  receptionist: 0,
  system: 0,
};

async function jobIn(garageName: string) {
  const driver = await world.account('Andrei Marin', ['driver']);
  const garage = await world.garage(garageName);
  const { booking } = await world.chain(driver, garage.id);
  const job = await world.job(booking.id, 'in_work');
  return { garageId: garage.id, jobId: job.id };
}

const entry = (
  jobId: string,
  actorRole: AuditActorRole,
  at: string,
  auto = false,
) =>
  prisma.jobStageEntry.create({
    data: {
      actorRole,
      at: new Date(at),
      auto,
      fromStatus: 'in_work',
      jobId,
      toStatus: 'paused',
    },
  });

// @traces 122-FR-012
describe('the share of job moves across roles, garages and months', () => {
  it('counts the brief’s November mix and keeps October and December out', async () => {
    const { garageId, jobId } = await jobIn('Atelier Dinamo');
    for (let i = 0; i < 12; i++)
      await entry(jobId, 'mechanic', '2027-11-10T10:00:00Z');
    for (let i = 0; i < 5; i++)
      await entry(jobId, 'owner', '2027-11-11T10:00:00Z');
    for (let i = 0; i < 2; i++)
      await entry(jobId, 'receptionist', '2027-11-12T10:00:00Z');
    for (let i = 0; i < 3; i++)
      await entry(jobId, 'system', '2027-11-13T10:00:00Z', true);
    await entry(jobId, 'owner', '2027-10-31T21:59:59Z');
    await entry(jobId, 'owner', '2027-11-30T22:00:00Z');

    const share = await stageShare(prisma, garageId, '2027-11');

    expect(share).toEqual({
      ...ZERO,
      auto: 3,
      mechanic: 12,
      owner: 5,
      receptionist: 2,
    });
  });

  it('counts a driver, admin and system row under their roles and an auto row under auto only', async () => {
    const { garageId, jobId } = await jobIn('Atelier Dinamo');
    await entry(jobId, 'driver', '2027-12-10T10:00:00Z');
    await entry(jobId, 'admin', '2027-12-10T10:00:00Z');
    await entry(jobId, 'system', '2027-12-10T10:00:00Z');
    await entry(jobId, 'driver', '2027-12-10T10:00:00Z', true);
    await entry(jobId, 'mechanic', '2027-12-10T10:00:00Z', true);

    const share = await stageShare(prisma, garageId, '2027-12');

    expect(share).toEqual({ ...ZERO, admin: 1, auto: 2, driver: 1, system: 1 });
  });

  it('leaves another garage’s moves out', async () => {
    const mine = await jobIn('Atelier Dinamo');
    const theirs = await jobIn('Service Militari');
    await entry(mine.jobId, 'owner', '2027-12-10T10:00:00Z');
    await entry(theirs.jobId, 'owner', '2027-12-10T10:00:00Z');
    await entry(theirs.jobId, 'mechanic', '2027-12-10T10:00:00Z');

    const share = await stageShare(prisma, mine.garageId, '2027-12');

    expect(share).toEqual({ ...ZERO, owner: 1 });
  });

  it('closes December at Bucharest midnight and opens January there, across the year', async () => {
    const { garageId, jobId } = await jobIn('Atelier Dinamo');
    await entry(jobId, 'owner', '2027-12-31T21:59:59.999Z');
    await entry(jobId, 'owner', '2027-12-31T22:00:00.000Z');

    const december = await stageShare(prisma, garageId, '2027-12');
    const january = await stageShare(prisma, garageId, '2028-01');

    expect(december.owner).toBe(1);
    expect(january.owner).toBe(1);
  });

  it('reads February of a leap year to its twenty-ninth day', async () => {
    const { garageId, jobId } = await jobIn('Atelier Dinamo');
    await entry(jobId, 'owner', '2028-02-29T10:00:00Z');
    await entry(jobId, 'owner', '2028-02-29T22:30:00Z');

    const february = await stageShare(prisma, garageId, '2028-02');
    const march = await stageShare(prisma, garageId, '2028-03');

    expect(february.owner).toBe(1);
    expect(march.owner).toBe(1);
  });

  it('answers the same figures twice', async () => {
    const { garageId, jobId } = await jobIn('Atelier Dinamo');
    await entry(jobId, 'owner', '2027-12-10T10:00:00Z');

    const a = await stageShare(prisma, garageId, '2027-12');
    const b = await stageShare(prisma, garageId, '2027-12');

    expect(b).toEqual(a);
  });

  it.each([
    '2027-12 ',
    ' 2027-12',
    '２０２７-12',
    '2027-12-01',
    '',
    '2027-12\n',
  ])('does not answer counts for the month written as %j', async (month) => {
    const { garageId } = await jobIn('Atelier Dinamo');

    await expect(stageShare(prisma, garageId, month)).rejects.toBeInstanceOf(
      Error,
    );
  });

  it('does not answer counts for a garage id that is not a uuid', async () => {
    await expect(
      stageShare(prisma, "x' OR '1'='1", '2027-12'),
    ).rejects.toBeInstanceOf(Error);
  });
});
