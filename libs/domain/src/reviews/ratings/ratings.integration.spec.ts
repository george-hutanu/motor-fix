import { REVIEW_RATINGS_CONSUMER } from './ratings';
import { ratingsHarness } from './ratings.testing';

const h = ratingsHarness();
const {
  elena,
  garageFigures,
  mechanicFigures,
  prisma,
  review,
  reviews,
  run,
  updates,
  world,
} = h;

// @traces 025-FR-015
// @traces 025-FR-005 025-FR-006 025-FR-007
describe('the figures a review moves', () => {
  it('averages the published reviews of the mechanic and of the garage', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const [first] = await reviews({ garageId: g.id, mechanicId: m.id }, [5, 4]);
    await run(first.id);

    expect(await mechanicFigures(m.id)).toEqual({ count: 2, rating: 4.5 });
    expect(await garageFigures(g.id)).toEqual({ count: 2, rating: 4.5 });

    const third = await review({ garageId: g.id, mechanicId: m.id, rating: 3 });
    await run(third.id);

    expect(await mechanicFigures(m.id)).toEqual({ count: 3, rating: 4 });
    expect(await garageFigures(g.id)).toEqual({ count: 3, rating: 4 });
  });

  it('leaves a reported review out until published again, and a removed one out', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    await reviews({ garageId: g.id, mechanicId: m.id }, [5, 4]);
    const third = await review({
      garageId: g.id,
      mechanicId: m.id,
      rating: 3,
      status: 'reported',
    });
    await run(third.id, 'review.reported');

    expect(await mechanicFigures(m.id)).toEqual({ count: 2, rating: 4.5 });
    expect(await garageFigures(g.id)).toEqual({ count: 2, rating: 4.5 });

    await prisma.review.update({
      data: { status: 'published' },
      where: { id: third.id },
    });
    await run(third.id, 'review.decided');
    expect(await mechanicFigures(m.id)).toEqual({ count: 3, rating: 4 });

    await prisma.review.update({
      data: { status: 'removed' },
      where: { id: third.id },
    });
    await run(third.id, 'review.appeal_decided');
    expect(await mechanicFigures(m.id)).toEqual({ count: 2, rating: 4.5 });
    expect(await garageFigures(g.id)).toEqual({ count: 2, rating: 4.5 });
  });

  it.each([
    ['4,45 up to 4,5', [...Array(9).fill(5), ...Array(11).fill(4)], 4.5],
    ['4,44 down to 4,4', [...Array(11).fill(5), ...Array(14).fill(4)], 4.4],
    ['3,95 up to 4,0', [...Array(19).fill(4), 3], 4],
  ])('rounds %s', async (_, ratings, rating) => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const [one] = await reviews({ garageId: g.id, mechanicId: m.id }, ratings);

    await run(one.id);

    expect(await mechanicFigures(m.id)).toEqual({
      count: ratings.length,
      rating,
    });
  });

  it('empties the rating and counts 0 when no review is published', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const only = await review({ garageId: g.id, mechanicId: m.id, rating: 5 });
    await run(only.id);
    await prisma.review.update({
      data: { status: 'deleted_by_author' },
      where: { id: only.id },
    });

    await run(only.id, 'review.deleted');

    expect(await mechanicFigures(m.id)).toEqual({ count: 0, rating: null });
    expect(await garageFigures(g.id)).toEqual({ count: 0, rating: null });
  });

  it('keeps a mechanic’s reviews when they move garage, and the old garage’s figures', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const nord = await world.garage('Service Nord');
    const m = await elena(dinamo.id);
    const [first] = await reviews(
      { garageId: dinamo.id, mechanicId: m.id },
      [5, 5, 4],
    );
    await run(first.id);
    await prisma.mechanic.update({
      data: { garageId: nord.id },
      where: { id: m.id },
    });

    const there = await review({
      garageId: nord.id,
      mechanicId: m.id,
      rating: 2,
    });
    await run(there.id);

    expect(await mechanicFigures(m.id)).toEqual({ count: 4, rating: 4 });
    expect(await garageFigures(dinamo.id)).toEqual({ count: 3, rating: 4.7 });
    expect(await garageFigures(nord.id)).toEqual({ count: 1, rating: 2 });
  });

  it('counts the reviews of a mechanic hidden from the profile or whose account was deleted', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    await prisma.mechanic.update({
      data: { onProfile: false },
      where: { id: m.id },
    });
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: m.accountId as string },
    });
    const one = await review({ garageId: g.id, mechanicId: m.id, rating: 4 });

    await run(one.id);

    expect(await mechanicFigures(m.id)).toEqual({ count: 1, rating: 4 });
  });
});

// @traces 025-FR-002
describe('a profile review', () => {
  it('counts for its garage and moves no mechanic', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const done = await review({ garageId: g.id, mechanicId: m.id, rating: 5 });
    await run(done.id);
    const profile = await review({
      garageId: g.id,
      rating: 2,
      source: 'profile',
    });

    await run(profile.id);

    expect(profile.mechanicId).toBeNull();
    expect(await garageFigures(g.id)).toEqual({ count: 2, rating: 3.5 });
    expect(await mechanicFigures(m.id)).toEqual({ count: 1, rating: 5 });
  });
});

// @traces 025-FR-008 025-FR-009
describe('running a recalculation', () => {
  it('records one rating.updated per changed subject, garage then mechanic, in their audiences', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const one = await review({ garageId: g.id, mechanicId: m.id, rating: 4 });

    await run(one.id);

    expect(
      (await updates()).map(({ audience, payload, subjectId }) => ({
        audience,
        payload,
        subjectId,
      })),
    ).toEqual([
      {
        audience: [`garage:${g.id}`, `public:garage:${g.id}`, 'public:search'],
        payload: { garageId: g.id, mechanicId: null },
        subjectId: g.id,
      },
      {
        audience: [
          `garage:${g.id}`,
          `public:garage:${g.id}`,
          'public:search',
          `public:mechanic:${m.id}`,
        ],
        payload: { garageId: g.id, mechanicId: m.id },
        subjectId: m.id,
      },
    ]);
  });

  it('names the garage the mechanic works at now in the mechanic’s event', async () => {
    const dinamo = await world.garage('Atelier Dinamo');
    const nord = await world.garage('Service Nord');
    const m = await elena(nord.id);
    const old = await review({
      garageId: dinamo.id,
      mechanicId: m.id,
      rating: 4,
    });

    await run(old.id);

    const [, mechanic] = await updates();
    expect(mechanic.payload).toEqual({ garageId: nord.id, mechanicId: m.id });
  });

  it('writes the same figures twice and records nothing the second time', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const [one] = await reviews({ garageId: g.id, mechanicId: m.id }, [5, 2]);
    await run(one.id);
    const before = await updates();

    await run(one.id);

    expect(await mechanicFigures(m.id)).toEqual({ count: 2, rating: 3.5 });
    expect(await garageFigures(g.id)).toEqual({ count: 2, rating: 3.5 });
    expect(await updates()).toEqual(before);
  });

  it('records nothing for a garage whose figures did not move', async () => {
    const g = await world.garage('Atelier Dinamo');
    const one = await review({ garageId: g.id, rating: 4 });
    await prisma.garage.update({
      data: { rating: 4, reviewCount: 1 },
      where: { id: g.id },
    });

    await run(one.id);

    expect(await updates()).toEqual([]);
  });

  it('ends two runs at once with the right figures and one event each', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const [a, b] = await reviews({ garageId: g.id, mechanicId: m.id }, [5, 3]);

    await Promise.all([run(a.id), run(b.id)]);

    expect(await mechanicFigures(m.id)).toEqual({ count: 2, rating: 4 });
    expect(await garageFigures(g.id)).toEqual({ count: 2, rating: 4 });
    expect((await updates()).map((e) => e.subjectId).sort()).toEqual(
      [g.id, m.id].sort(),
    );
  });
});

// @traces 025-FR-010 025-FR-007
describe('an event the recalculation cannot act on', () => {
  it('logs a review that no longer exists and writes nothing', async () => {
    const g = await world.garage('Atelier Dinamo');
    const one = await review({ garageId: g.id, rating: 4 });
    await prisma.review.delete({ where: { id: one.id } });

    await run(one.id);

    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining(one.id));
    expect(await garageFigures(g.id)).toEqual({ count: 0, rating: null });
    expect(await updates()).toEqual([]);
  });

  it('ignores a kind it does not consume', async () => {
    const g = await world.garage('Atelier Dinamo');
    const one = await review({ garageId: g.id, rating: 4 });

    await run(one.id, 'review.replied');

    expect(await garageFigures(g.id)).toEqual({ count: 0, rating: null });
  });

  it('takes the six review kinds that move a rating off the relay', () => {
    expect(REVIEW_RATINGS_CONSUMER).toMatchObject({
      kinds: [
        'review.posted',
        'review.edited',
        'review.deleted',
        'review.reported',
        'review.decided',
        'review.appeal_decided',
      ],
      queue: 'review-ratings',
    });
  });
});
