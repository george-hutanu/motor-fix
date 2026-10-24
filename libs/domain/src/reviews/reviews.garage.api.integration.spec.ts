import { randomUUID } from 'node:crypto';

import { ReviewsModule } from './reviews.module';
import { garageReviews } from './reviews.testing';
import { quotesApp } from '../quotes/quotes-api.testing';

const { get, world } = quotesApp([ReviewsModule]);
const { prisma } = world;

const { review } = garageReviews(world);

const listOf = (garageId: string, query = '') =>
  get(`/reviews/garage/${garageId}${query}`);

const ids = (body: { items: { id: string }[] }) => body.items.map((r) => r.id);

async function dinamo() {
  const garage = await world.garage('Atelier Dinamo');
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  return { andrei, garage };
}

// @traces 024-FR-003
// @traces 024-FR-016
// @traces 024-FR-019
describe('the figures of a garage’s reviews', () => {
  it('answers the garage’s stored rating and count with the breakdown of its published reviews', async () => {
    const { andrei, garage } = await dinamo();
    for (const rating of [5, 5, 5, 4, 4, 3, 1]) {
      await review(garage.id, andrei, { rating });
    }
    await prisma.garage.update({
      data: { rating: '4.9', reviewCount: 212 },
      where: { id: garage.id },
    });

    const read = await listOf(garage.id);

    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      breakdown: { five: 3, four: 2, one: 1, three: 1, two: 0 },
      page: 1,
      pageSize: 20,
      rating: 4.9,
      reviewCount: 212,
      total: 7,
    });
  });

  it('answers a null rating, a zero count and an empty breakdown for a garage nobody reviewed', async () => {
    const { garage } = await dinamo();

    const read = await listOf(garage.id);

    expect(read.status).toBe(200);
    expect(read.body).toEqual({
      breakdown: { five: 0, four: 0, one: 0, three: 0, two: 0 },
      items: [],
      page: 1,
      pageSize: 20,
      rating: null,
      reviewCount: 0,
      total: 0,
    });
  });

  it.each([['reported'], ['removed'], ['deleted_by_author']] as const)(
    'leaves a %s review out of the list, the breakdown and the total',
    async (status) => {
      const { andrei, garage } = await dinamo();
      const shown = await review(garage.id, andrei, { rating: 5 });
      await review(garage.id, andrei, { rating: 1, status });

      const read = await listOf(garage.id);

      expect(ids(read.body)).toEqual([shown.id]);
      expect(read.body.breakdown).toEqual({
        five: 1,
        four: 0,
        one: 0,
        three: 0,
        two: 0,
      });
      expect(read.body.total).toBe(1);
    },
  );

  it('lists and counts a reported review again once it is published again', async () => {
    const { andrei, garage } = await dinamo();
    const hidden = await review(garage.id, andrei, {
      rating: 1,
      status: 'reported',
    });
    await prisma.review.update({
      data: { status: 'published' },
      where: { id: hidden.id },
    });

    const read = await listOf(garage.id);

    expect(ids(read.body)).toEqual([hidden.id]);
    expect(read.body.breakdown.one).toBe(1);
  });

  it('counts only this garage’s reviews', async () => {
    const { andrei, garage } = await dinamo();
    const other = await world.garage('Service Nord');
    await review(garage.id, andrei, { rating: 4 });
    await review(other.id, andrei, { rating: 2 });

    const read = await listOf(garage.id);

    expect(read.body.total).toBe(1);
    expect(read.body.breakdown).toEqual({
      five: 0,
      four: 1,
      one: 0,
      three: 0,
      two: 0,
    });
  });
});

// @traces 024-FR-004
// @traces 024-FR-007
// @traces 024-FR-017
describe('what a garage’s review shows', () => {
  it('names the car, the included jobs, the score, the text, the author and the date', async () => {
    const { andrei, garage } = await dinamo();
    const one = await review(garage.id, andrei, {
      jobs: [
        { nameEn: 'Timing chain kit', nameRo: 'Kit lanț distribuție' },
        { included: false, nameEn: 'Oil change', nameRo: 'Schimb ulei' },
        { nameEn: 'Brake pads', nameRo: 'Plăcuțe frână' },
      ],
      rating: 5,
      text: 'Treabă curată.',
    });

    const [item] = (await listOf(garage.id)).body.items;

    expect(item).toEqual({
      author: { shortName: 'Andrei M.' },
      car: expect.objectContaining({ brand: 'BMW', model: '320d' }),
      id: one.id,
      jobs: [
        expect.objectContaining({
          nameEn: 'Timing chain kit',
          nameRo: 'Kit lanț distribuție',
        }),
        expect.objectContaining({
          nameEn: 'Brake pads',
          nameRo: 'Plăcuțe frână',
        }),
      ],
      postedAt: one.postedAt.toISOString(),
      rating: 5,
      source: 'job',
      text: 'Treabă curată.',
    });
  });

  it('answers null text for a rating without one', async () => {
    const { andrei, garage } = await dinamo();
    await review(garage.id, andrei, { text: null });

    const [item] = (await listOf(garage.id)).body.items;

    expect(item.text).toBeNull();
  });

  it('gives a review written from the profile no car and no jobs', async () => {
    const { andrei, garage } = await dinamo();
    await review(garage.id, andrei, { source: 'profile' });

    const [item] = (await listOf(garage.id)).body.items;

    expect(item.source).toBe('profile');
    expect(item.car).toBeNull();
    expect(item.jobs).toEqual([]);
  });

  it('shows a one-word name as it is', async () => {
    const { garage } = await dinamo();
    const elena = await world.account('Elena', ['driver']);
    await review(garage.id, elena);

    const [item] = (await listOf(garage.id)).body.items;

    expect(item.author).toEqual({ shortName: 'Elena' });
  });

  it('names a deleted author by the stand-in and keeps the review', async () => {
    const { andrei, garage } = await dinamo();
    await review(garage.id, andrei);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: andrei },
    });

    const read = await listOf(garage.id);

    expect(read.body.items[0].author).toEqual({ shortName: 'Șofer MotorFix' });
    expect(read.body.total).toBe(1);
  });

  it('carries no plate, phone, e-mail, account id, mechanic or full surname', async () => {
    const { andrei, garage } = await dinamo();
    await prisma.account.update({
      data: { email: 'andrei.marin@example.com', phone: '+40722111222' },
      where: { id: andrei },
    });
    const mechanic = await prisma.mechanic.create({
      data: { garageId: garage.id, name: 'Ionuț Vasile', onProfile: true },
    });
    const one = await review(garage.id, andrei);
    await prisma.review.update({
      data: { mechanicId: mechanic.id },
      where: { id: one.id },
    });

    const body = JSON.stringify((await listOf(garage.id)).body);

    for (const secret of [
      'B123ABC',
      '+40722111222',
      'andrei.marin@example.com',
      andrei,
      mechanic.id,
      'Ionuț',
      'Marin',
    ]) {
      expect(body).not.toContain(secret);
    }
  });
});

// @traces 024-FR-004
// @traces 024-FR-016
// @traces 024-FR-018
describe('the pages of a garage’s reviews', () => {
  it('lists 20 a page, newest first, and the rest on the next page', async () => {
    const { andrei, garage } = await dinamo();
    const made = [];
    for (let i = 0; i < 21; i++) {
      made.push(await review(garage.id, andrei, { minutesAgo: i + 1 }));
    }

    const one = await listOf(garage.id);
    const two = await listOf(garage.id, '?page=2');

    expect(ids(one.body)).toEqual(made.slice(0, 20).map((r) => r.id));
    expect(ids(two.body)).toEqual([made[20].id]);
    expect([one.body.total, two.body.total]).toEqual([21, 21]);
  });

  it('orders reviews posted at the same moment by id, newest id first', async () => {
    const { andrei, garage } = await dinamo();
    const a = await review(garage.id, andrei);
    const b = await review(garage.id, andrei);
    await prisma.review.updateMany({
      data: { postedAt: new Date('2026-03-14T10:00:00Z') },
      where: { id: { in: [a.id, b.id] } },
    });

    const read = await listOf(garage.id);

    expect(ids(read.body)).toEqual([a.id, b.id].sort().reverse());
  });

  it('answers an empty page with the real total past the last page', async () => {
    const { andrei, garage } = await dinamo();
    await review(garage.id, andrei);

    const read = await listOf(garage.id, '?page=9');

    expect(read.status).toBe(200);
    expect(read.body.items).toEqual([]);
    expect(read.body.total).toBe(1);
  });

  it.each([['0'], ['-1'], ['1.5'], ['x']])(
    'refuses page %p with 400 validation_failed',
    async (page) => {
      const { garage } = await dinamo();

      const refused = await listOf(garage.id, `?page=${page}`);

      expect([refused.status, refused.body.code]).toEqual([
        400,
        'validation_failed',
      ]);
    },
  );

  it('refuses an id that is not a uuid with 400', async () => {
    expect((await listOf('dinamo')).status).toBe(400);
  });

  it.each([['draft'], ['suspended']] as const)(
    'answers 404 not_found for a %s garage, with the body of an unknown one',
    async (status) => {
      const { andrei, garage } = await dinamo();
      await review(garage.id, andrei);
      await prisma.garage.update({
        data: { status },
        where: { id: garage.id },
      });

      const hidden = await listOf(garage.id);
      const unknown = await listOf(randomUUID());

      expect([hidden.status, hidden.body.code]).toEqual([404, 'not_found']);
      expect(hidden.body).toEqual(unknown.body);
    },
  );
});

// @traces 024-FR-020
describe('reading a garage’s reviews', () => {
  it('writes no row, emits no event and records no audit entry', async () => {
    const { andrei, garage } = await dinamo();
    await review(garage.id, andrei);
    const before = await Promise.all([
      prisma.outboxEvent.count(),
      prisma.activityLog.count(),
      prisma.review.findMany({ orderBy: { id: 'asc' } }),
    ]);

    await listOf(garage.id);

    const after = await Promise.all([
      prisma.outboxEvent.count(),
      prisma.activityLog.count(),
      prisma.review.findMany({ orderBy: { id: 'asc' } }),
    ]);
    expect(after).toEqual(before);
  });
});
