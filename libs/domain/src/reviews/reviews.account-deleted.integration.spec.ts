// @traces 129-FR-010
import { ReviewsModule } from './reviews.module';
import { mechanicReviews } from './reviews.testing';
import { quotesApp } from '../quotes/quotes-api.testing';

const { get, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { elena, reviewed } = mechanicReviews(world);

describe('a review by a deleted account', () => {
  it('names its author "Șofer MotorFix" on the mechanic page, with no other mark', async () => {
    const s = await elena();
    await reviewed(s.driver, s.nord.id, s.mechanic.id, 1);
    await prisma.account.update({
      data: { email: null, name: '', status: 'deleted' },
      where: { id: s.driver },
    });

    const read = await get(`/reviews/mechanic/${s.mechanic.id}`);

    expect(read.status).toBe(200);
    expect(read.body.items).toHaveLength(1);
    expect(read.body.items[0].author).toEqual({ shortName: 'Șofer MotorFix' });
  });

  it('keeps the short name of an author whose account stays', async () => {
    const s = await elena();
    await reviewed(s.driver, s.nord.id, s.mechanic.id, 1);

    const read = await get(`/reviews/mechanic/${s.mechanic.id}`);

    expect(read.body.items[0].author).toEqual({ shortName: 'Andrei M.' });
  });
});
