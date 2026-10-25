import { ReviewsModule } from './reviews.module';
import { garageReviews } from './reviews.testing';
import { quotesApp } from '../quotes/quotes-api.testing';

const { get, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);

async function dinamo() {
  const garage = await world.garage('Atelier Dinamo');
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  return { andrei, garage };
}
const listOf = (garageId: string, query = '') =>
  get(`/reviews/garage/${garageId}${query}`);

// @traces 1367-FR-004
// @traces 1367-FR-008
// @traces 1367-FR-011
describe('the prices and marks of a garage read at the edges', () => {
  it('answers a final price of 1 bani as 1, not null', async () => {
    const { andrei, garage } = await dinamo();
    await review(garage.id, andrei, {
      finalPriceBani: 1,
      quote: { fromBani: 1, toBani: 2 },
    });

    const [item] = (await listOf(garage.id)).body.items;

    expect(item.finalPriceBani).toBe(1);
    expect(item.quote).toEqual({ fromBani: 1, toBani: 2 });
  });

  it('answers a one-bani amount paid as 1', async () => {
    const { andrei, garage } = await dinamo();
    await review(garage.id, andrei, { paidBani: 1 });

    const [item] = (await listOf(garage.id)).body.items;

    expect(item.paidBani).toBe(1);
  });

  it('answers the edited instant with its milliseconds in UTC', async () => {
    const { andrei, garage } = await dinamo();
    await review(garage.id, andrei, {
      editedAt: new Date('2026-12-31T23:59:59.999Z'),
    });

    const [item] = (await listOf(garage.id)).body.items;

    expect(item.editedAt).toBe('2026-12-31T23:59:59.999Z');
  });

  it('carries the new fields on the second page too', async () => {
    const { andrei, garage } = await dinamo();
    for (let i = 0; i < 21; i++) {
      await review(garage.id, andrei, {
        minutesAgo: i + 1,
        paidBani: 1000 + i,
        quote: { fromBani: 1000, toBani: 2000 },
      });
    }

    const second = (await listOf(garage.id, '?page=2')).body.items;

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      paidBani: 1020,
      quote: { fromBani: 1000, toBani: 2000 },
    });
  });

  it('answers a profile review with the amounts null and a job review beside it unchanged', async () => {
    const { andrei, garage } = await dinamo();
    await review(garage.id, andrei, {
      minutesAgo: 1,
      paidBani: 777,
      quote: { fromBani: 500, toBani: 900 },
      source: 'profile',
    });
    await review(garage.id, andrei, {
      minutesAgo: 2,
      paidBani: 888,
      quote: { fromBani: 600, toBani: 700 },
    });

    const items = (await listOf(garage.id)).body.items;

    expect(items.map((i: { source: string }) => i.source)).toEqual([
      'profile',
      'job',
    ]);
    expect(items[0]).toMatchObject({
      finalPriceBani: null,
      paidBani: null,
      quote: null,
    });
    expect(items[1]).toMatchObject({
      paidBani: 888,
      quote: { fromBani: 600, toBani: 700 },
    });
  });

  it('answers the same list twice', async () => {
    const { andrei, garage } = await dinamo();
    await review(garage.id, andrei, { paidBani: 5000 });

    const one = (await listOf(garage.id)).body;
    const two = (await listOf(garage.id)).body;

    expect(two).toEqual(one);
  });

  it('writes nothing when it reads', async () => {
    const { andrei, garage } = await dinamo();
    const made = await review(garage.id, andrei, { paidBani: 5000 });

    await listOf(garage.id);

    const stored = await prisma.review.findUniqueOrThrow({
      where: { id: made.id },
    });
    expect(stored.editedAt).toBeNull();
    expect(stored.paidBani).toBe(5000);
  });
});
