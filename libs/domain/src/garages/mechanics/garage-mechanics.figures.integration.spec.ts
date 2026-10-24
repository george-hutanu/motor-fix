import { GarageMechanicsService } from './garage-mechanics.service';
import type { AuditPort } from '../../audit/audit.port';
import type { Actor } from '../../auth/policy';
import { ratingsHarness } from '../../reviews/ratings/ratings.testing';

const { elena, prisma, reviews, run, world } = ratingsHarness();

// @traces 055-FR-001 055-FR-016
describe("the team's figures", () => {
  it('reads 58 reviews for a mechanic with 40 here and 18 at a previous garage', async () => {
    const nord = await world.garage('Service Nord');
    const dinamo = await world.garage('Atelier Dinamo');
    const m = await elena(nord.id);
    const [before] = await reviews(
      { garageId: nord.id, mechanicId: m.id },
      Array(18).fill(4),
    );
    await run(before.id);
    await prisma.mechanic.update({
      data: { garageId: dinamo.id },
      where: { id: m.id },
    });
    const [here] = await reviews(
      { garageId: dinamo.id, mechanicId: m.id },
      Array(40).fill(5),
    );
    await run(here.id);

    const owner = {
      accountId: await world.account('Mihai Pop', ['garage']),
      garageId: dinamo.id,
      role: 'garage',
    } as Actor;
    const { items } = await new GarageMechanicsService({} as AuditPort).list(
      prisma,
      owner,
      dinamo.id,
    );

    expect(items).toEqual([
      expect.objectContaining({ id: m.id, rating: '4.7', reviewCount: 58 }),
    ]);
  });
});
