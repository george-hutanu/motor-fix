import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews } from '../reviews.testing';

const { bearer, get, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);

const PATH = '/admin/review-reports';
const HOUR = 3_600_000;

async function setting(text = 'Treabă curată.') {
  const dinamo = await team('Atelier Dinamo');
  const admin = await world.account('Ana Admin', ['admin']);
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  const one = await review(dinamo.garage.id, andrei, { rating: 1, text });
  const report = await prisma.reviewReport.create({
    data: {
      dueAt: new Date(Date.now() + 47 * HOUR),
      reason: 'other',
      reviewId: one.id,
      source: 'garage',
      text: '<img src=x onerror=alert(1)>',
    },
  });
  return { admin, andrei, dinamo, report, review: one };
}

// @traces 177-FR-001
describe('GET /admin/review-reports under hostile queries', () => {
  it.each([
    '99999999999',
    '9007199254740993',
    '1e3',
    '%2B1',
    '0x10',
    '%20',
    '',
    '%EF%BC%91',
    '1&page=2',
    '2147483648',
  ])(
    'answers page=%s with a 4xx or an empty page, never a 500',
    async (page) => {
      const { admin } = await setting();

      const res = await get(`${PATH}?page=${page}`, bearer(admin, 'admin'));

      expect(res.status).toBeLessThan(500);
      if (res.status === 200)
        expect(res.body.items.length).toBeLessThanOrEqual(20);
    },
  );

  it('refuses an array page', async () => {
    const { admin } = await setting();

    const res = await get(`${PATH}?page[]=1`, bearer(admin, 'admin'));

    expect(res.status).toBe(400);
  });

  it('keeps the page size at 20 whatever the query asks', async () => {
    const { admin } = await setting();

    const res = await get(
      `${PATH}?pageSize=1000&limit=1000&take=1000`,
      bearer(admin, 'admin'),
    );

    if (res.status === 200) expect(res.body.pageSize).toBe(20);
    else expect(res.status).toBe(400);
  });
});

// @traces 177-FR-002 177-FR-014
describe('GET /admin/review-reports under hostile data', () => {
  it('carries no e-mail, phone or account id of the author or the reporter', async () => {
    const { admin, andrei, dinamo } = await setting();
    await prisma.account.update({
      data: { email: 'andrei.secret@example.test', phone: '+40712345678' },
      where: { id: andrei },
    });

    const res = await get(PATH, bearer(admin, 'admin'));
    const body = JSON.stringify(res.body);

    expect(res.status).toBe(200);
    expect(body).not.toContain('andrei.secret@example.test');
    expect(body).not.toContain('40712345678');
    expect(body).not.toContain(andrei);
    expect(body).not.toContain(dinamo.owner);
    expect(body).not.toContain('Ion Marin');
  });

  it('returns report and review text verbatim as data, not escaped or cut', async () => {
    const hostile = '<script>alert(1)</script> Ștefan 🚗 {garage}';
    const { admin } = await setting(hostile);

    const res = await get(PATH, bearer(admin, 'admin'));

    expect(res.body.items[0].review.text).toBe(hostile);
    expect(res.body.items[0].report.text).toBe('<img src=x onerror=alert(1)>');
  });

  it('counts identical reviews case-sensitively and ignores the author’s deleted ones', async () => {
    const { admin, andrei, dinamo, review: one } = await setting('Same text');
    const other = await world.garage('Altul');
    await review(other.id, andrei, { text: '  Same text  ' });
    await review(other.id, andrei, { text: 'same text' });
    await review(other.id, andrei, {
      status: 'deleted_by_author',
      text: 'Same text',
    });

    const res = await get(PATH, bearer(admin, 'admin'));

    expect(res.body.items[0].review.id).toBe(one.id);
    expect(res.body.items[0].facts.identicalReviews).toBe(1);
    expect(dinamo.garage.id).toBe(res.body.items[0].garage.id);
  });

  it('answers 21 pending reports as a page of 20 and a page of 1', async () => {
    const { admin, andrei, dinamo } = await setting();
    for (let i = 0; i < 20; i++) {
      const one = await review(dinamo.garage.id, andrei, { text: `t${i}` });
      await prisma.reviewReport.create({
        data: {
          dueAt: new Date(Date.now() + HOUR),
          reason: 'insults',
          reviewId: one.id,
          source: 'garage',
        },
      });
    }

    const first = await get(PATH, bearer(admin, 'admin'));
    const second = await get(`${PATH}?page=2`, bearer(admin, 'admin'));
    const ids = [...first.body.items, ...second.body.items].map(
      (i: { report: { id: string } }) => i.report.id,
    );

    expect(first.body.items).toHaveLength(20);
    expect(second.body.items).toHaveLength(1);
    expect(new Set(ids).size).toBe(21);
    expect(first.body.total).toBe(21);
  });

  it('answers a non-admin holding the admin role of a suspended session as 404 or 403, never the queue', async () => {
    const { andrei } = await setting();

    const res = await get(PATH, bearer(andrei, 'admin'));

    expect([401, 403, 404]).toContain(res.status);
  });
});
