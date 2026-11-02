import { stageShare } from './stage-share';
import { serialDatabase } from '../../auth/serial-db.testing';
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

// @traces 122-FR-012
describe('the share of job moves, edge cases', () => {
  it('answers seven zeros for a garage with no moves and for an unknown garage', async () => {
    const { garageId } = await jobIn('Atelier Dinamo');

    const empty = await stageShare(prisma, garageId, '2027-12');
    const unknown = await stageShare(
      prisma,
      '00000000-0000-4000-8000-000000000000',
      '2027-12',
    );

    expect(empty).toEqual(ZERO);
    expect(unknown).toEqual(ZERO);
  });

  it('puts the instants either side of a clock change in the right Bucharest month', async () => {
    const { garageId, jobId } = await jobIn('Atelier Dinamo');
    const at = (iso: string) =>
      prisma.jobStageEntry.create({
        data: {
          actorRole: 'owner',
          at: new Date(iso),
          fromStatus: 'in_work',
          jobId,
          toStatus: 'paused',
        },
      });
    await at('2027-10-31T21:59:59.999Z');
    await at('2027-10-31T22:00:00.000Z');
    await at('2027-03-27T22:00:00.000Z');
    await at('2027-03-31T20:59:59.999Z');
    await at('2027-03-31T21:00:00.000Z');

    const october = await stageShare(prisma, garageId, '2027-10');
    const november = await stageShare(prisma, garageId, '2027-11');
    const march = await stageShare(prisma, garageId, '2027-03');
    const april = await stageShare(prisma, garageId, '2027-04');

    expect(october.owner).toBe(1);
    expect(november.owner).toBe(1);
    expect(march.owner).toBe(2);
    expect(april.owner).toBe(1);
  });

  it('counts a ten-thousand-move month and keeps the sum equal to the rows', async () => {
    const { garageId, jobId } = await jobIn('Atelier Dinamo');
    await prisma.jobStageEntry.createMany({
      data: Array.from({ length: 10_000 }, (_, i) => ({
        actorRole: i % 2 ? ('mechanic' as const) : ('system' as const),
        at: new Date('2027-12-10T10:00:00Z'),
        auto: i % 5 === 0,
        fromStatus: 'in_work' as const,
        jobId,
        toStatus: 'paused' as const,
      })),
    });

    const share = await stageShare(prisma, garageId, '2027-12');

    expect(share).toEqual({
      ...ZERO,
      auto: 2000,
      mechanic: 4000,
      system: 4000,
    });
  });

  it.each(['2027-13', '2027-00', '2027-1', 'december', "2027-12'; --"])(
    'does not answer counts for the malformed month %s',
    async (month) => {
      const { garageId } = await jobIn('Atelier Dinamo');

      await expect(stageShare(prisma, garageId, month)).rejects.toBeInstanceOf(
        Error,
      );
    },
  );
});
