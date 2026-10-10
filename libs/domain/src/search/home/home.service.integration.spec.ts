import { HttpException } from '@nestjs/common';

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
      data: { key: 'dacia', name: 'Dacia', popularity: 7, slug: 'dacia' },
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

const refused = (stance: Stance) =>
  stance === 'does_not_take' && {
    diesel: false,
    electric: false,
    hybrid: false,
    petrol: false,
  };

async function garage(
  slug: string,
  answers: [string, Stance][] = [],
  status: 'approved' | 'draft' | 'suspended' = 'approved',
) {
  const { id } = await prisma.garage.create({
    data: { name: slug, slug, status },
  });
  for (const [brandId, stance] of answers) {
    await prisma.garageBrand.create({
      data: { brandId, garageId: id, stance, ...refused(stance) },
    });
  }
}

describe('HomeService.forBrand', () => {
  it('counts every listed garage and those that work on the brand', async () => {
    await garage('takes', [[dacia, 'works_on']]);
    await garage('takes-both', [
      [dacia, 'works_on'],
      [tesla, 'works_on'],
    ]);
    await garage('refuses', [[dacia, 'does_not_take']]);
    await garage('other-brand-only', [[tesla, 'works_on']]);
    await garage('silent');

    expect(await home.forBrand('dacia')).toEqual({
      best: expect.objectContaining({ stance: 'works_on' }),
      brand: { id: dacia, name: 'Dacia', popularity: 7, slug: 'dacia' },
      preview: [
        expect.objectContaining({ slug: 'takes' }),
        expect.objectContaining({ slug: 'takes-both' }),
        expect.objectContaining({ slug: 'other-brand-only' }),
      ],
      takers: 2,
      total: 5,
    });
  });

  it('leaves draft and suspended garages out of both counts', async () => {
    await garage('listed', [[dacia, 'works_on']]);
    await garage('draft', [[dacia, 'works_on']], 'draft');
    await garage('suspended', [[dacia, 'works_on']], 'suspended');

    expect(await home.forBrand('dacia')).toMatchObject({
      takers: 1,
      total: 1,
    });
  });

  it('answers zero of zero before any garage is listed', async () => {
    expect(await home.forBrand('tesla')).toMatchObject({
      brand: { popularity: null, slug: 'tesla' },
      takers: 0,
      total: 0,
    });
  });

  it.each([
    ['a retired brand', 'dacia'],
    ['an unknown slug', 'lada'],
  ])('refuses %s with not_found', async (_, slug) => {
    await prisma.brand.update({
      data: { active: false },
      where: { id: dacia },
    });

    const error = await home.forBrand(slug).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'not_found',
    });
  });
});

// @traces 226-FR-009
// @traces 226-FR-010
// @traces 226-FR-002
// @traces 226-FR-004

type Rated = {
  name?: string;
  rating?: number;
  reviews?: number;
  labourFromBani?: number;
  city?: string;
  businessKind?: 'company' | 'pfa' | 'ii' | 'mobile';
  status?: 'approved' | 'draft' | 'suspended';
};

// A listed garage with its answer for Dacia (none when stance is undefined).
async function rated(slug: string, stance: Stance | undefined, at: Rated = {}) {
  const { id } = await prisma.garage.create({
    data: {
      businessKind: at.businessKind,
      labourFromBani: at.labourFromBani,
      name: at.name ?? slug,
      slug,
      status: at.status ?? 'approved',
      ...(at.rating !== undefined && {
        rating: at.rating,
        reviewCount: at.reviews ?? 1,
      }),
      ...(at.city && {
        cityKey: at.city.toLowerCase().replace(/[^a-z]+/g, '-'),
        cityName: at.city,
      }),
    },
  });
  if (stance) {
    await prisma.garageBrand.create({
      data: { brandId: dacia, garageId: id, stance, ...refused(stance) },
    });
  }
  return id;
}

const slugs = (answer: { preview: { slug: string }[] }) =>
  answer.preview.map(({ slug }) => slug);

describe('HomeService.forBrand: the best garage', () => {
  it('names the highest rating first, then the one with more reviews', async () => {
    await rated('many-lower', 'works_on', { rating: 4.7, reviews: 300 });
    await rated('fewer', 'works_on', { rating: 4.9, reviews: 80 });
    await rated('more', 'works_on', { rating: 4.9, reviews: 120 });

    const answer = await home.forBrand('dacia');

    expect(answer.best?.slug).toBe('more');
    expect(slugs(answer)).toEqual(['more', 'fewer']);
  });

  it('lets the name decide between equal ratings and equal reviews', async () => {
    await rated('zeta', 'works_on', {
      name: 'Zeta',
      rating: 4.9,
      reviews: 120,
    });
    await rated('alfa', 'works_on', {
      name: 'Alfa',
      rating: 4.9,
      reviews: 120,
    });

    expect(slugs(await home.forBrand('dacia'))).toEqual(['alfa', 'zeta']);
  });

  it('lets the id decide between equal names', async () => {
    const ids = [
      await rated('twin-1', 'works_on', { name: 'Twin', rating: 4 }),
      await rated('twin-2', 'works_on', { name: 'Twin', rating: 4 }),
    ];

    const answer = await home.forBrand('dacia');

    expect(answer.preview.map(({ id }) => id)).toEqual([...ids].sort());
  });

  it('puts a taker with no reviews after every reviewed one', async () => {
    await rated('aaa-new', 'works_on');
    await rated('low', 'works_on', { rating: 1, reviews: 1 });

    const answer = await home.forBrand('dacia');

    expect(answer.best?.slug).toBe('low');
    expect(answer.preview[1]).toMatchObject({
      rating: null,
      reviewCount: 0,
      slug: 'aaa-new',
    });
  });

  it('answers the garage as Home shows it, without a place', async () => {
    const id = await rated('militari', 'works_on', {
      businessKind: 'company',
      city: 'București',
      labourFromBani: 18050,
      name: 'Service Auto Militari',
      rating: 4.9,
      reviews: 120,
    });

    const answer = await home.forBrand('dacia');

    expect(answer.best).toEqual({
      businessKind: 'company',
      city: 'București',
      id,
      labourFromLei: 181,
      name: 'Service Auto Militari',
      rating: 4.9,
      reviewCount: 120,
      slug: 'militari',
      stance: 'works_on',
    });
    expect(answer.preview[0]).toEqual(answer.best);
  });

  it('answers no rate, no kind and no city when the garage has none', async () => {
    await rated('bare', 'works_on');

    expect((await home.forBrand('dacia')).best).toEqual({
      businessKind: null,
      id: expect.any(String),
      labourFromLei: null,
      name: 'bare',
      rating: null,
      reviewCount: 0,
      slug: 'bare',
      stance: 'works_on',
    });
  });

  it('never names the city of a mobile mechanic', async () => {
    await rated('mobil', 'works_on', {
      businessKind: 'mobile',
      city: 'Cluj-Napoca',
      rating: 4.8,
    });

    const { best } = await home.forBrand('dacia');

    expect(best).toMatchObject({ businessKind: 'mobile', slug: 'mobil' });
    expect(best).not.toHaveProperty('city');
  });

  it.each(['draft', 'suspended'] as const)(
    'never names a %s garage',
    async (status) => {
      await rated('hidden', 'works_on', { rating: 5, reviews: 900, status });
      await rated('hidden-refuser', 'does_not_take', {
        rating: 5,
        reviews: 900,
        status,
      });
      await rated('listed', 'works_on', { rating: 3 });

      const answer = await home.forBrand('dacia');

      expect(answer.best?.slug).toBe('listed');
      expect(slugs(answer)).toEqual(['listed']);
    },
  );
});

describe('HomeService.forBrand: the preview', () => {
  it('holds the two best takers, then the best garage that refuses or never said', async () => {
    await rated('t3', 'works_on', { rating: 4.7 });
    await rated('t1', 'works_on', { rating: 4.9 });
    await rated('t2', 'works_on', { rating: 4.8 });
    await rated('refuses', 'does_not_take', { rating: 4 });
    await rated('unmarked', undefined, { rating: 4.5 });

    const answer = await home.forBrand('dacia');

    expect(answer.preview.map(({ slug, stance }) => [slug, stance])).toEqual([
      ['t1', 'works_on'],
      ['t2', 'works_on'],
      ['unmarked', 'unstated'],
    ]);
  });

  it('puts the refusing garage in the third slot when it is the best of the rest', async () => {
    await rated('t1', 'works_on', { rating: 4.9 });
    await rated('t2', 'works_on', { rating: 4.8 });
    await rated('refuses', 'does_not_take', { rating: 4.6 });
    await rated('unmarked', undefined, { rating: 4.2 });

    const { preview } = await home.forBrand('dacia');

    expect(preview[2]).toMatchObject({
      slug: 'refuses',
      stance: 'does_not_take',
    });
  });

  it('never fills a missing taker with a refuser', async () => {
    await rated('only-taker', 'works_on', { rating: 3 });
    await rated('r1', 'does_not_take', { rating: 5 });
    await rated('r2', 'does_not_take', { rating: 4.9 });

    expect(slugs(await home.forBrand('dacia'))).toEqual(['only-taker', 'r1']);
  });

  it('shows only the rows that exist', async () => {
    await rated('only-taker', 'works_on', { rating: 3 });

    expect(slugs(await home.forBrand('dacia'))).toEqual(['only-taker']);
  });

  it('answers no best and up to three refusers when nobody takes the brand', async () => {
    await rated('r4', 'does_not_take', { rating: 3 });
    await rated('r1', 'does_not_take', { rating: 5 });
    await rated('r2', undefined, { rating: 4.9 });
    await rated('r3', 'does_not_take', { rating: 4 });

    const answer = await home.forBrand('dacia');

    expect(answer.best).toBeNull();
    expect(slugs(answer)).toEqual(['r1', 'r2', 'r3']);
    expect(answer.takers).toBe(0);
  });

  it('answers no best and no rows before any garage is listed', async () => {
    expect(await home.forBrand('dacia')).toMatchObject({
      best: null,
      preview: [],
      takers: 0,
      total: 0,
    });
  });
});

// Cluj-Napoca; a hundredth of a degree of latitude is about 1.1 km.
const CLUJ = { lat: 46.771, lng: 23.624 };

async function near(
  slug: string,
  dLat: number,
  stance: Stance | undefined,
  at: Rated & { radiusKm?: number } = {},
) {
  await rated(slug, stance, {
    city: at.radiusKm ? undefined : 'Cluj-Napoca',
    ...at,
    ...(at.radiusKm && { businessKind: 'mobile' as const }),
  });
  await prisma.garage.update({
    data: {
      latitude: CLUJ.lat + dLat,
      longitude: CLUJ.lng,
      ...(at.radiusKm && {
        seatAddress: 'Strada Sediului 1',
        serviceRadiusKm: at.radiusKm,
      }),
    },
    where: { slug },
  });
}

describe('HomeService.forBrand near a place', () => {
  beforeEach(async () => {
    await near('in-taker', 0.01, 'works_on', { rating: 4.5 });
    await near('in-refuser', 0.1, 'does_not_take', { rating: 4.4 });
    await near('mobile-in', 0.27, 'works_on', { radiusKm: 35, rating: 4.6 });
    await near('mobile-out', 0.27, 'works_on', { radiusKm: 20, rating: 5 });
    await near('far-taker', 0.5, 'works_on', { rating: 5 });
  });

  it('ranks only the garages in the area, with their distance', async () => {
    const answer = await home.forBrand('dacia', CLUJ);

    expect(slugs(answer)).toEqual(['mobile-in', 'in-taker', 'in-refuser']);
    expect(answer.preview[1]).toMatchObject({
      city: 'Cluj-Napoca',
      comesToYou: false,
      distanceKm: 1.1,
    });
  });

  it('says a mobile mechanic in its area comes to the place, with no distance or city', async () => {
    const { best } = await home.forBrand('dacia', CLUJ);

    expect(best).toMatchObject({
      businessKind: 'mobile',
      comesToYou: true,
      distanceKm: null,
      slug: 'mobile-in',
    });
    expect(best).not.toHaveProperty('city');
  });

  it('ranks all of Romania without a place, with no distance', async () => {
    const answer = await home.forBrand('dacia');

    expect(slugs(answer)).toEqual(['far-taker', 'mobile-out', 'in-refuser']);
    expect(answer.best).not.toHaveProperty('distanceKm');
    expect(answer.best).not.toHaveProperty('comesToYou');
  });

  it('answers no best, no rows and no garage for a place with none near it', async () => {
    expect(
      await home.forBrand('dacia', { lat: 44.43, lng: 26.1 }),
    ).toMatchObject({ best: null, preview: [], takers: 0, total: 0 });
  });
});
