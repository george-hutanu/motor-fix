import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews } from '../reviews.testing';

const { bearer, get, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);

const PATH = '/admin/review-reports';

// Atelier Dinamo's team, an admin, and one job review its owner reported.
async function setting() {
  const dinamo = await team('Atelier Dinamo');
  const admin = await world.account('Ana Admin', ['admin']);
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  const one = await review(dinamo.garage.id, andrei, { rating: 1 });
  await prisma.reviewReport.create({
    data: {
      dueAt: new Date(Date.now() + 47 * 3_600_000),
      reason: 'insults',
      reporterId: dinamo.owner,
      reviewId: one.id,
      source: 'garage',
    },
  });
  return { admin, andrei, dinamo, review: one };
}

// @traces 177-FR-001 177-FR-014 177-FR-018
describe('GET /admin/review-reports', () => {
  it('answers an admin the pending reports', async () => {
    const { admin, review: one } = await setting();

    const res = await get(PATH, bearer(admin, 'admin'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(res.body.items[0].review.id).toBe(one.id);
    expect(res.body.items[0].facts.job.work).toBe('Kit lanț distribuție');
  });

  it('answers in English for an admin who reads English', async () => {
    const { admin } = await setting();
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: admin },
    });

    const res = await get(PATH, bearer(admin, 'admin'));

    expect(res.body.items[0].facts.job.work).toBe('Timing chain kit');
  });

  it('does not exist for anyone else', async () => {
    const { andrei, dinamo } = await setting();
    const others = [
      bearer(dinamo.owner, 'garage'),
      bearer(dinamo.receptionist, 'receptionist'),
      bearer(dinamo.answering, 'mechanic'),
      bearer(andrei, 'driver'),
    ];

    for (const auth of others) {
      const res = await get(PATH, auth);
      // The API's filter names it not_found (admin-routes spec).
      expect(res.status).toBe(404);
    }
  });

  it('asks a visitor to sign in', async () => {
    await setting();

    const res = await get(PATH);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('refuses a suspended admin', async () => {
    const { admin } = await setting();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id: admin },
    });

    const res = await get(PATH, bearer(admin, 'admin'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
  });

  it.each(['0', '-1', 'x', '1.5'])('refuses page=%s', async (page) => {
    const { admin } = await setting();

    const res = await get(`${PATH}?page=${page}`, bearer(admin, 'admin'));

    expect(res.status).toBe(400);
  });

  it('reads the asked page', async () => {
    const { admin } = await setting();

    const res = await get(`${PATH}?page=2`, bearer(admin, 'admin'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], page: 2, total: 1 });
  });
});
