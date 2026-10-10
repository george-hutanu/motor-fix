import { HomeService } from './home.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

type Stance = 'works_on' | 'does_not_take';

const { prisma } = fixtures();
const home = new HomeService(prisma);
serialDatabase(databaseUrl);

let dacia: string;
let tesla: string;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
  tesla = (
    await prisma.brand.create({
      data: { key: 'tesla', name: 'Tesla', slug: 'tesla' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

type At = {
  name?: string;
  rating?: number;
  reviews?: number;
  kind?: 'company' | 'mobile';
  city?: string;
  status?: 'approved' | 'draft' | 'suspended';
  brand?: string;
};

async function garage(slug: string, stance: Stance | undefined, at: At = {}) {
  const { id } = await prisma.garage.create({
    data: {
      businessKind: at.kind,
      name: at.name ?? slug,
      slug,
      status: at.status ?? 'approved',
      ...(at.rating !== undefined && {
        rating: at.rating,
        reviewCount: at.reviews ?? 1,
      }),
      ...(at.city && { cityKey: 'x', cityName: at.city }),
    },
  });
  if (stance) {
    await prisma.garageBrand.create({
      data: {
        brandId: at.brand ?? dacia,
        garageId: id,
        stance,
        ...(stance === 'does_not_take' && {
          diesel: false,
          electric: false,
          hybrid: false,
          petrol: false,
        }),
      },
    });
  }
  return id;
}

const slugs = (answer: { preview: { slug: string }[] }) =>
  answer.preview.map(({ slug }) => slug);

// @traces 226-best-rated-brand-dial-FR-011
describe('garage rating columns', () => {
  const insert = (rating: string | null, count: number) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO garage (id, name, slug, rating, review_count) VALUES (gen_random_uuid(), 'g', 'g-${Math.random()}', ${rating}, ${count})`,
    );

  it.each([
    ['0.9', 1],
    ['0.0', 1],
    ['5.1', 1],
    ['-1.0', 1],
  ])('refuses a rating of %s', async (rating, count) => {
    await expect(insert(rating, count)).rejects.toThrow(
      /garage_(rating|review)/,
    );
  });

  it('refuses a rating with no reviews', async () => {
    await expect(insert('4.0', 0)).rejects.toThrow(/garage_(rating|review)/);
  });

  it('refuses reviews with no rating', async () => {
    await expect(insert(null, 3)).rejects.toThrow(/garage_(rating|review)/);
  });

  it('refuses a negative review count', async () => {
    await expect(insert(null, -1)).rejects.toThrow(/garage_(rating|review)/);
  });

  it('accepts the bounds 1.0 and 5.0 and no rating with no reviews', async () => {
    await expect(insert('1.0', 1)).resolves.toBe(1);
    await expect(insert('5.0', 2147483647)).resolves.toBe(1);
    await expect(insert(null, 0)).resolves.toBe(1);
  });
});

// @traces 226-best-rated-brand-dial-FR-010
describe('HomeService.forBrand ordering at the edges', () => {
  it('ranks 5.0 above 4.9 whatever the review counts, and answers numbers', async () => {
    await garage('many', 'works_on', { rating: 4.9, reviews: 9000 });
    await garage('top', 'works_on', { rating: 5, reviews: 1 });

    const { best } = await home.forBrand('dacia');

    expect(best?.slug).toBe('top');
    expect(best?.rating).toBe(5);
    expect(best?.reviewCount).toBe(1);
  });

  it('ranks the lowest possible rating 1.0 above no rating', async () => {
    await garage('none', 'works_on');
    await garage('one', 'works_on', { rating: 1, reviews: 1 });

    const answer = await home.forBrand('dacia');

    expect(slugs(answer)).toEqual(['one', 'none']);
    expect(answer.preview[0].rating).toBe(1);
    expect(answer.preview[1].rating).toBeNull();
    expect(answer.preview[1].reviewCount).toBe(0);
  });

  it('orders every level at once: rating, reviews, name, id', async () => {
    await garage('e', 'works_on', { name: 'B', rating: 4, reviews: 10 });
    await garage('d', 'works_on', { name: 'A', rating: 4, reviews: 10 });
    await garage('c', 'works_on', { name: 'Z', rating: 4, reviews: 11 });
    await garage('b', 'works_on', { name: 'Z', rating: 4.1, reviews: 1 });

    const all = await home.forBrand('dacia');
    expect(all.best?.slug).toBe('b');
    expect(slugs(all)).toEqual(['b', 'c']);

    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { slug: 'b' },
    });
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { slug: 'c' },
    });
    expect(slugs(await home.forBrand('dacia'))).toEqual(['d', 'e']);
  });

  it('orders unreviewed takers by name, then id, after the reviewed ones', async () => {
    await garage('n2', 'works_on', { name: 'Beta' });
    await garage('n1', 'works_on', { name: 'Alfa' });
    await garage('r', 'works_on', { rating: 1, reviews: 1 });

    expect(slugs(await home.forBrand('dacia'))).toEqual(['r', 'n1']);
  });

  it('orders the refuser slot among refusers and unmarked garages with unreviewed last', async () => {
    await garage('t', 'works_on', { rating: 3, reviews: 1 });
    await garage('silent-unreviewed', undefined, { name: 'A' });
    await garage('refuser', 'does_not_take', { rating: 2, reviews: 1 });
    await garage('silent-top', undefined, { rating: 2, reviews: 5 });

    const answer = await home.forBrand('dacia');

    expect(slugs(answer)).toEqual(['t', 'silent-top']);
    expect(answer.preview[1].stance).toBe('unstated');
  });

  it('does not let a better-rated refuser displace a worse taker', async () => {
    await garage('t1', 'works_on', { rating: 1, reviews: 1 });
    await garage('t2', 'works_on');
    await garage('t3', 'works_on');
    await garage('r', 'does_not_take', { rating: 5, reviews: 500 });

    const answer = await home.forBrand('dacia');

    expect(slugs(answer)).toEqual(['t1', 't2', 'r']);
    expect(answer.takers).toBe(3);
  });
});

// @traces 226-best-rated-brand-dial-FR-002
// @traces 226-best-rated-brand-dial-FR-004
describe('HomeService.forBrand slots', () => {
  it('holds exactly three refusers, best first, when nobody takes the brand and five refuse', async () => {
    for (const [i, rating] of [3, 5, 4, 2, 1].entries()) {
      await garage(`r${i}`, 'does_not_take', { rating, reviews: 1 });
    }

    const answer = await home.forBrand('dacia');

    expect(answer.best).toBeNull();
    expect(slugs(answer)).toEqual(['r1', 'r2', 'r0']);
    expect(answer.takers).toBe(0);
    expect(answer.total).toBe(5);
  });

  it('shows a taker count above the two taker rows when many take the brand', async () => {
    for (let i = 0; i < 12; i++) {
      await garage(`t${i}`, 'works_on', { rating: 4, reviews: i + 1 });
    }

    const answer = await home.forBrand('dacia');

    expect(answer.takers).toBe(12);
    expect(answer.preview).toHaveLength(2);
    expect(slugs(answer)).toEqual(['t11', 't10']);
  });

  it('holds one taker and no empty row when only one garage is listed', async () => {
    await garage('only', 'works_on', { rating: 4.2, reviews: 3 });

    const answer = await home.forBrand('dacia');

    expect(answer.takers).toBe(1);
    expect(slugs(answer)).toEqual(['only']);
    expect(answer.best?.slug).toBe('only');
  });

  it('treats a garage that answered only for another brand as unstated here', async () => {
    await garage('other', 'works_on', { brand: tesla, rating: 5, reviews: 9 });

    const answer = await home.forBrand('dacia');

    expect(answer.best).toBeNull();
    expect(answer.preview).toMatchObject([
      { slug: 'other', stance: 'unstated' },
    ]);
    expect(answer.takers).toBe(0);
  });

  it('never lists a draft or suspended garage in any slot', async () => {
    await garage('d', 'works_on', { rating: 5, status: 'draft' });
    await garage('s', 'does_not_take', { rating: 5, status: 'suspended' });
    await garage('sd', undefined, { rating: 5, status: 'draft' });

    expect(await home.forBrand('dacia')).toMatchObject({
      best: null,
      preview: [],
      total: 0,
    });
  });
});

// @traces 226-best-rated-brand-dial-FR-009
describe('HomeService.forBrand garage text and repeats', () => {
  it('answers a name with markup, quotes and non-ASCII letters verbatim', async () => {
    const name = `<img src=x onerror=alert(1)> "Ăâî" & Șoseaua '😀'`;
    await garage('odd', 'works_on', { city: '<b>Târgu Mureș</b>', name });

    const { best } = await home.forBrand('dacia');

    expect(best?.name).toBe(name);
    expect(best?.city).toBe('<b>Târgu Mureș</b>');
  });

  it('answers a very long name whole', async () => {
    const name = 'A'.repeat(140);
    await garage('long', 'works_on', { name });

    expect((await home.forBrand('dacia')).best?.name).toBe(name);
  });

  it('never gives a mobile mechanic a city, even one stored on its row, with no place', async () => {
    await garage('mob', 'works_on', { city: 'București', kind: 'mobile' });

    const { best } = await home.forBrand('dacia');

    expect(best?.businessKind).toBe('mobile');
    expect(best).not.toHaveProperty('city');
  });

  it('answers the same twice and puts best first in the preview', async () => {
    await garage('a', 'works_on', { rating: 4, reviews: 2 });
    await garage('b', 'does_not_take', { rating: 4, reviews: 2 });

    const first = await home.forBrand('dacia');
    const second = await home.forBrand('dacia');

    expect(second).toEqual(first);
    expect(first.best).toEqual(first.preview[0]);
  });
});
