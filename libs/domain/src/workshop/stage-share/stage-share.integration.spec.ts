import { stageShare } from './stage-share';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { AuditActorRole } from '../../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

beforeEach(() => world.reset());

async function jobAt(garageName: string) {
  const driver = await world.account('Andrei Marin', ['driver']);
  const garage = await world.garage(garageName);
  const { booking } = await world.chain(driver, garage.id);
  const job = await world.job(booking.id, 'in_work');
  return { garageId: garage.id, jobId: job.id };
}

const entry = (
  jobId: string,
  at: string,
  actorRole: AuditActorRole,
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
describe('the share of job moves by who made them', () => {
  it('counts the garage’s moves of a Bucharest month by role, the automatic ones apart', async () => {
    const { garageId, jobId } = await jobAt('Atelier Dinamo');
    const other = await jobAt('Service Militari');
    await entry(jobId, '2027-12-02T08:00:00Z', 'mechanic');
    await entry(jobId, '2027-12-02T09:00:00Z', 'mechanic');
    await entry(jobId, '2027-12-03T09:00:00Z', 'mechanic');
    await entry(jobId, '2027-12-04T09:00:00Z', 'owner');
    await entry(jobId, '2027-12-05T09:00:00Z', 'receptionist');
    await entry(jobId, '2027-12-06T09:00:00Z', 'admin');
    await entry(jobId, '2027-12-07T09:00:00Z', 'driver');
    await entry(jobId, '2027-12-08T09:00:00Z', 'system', true);
    await entry(jobId, '2027-12-08T10:00:00Z', 'system', true);
    await entry(jobId, '2027-12-09T10:00:00Z', 'mechanic', true);
    await entry(jobId, '2027-12-10T10:00:00Z', 'system');
    await entry(jobId, '2027-11-30T22:30:00Z', 'owner');
    await entry(jobId, '2027-11-30T21:30:00Z', 'owner');
    await entry(jobId, '2027-12-31T22:30:00Z', 'owner');
    await entry(other.jobId, '2027-12-02T08:00:00Z', 'mechanic');

    const share = await stageShare(prisma, garageId, '2027-12');

    expect(share).toEqual({
      admin: 1,
      auto: 3,
      driver: 1,
      mechanic: 3,
      owner: 2,
      receptionist: 1,
      system: 1,
    });
    const month = await prisma.jobStageEntry.count({
      where: {
        at: {
          gte: new Date('2027-11-30T22:00:00Z'),
          lt: new Date('2027-12-31T22:00:00Z'),
        },
        job: { garageId },
      },
    });
    expect(Object.values(share).reduce((a, b) => a + b, 0)).toBe(month);
  });

  it('answers zeros for a month with no move', async () => {
    const { garageId } = await jobAt('Atelier Dinamo');

    expect(await stageShare(prisma, garageId, '2027-12')).toEqual({
      admin: 0,
      auto: 0,
      driver: 0,
      mechanic: 0,
      owner: 0,
      receptionist: 0,
      system: 0,
    });
  });
});
