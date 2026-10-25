import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews } from '../reviews.testing';

const { bearer, get, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);

const staffList = (garageId: string, auth?: string, query = '') =>
  get(`/garages/${garageId}/reviews${query}`, auth);

const ids = (body: { items: { id: string }[] }) => body.items.map((r) => r.id);

// Atelier Dinamo's team and a driver who reviews it.
async function dinamo() {
  const staff = await team('Atelier Dinamo');
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  return {
    ...staff,
    andrei,
    asOwner: bearer(staff.owner, 'garage'),
    asReceptionist: bearer(staff.receptionist, 'receptionist'),
  };
}

// @traces 074-FR-008 074-FR-017
describe('who may read a garage’s own reviews', () => {
  it('answers the owner with every row open to a reply and a report', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    await review(garage.id, andrei);

    const read = await staffList(garage.id, asOwner);

    expect(read.status).toBe(200);
    expect(read.body.items).toHaveLength(1);
    expect(read.body.items[0]).toMatchObject({
      canReply: true,
      canReport: true,
    });
  });

  it('answers the receptionist with no row open to a reply or a report', async () => {
    const { andrei, asReceptionist, garage } = await dinamo();
    await review(garage.id, andrei);

    const read = await staffList(garage.id, asReceptionist);

    expect(read.status).toBe(200);
    expect(read.body.items[0]).toMatchObject({
      canReply: false,
      canReport: false,
    });
  });

  it.each([['answering'], ['plain']] as const)(
    'refuses a mechanic of the garage (%s) with 403 forbidden',
    async (who) => {
      const staff = await dinamo();

      const read = await staffList(
        staff.garage.id,
        bearer(staff[who], 'mechanic'),
      );

      expect(read.status).toBe(403);
      expect(read.body.code).toBe('forbidden');
    },
  );

  it('answers another garage’s owner, a driver and an admin with one 404 body', async () => {
    const { andrei, garage } = await dinamo();
    const nord = await team('Service Nord');
    const admin = await world.account('Ana Admin', ['admin']);

    const bodies = [];
    for (const auth of [
      bearer(nord.owner, 'garage'),
      bearer(nord.receptionist, 'receptionist'),
      bearer(andrei, 'driver'),
      bearer(admin, 'admin'),
    ]) {
      const read = await staffList(garage.id, auth);
      expect(read.status).toBe(404);
      bodies.push(read.body);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  it('answers 401 with no session', async () => {
    const { garage } = await dinamo();

    const read = await staffList(garage.id);

    expect(read.status).toBe(401);
  });

  // The codes, not_found and validation_failed, are the API's ProblemFilter's,
  // which this module's app leaves out: see
  // apps/api/src/public-routes.integration.spec.ts.
  it.each([['?page=0'], ['?page=-1'], ['?page=x'], ['?page=1.5']])(
    'refuses %s with 400',
    async (query) => {
      const { asOwner, garage } = await dinamo();

      const read = await staffList(garage.id, asOwner, query);

      expect(read.status).toBe(400);
    },
  );

  it('refuses a garage id that is not a uuid with 400', async () => {
    const { asOwner } = await dinamo();

    const read = await staffList('dinamo', asOwner);

    expect(read.status).toBe(400);
  });
});

// @traces 074-FR-004 074-FR-005 074-FR-009
describe('the figures and the list the garage reads', () => {
  it('answers the stored figures, the breakdown of published reviews and a total with the reported ones', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    for (const rating of [5, 5, 4, 3]) {
      await review(garage.id, andrei, { rating });
    }
    await review(garage.id, andrei, { rating: 1, status: 'reported' });
    await prisma.garage.update({
      data: { rating: '4.9', reviewCount: 212 },
      where: { id: garage.id },
    });

    const read = await staffList(garage.id, asOwner);

    expect(read.body).toMatchObject({
      breakdown: { five: 2, four: 1, one: 0, three: 1, two: 0 },
      page: 1,
      pageSize: 20,
      rating: 4.9,
      reviewCount: 212,
      total: 5,
    });
    expect(read.body.items).toHaveLength(5);
  });

  it('answers the same figures as the public read', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    await review(garage.id, andrei, { rating: 4 });
    await prisma.garage.update({
      data: { rating: '4.0', reviewCount: 1 },
      where: { id: garage.id },
    });

    const mine = await staffList(garage.id, asOwner);
    const shown = await get(`/reviews/garage/${garage.id}`, asOwner);

    for (const key of ['rating', 'reviewCount', 'breakdown'] as const) {
      expect(mine.body[key]).toEqual(shown.body[key]);
    }
  });

  it('answers a null rating and no rows for a garage nobody reviewed', async () => {
    const { asOwner, garage } = await dinamo();

    const read = await staffList(garage.id, asOwner);

    expect(read.body).toEqual({
      breakdown: { five: 0, four: 0, one: 0, three: 0, two: 0 },
      items: [],
      page: 1,
      pageSize: 20,
      rating: null,
      reviewCount: 0,
      slug: garage.slug,
      total: 0,
    });
  });

  it.each([['removed'], ['deleted_by_author']] as const)(
    'never lists a %s review',
    async (status) => {
      const { andrei, asOwner, garage } = await dinamo();
      const shown = await review(garage.id, andrei);
      await review(garage.id, andrei, { status });

      const read = await staffList(garage.id, asOwner);

      expect(ids(read.body)).toEqual([shown.id]);
      expect(read.body.total).toBe(1);
    },
  );

  it('lists the newest first, 20 a page, and an empty page past the last with the figures', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    const made = [];
    for (let minutesAgo = 1; minutesAgo <= 21; minutesAgo++) {
      made.push(await review(garage.id, andrei, { minutesAgo }));
    }

    const first = await staffList(garage.id, asOwner);
    const second = await staffList(garage.id, asOwner, '?page=2');
    const past = await staffList(garage.id, asOwner, '?page=3');

    expect(ids(first.body)).toEqual(made.slice(0, 20).map((r) => r.id));
    expect(ids(second.body)).toEqual([made[20].id]);
    expect(past.status).toBe(200);
    expect(past.body).toMatchObject({ items: [], page: 3, total: 21 });
    expect(past.body.breakdown.five).toBe(21);
  });

  it('counts only this garage’s reviews', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    const nord = await world.garage('Service Nord');
    await review(garage.id, andrei, { rating: 4 });
    await review(nord.id, andrei, { rating: 2 });

    const read = await staffList(garage.id, asOwner);

    expect(read.body.total).toBe(1);
    expect(read.body.breakdown.two).toBe(0);
  });
});

// @traces 074-FR-003 074-FR-004 074-FR-010
describe('what each row of the garage’s list shows', () => {
  it('names the car, the included jobs, the author, the mechanic and the status of a job review', async () => {
    const { andrei, answeringMechanic, asOwner, garage } = await dinamo();
    const one = await review(garage.id, andrei, {
      jobs: [
        { nameEn: 'Timing chain kit', nameRo: 'Kit lanț distribuție' },
        { included: false, nameEn: 'Oil change', nameRo: 'Schimb ulei' },
      ],
      rating: 5,
      text: 'Treabă curată.',
    });
    await prisma.review.update({
      data: { mechanicId: answeringMechanic.id },
      where: { id: one.id },
    });

    const read = await staffList(garage.id, asOwner);

    expect(read.body.items[0]).toMatchObject({
      author: { shortName: 'Andrei M.' },
      car: { brand: 'BMW', model: '320d' },
      id: one.id,
      jobs: [{ nameEn: 'Timing chain kit', nameRo: 'Kit lanț distribuție' }],
      mechanic: { shortName: 'Fixer' },
      postedAt: one.postedAt.toISOString(),
      rating: 5,
      source: 'job',
      status: 'published',
      text: 'Treabă curată.',
    });
  });

  it('lists a reported review with its status', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    const hidden = await review(garage.id, andrei, { status: 'reported' });

    const read = await staffList(garage.id, asOwner);

    expect(read.body.items).toEqual([
      expect.objectContaining({ id: hidden.id, status: 'reported' }),
    ]);
    expect(read.body.breakdown.five).toBe(0);
  });

  it('gives a profile review no car, no jobs and no mechanic', async () => {
    const { andrei, answeringMechanic, asOwner, garage } = await dinamo();
    const one = await review(garage.id, andrei, { source: 'profile' });
    await prisma.review.update({
      data: { mechanicId: answeringMechanic.id },
      where: { id: one.id },
    });

    const read = await staffList(garage.id, asOwner);

    expect(read.body.items[0]).toMatchObject({
      car: null,
      jobs: [],
      mechanic: null,
      source: 'profile',
    });
  });

  it('still names a mechanic who is off the public profile', async () => {
    const { andrei, asOwner, garage, plainMechanic } = await dinamo();
    const one = await review(garage.id, andrei);
    await prisma.mechanic.update({
      data: { onProfile: false },
      where: { id: plainMechanic.id },
    });
    await prisma.review.update({
      data: { mechanicId: plainMechanic.id },
      where: { id: one.id },
    });

    const read = await staffList(garage.id, asOwner);

    expect(read.body.items[0].mechanic).toEqual({ shortName: 'Hand' });
  });

  it('carries no plate, phone, e-mail, account id or full surname anywhere', async () => {
    const { andrei, answering, answeringMechanic, asOwner, garage } =
      await dinamo();
    await prisma.account.update({
      data: { phone: '+40712345678' },
      where: { id: andrei },
    });
    const one = await review(garage.id, andrei);
    await prisma.review.update({
      data: { mechanicId: answeringMechanic.id },
      where: { id: one.id },
    });
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: andrei },
    });

    const read = await staffList(garage.id, asOwner);

    const text = JSON.stringify(read.body);
    expect(text).not.toContain('Marin');
    expect(text).not.toContain('+40712345678');
    expect(text).not.toContain(andrei);
    expect(text).not.toContain(answering);
    if (account.email) expect(text).not.toContain(account.email);
    expect(text).not.toMatch(/"plate"|"phone"|"email"|"accountId"/);
  });
});
