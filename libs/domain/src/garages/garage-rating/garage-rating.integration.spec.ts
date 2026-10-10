import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// @traces 226-best-rated-brand-dial-FR-011

const { prisma } = fixtures();
serialDatabase(databaseUrl);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE garage CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Written as SQL: the checks are the database's, whatever a client sends.
const insert = (slug: string, rating: number | null, reviews: number) =>
  prisma.$executeRawUnsafe(
    `INSERT INTO garage (id, name, slug, rating, review_count)
     VALUES (gen_random_uuid(), $1, $1, $2, $3)`,
    slug,
    rating,
    reviews,
  );

describe('a garage rating', () => {
  it('starts with no rating and no reviews', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO garage (id, name, slug) VALUES (gen_random_uuid(), 'new', 'new')`,
    );

    expect(
      await prisma.$queryRawUnsafe(
        `SELECT rating, review_count FROM garage WHERE slug = 'new'`,
      ),
    ).toEqual([{ rating: null, review_count: 0 }]);
  });

  it.each([
    ['no reviews', null, 0],
    ['a rating with its reviews', 4.9, 120],
    ['the lowest rating', 1, 1],
    ['the highest rating', 5, 3],
  ])('keeps %s', async (_, rating, reviews) => {
    await insert('kept', rating, reviews);

    const [row] = await prisma.$queryRawUnsafe<
      { rating: string | null; review_count: number }[]
    >(`SELECT rating::text, review_count FROM garage WHERE slug = 'kept'`);
    expect(row.rating === null ? null : Number(row.rating)).toBe(rating);
    expect(row.review_count).toBe(reviews);
  });

  it.each([
    ['a rating under 1.0', 0.9, 4],
    ['a rating over 5.0', 5.1, 4],
    ['a negative count', null, -1],
    ['a rating with no reviews', 4.5, 0],
    ['reviews with no rating', null, 3],
  ])('refuses %s', async (_, rating, reviews) => {
    await expect(insert('refused', rating, reviews)).rejects.toThrow();
  });

  it('keeps one decimal', async () => {
    await insert('rounded', 4.86, 7);

    const [row] = await prisma.$queryRawUnsafe<{ rating: string }[]>(
      `SELECT rating::text FROM garage WHERE slug = 'rounded'`,
    );
    expect(row.rating).toBe('4.9');
  });
});
