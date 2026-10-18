import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException } from '@nestjs/common';

import type { GarageSearchCache } from './garage-search.cache';
import { GarageSearchService } from './garage-search.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { Prisma } from '../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { watchGarageReads } from '../area/area.testing';
import { SearchLogService } from '../search-log/search-log.service';

type Stance = 'works_on' | 'does_not_take';
type Status = 'approved' | 'draft' | 'suspended';
type Page = Awaited<ReturnType<GarageSearchService['forBrand']>>;

const reader = countedMetrics();
const searches = (outcome: string) =>
  counterTotal(reader, 'motorfix_searches_total', { outcome });
const { prisma } = fixtures();
// PostgreSQL's answer every time: the cases change rows between reads, and
// garage-search.cache.integration.spec.ts covers the cache.
const uncached = {
  entry: (_key, read) => read(),
} satisfies Pick<GarageSearchCache, 'entry'> as unknown as GarageSearchCache;
const search = new GarageSearchService(
  prisma,
  uncached,
  new SearchLogService(prisma),
);
serialDatabase(databaseUrl);

let dacia: string;
let tesla: string;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, brand, garage CASCADE');
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

async function garage(
  name: string,
  answers: { brandId?: string; stance?: Stance; status?: Status } = {},
) {
  const { id } = await prisma.garage.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID()}`,
      status: answers.status ?? 'approved',
    },
  });
  if (answers.stance) {
    await prisma.garageBrand.create({
      data: {
        brandId: answers.brandId ?? dacia,
        garageId: id,
        stance: answers.stance,
        ...(answers.stance === 'does_not_take' && {
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

async function everyPage(brandId: string) {
  const pages: Page[] = [await search.forBrand(brandId)];
  while (pages.at(-1)?.nextCursor && pages.length < 10) {
    pages.push(
      await search.forBrand(brandId, pages.at(-1)?.nextCursor ?? undefined),
    );
  }
  return pages;
}

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
}

const tamper = (cursor: string, change: Record<string, unknown>) =>
  Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(cursor, 'base64url').toString()),
      ...change,
    }),
  ).toString('base64url');

// @traces 879-FR-009
// @traces 267-FR-001 267-FR-002 267-FR-003 267-FR-024
describe('counting searches', () => {
  it('counts a first page with garages as results, an empty one as none, and no later page or refused search', async () => {
    const [results, none] = [await searches('results'), await searches('none')];

    await search.forBrand(dacia);
    await search.forBrand(randomUUID()).catch(() => undefined);
    for (let i = 0; i < 21; i++) {
      await garage(`Garage ${String(i).padStart(2, '0')}`, {
        stance: 'works_on',
      });
    }
    const first = await search.forBrand(dacia);
    expect(first.nextCursor).not.toBeNull();
    await search.forBrand(dacia, first.nextCursor ?? undefined);

    expect(await searches('results')).toBe(results + 1);
    expect(await searches('none')).toBe(none + 1);
  });
});

describe('GarageSearchService.forBrand', () => {
  it('lists the approved garages that take the brand first, then the rest with their answer', async () => {
    await garage('Gamma Service', { stance: 'does_not_take' });
    await garage('Beta Auto', { stance: 'works_on' });
    await garage('Zeta Motors', { stance: 'does_not_take' });
    await garage('Delta Motors', { stance: 'works_on' });
    await garage('Epsilon Auto', { brandId: tesla, stance: 'works_on' });
    await garage('Alfa Service', { stance: 'works_on' });
    await garage('Aaron Suspended', {
      stance: 'works_on',
      status: 'suspended',
    });
    await garage('Aaron Draft', { stance: 'works_on', status: 'draft' });

    const page = await search.forBrand(dacia);

    expect(page.items.map(({ name, stance }) => [name, stance])).toEqual([
      ['Alfa Service', 'works_on'],
      ['Beta Auto', 'works_on'],
      ['Delta Motors', 'works_on'],
      ['Epsilon Auto', 'unstated'],
      ['Gamma Service', 'does_not_take'],
      ['Zeta Motors', 'does_not_take'],
    ]);
    expect(page).toMatchObject({
      counts: { doesNotTake: 3, worksOn: 3 },
      nextCursor: null,
      total: 6,
    });
  });

  it('gives each garage its id, name, slug and answer, and nothing else', async () => {
    const id = await garage('Alfa Service', { stance: 'works_on' });
    const { slug } = await prisma.garage.findUniqueOrThrow({ where: { id } });

    const page = await search.forBrand(dacia);

    expect(page.items).toEqual([
      {
        brandNote: null,
        businessKind: null,
        doesNotTake: [],
        facilities: [],
        id,
        labourFromLei: null,
        name: 'Alfa Service',
        rating: null,
        refusalPhrase: null,
        reviewCount: 0,
        slug,
        stance: 'works_on',
        worksOn: [{ id: dacia, name: 'Dacia', slug: 'dacia' }],
      },
    ]);
    expect(Object.keys(page.items[0]).sort()).toEqual([
      'brandNote',
      'businessKind',
      'doesNotTake',
      'facilities',
      'id',
      'labourFromLei',
      'name',
      'rating',
      'refusalPhrase',
      'reviewCount',
      'slug',
      'stance',
      'worksOn',
    ]);
  });

  it("carries each garage's two brand lists, its note and its phrase", async () => {
    const bmw = (
      await prisma.brand.create({
        data: { key: 'bmw', name: 'BMW', popularity: 1, slug: 'bmw' },
      })
    ).id;
    await prisma.brand.update({
      data: { popularity: 2 },
      where: { id: dacia },
    });
    const first = await garage('Alfa Service', { stance: 'works_on' });
    await prisma.garageBrand.create({
      data: { brandId: bmw, garageId: first, stance: 'works_on' },
    });
    await prisma.garageBrand.create({
      data: {
        brandId: tesla,
        diesel: false,
        electric: false,
        garageId: first,
        hybrid: false,
        petrol: false,
        stance: 'does_not_take',
      },
    });
    await prisma.garage.update({
      data: {
        brandNote: 'Specializați pe cutii automate.',
        refusalPhrase: 'Nu lucrăm pe electrice',
      },
      where: { id: first },
    });
    await garage('Beta Auto', { stance: 'does_not_take' });
    await garage('Delta Motors');
    await garage('Aaron Suspended', {
      stance: 'works_on',
      status: 'suspended',
    });

    const page = await search.forBrand(dacia);

    expect(
      page.items.map(
        ({ brandNote, doesNotTake, name, refusalPhrase, stance, worksOn }) => ({
          brandNote,
          doesNotTake: doesNotTake.map((brand) => brand.name),
          name,
          refusalPhrase,
          stance,
          worksOn: worksOn.map((brand) => brand.name),
        }),
      ),
    ).toEqual([
      {
        brandNote: 'Specializați pe cutii automate.',
        doesNotTake: ['Tesla'],
        name: 'Alfa Service',
        refusalPhrase: 'Nu lucrăm pe electrice',
        stance: 'works_on',
        worksOn: ['BMW', 'Dacia'],
      },
      {
        brandNote: null,
        doesNotTake: ['Dacia'],
        name: 'Beta Auto',
        refusalPhrase: null,
        stance: 'does_not_take',
        worksOn: [],
      },
      {
        brandNote: null,
        doesNotTake: [],
        name: 'Delta Motors',
        refusalPhrase: null,
        stance: 'unstated',
        worksOn: [],
      },
    ]);
  });

  it('lists every garage in the second group when none takes the brand', async () => {
    for (const name of ['Alfa', 'Beta', 'Delta', 'Gamma', 'Zeta']) {
      await garage(name, {
        stance: name === 'Beta' ? 'does_not_take' : undefined,
      });
    }

    const page = await search.forBrand(dacia);

    expect(page.items.map((item) => item.name)).toEqual([
      'Alfa',
      'Beta',
      'Delta',
      'Gamma',
      'Zeta',
    ]);
    expect(page).toMatchObject({
      counts: { doesNotTake: 5, worksOn: 0 },
      total: 5,
    });
  });

  it('answers an empty page when no garage is approved', async () => {
    await garage('Alfa', { stance: 'works_on', status: 'draft' });

    expect(await search.forBrand(dacia)).toEqual({
      brand: { id: dacia, name: 'Dacia', slug: 'dacia' },
      counts: { doesNotTake: 0, worksOn: 0 },
      items: [],
      nextCursor: null,
      total: 0,
    });
  });

  it('still answers for a brand retired from the catalogue', async () => {
    await prisma.brand.update({
      data: { active: false },
      where: { id: dacia },
    });
    await garage('Alfa', { stance: 'works_on' });

    const page = await search.forBrand(dacia);

    expect(page.items.map((item) => item.stance)).toEqual(['works_on']);
  });

  it('refuses a brand that does not exist with not found', async () => {
    expect(await refusal(search.forBrand(randomUUID()))).toMatchObject({
      body: { code: 'not_found' },
      status: 404,
    });
  });

  it('pages 48 garages 20 at a time with the 30 takers first, none repeated or skipped', async () => {
    const answers: (Stance | undefined)[] = [
      ...Array<Stance>(5).fill('works_on'),
      'does_not_take',
      undefined,
      undefined,
    ];
    for (let n = 0; n < 48; n += 1) {
      await garage(`Garage ${String(n + 1).padStart(2, '0')}`, {
        stance: answers[n % 8],
      });
    }

    const pages = await everyPage(dacia);
    const items = pages.flatMap((page) => page.items);

    expect(pages.map((page) => page.items.length)).toEqual([20, 20, 8]);
    expect(new Set(items.map((item) => item.id)).size).toBe(48);
    expect(items.slice(0, 30).every((item) => item.stance === 'works_on')).toBe(
      true,
    );
    expect(items.slice(30).some((item) => item.stance === 'works_on')).toBe(
      false,
    );
    const names = (group: Page['items']) => group.map((item) => item.name);
    expect(names(items.slice(0, 30))).toEqual(names(items.slice(0, 30)).sort());
    expect(names(items.slice(30))).toEqual(names(items.slice(30)).sort());
    expect(pages.map(({ counts, total }) => ({ counts, total }))).toEqual(
      Array(3).fill({ counts: { doesNotTake: 18, worksOn: 30 }, total: 48 }),
    );
    expect(pages.at(-1)?.nextCursor).toBeNull();
  });

  it('settles garages with the same name by id across a page break', async () => {
    const ids: string[] = [];
    for (let n = 0; n < 22; n += 1) {
      ids.push(await garage('Service Auto', { stance: 'works_on' }));
    }

    const items = (await everyPage(dacia)).flatMap((page) => page.items);

    expect(items.map((item) => item.id)).toEqual([...ids].sort());
  });

  it('goes on to the next page when the last garage listed was suspended meanwhile', async () => {
    for (let n = 0; n < 22; n += 1) {
      await garage(`Garage ${String(n).padStart(2, '0')}`, {
        stance: 'works_on',
      });
    }
    const first = await search.forBrand(dacia);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: first.items.at(-1)?.id },
    });

    const next = await search.forBrand(dacia, first.nextCursor ?? undefined);

    expect(next.items.map((item) => item.name)).toEqual([
      'Garage 20',
      'Garage 21',
    ]);
  });

  describe('refuses a cursor that is not a page of this search', () => {
    let cursor: string;

    beforeEach(async () => {
      for (let n = 0; n < 21; n += 1) {
        await garage(`Garage ${String(n + 1).padStart(2, '0')}`, {
          stance: 'works_on',
        });
      }
      cursor = (await search.forBrand(dacia)).nextCursor ?? '';
    });

    it.each([
      ['undecodable', () => 'not a cursor'],
      ['for another brand', () => tamper(cursor, { b: tesla })],
      ['naming no group', () => tamper(cursor, { g: 'later' })],
      [
        'with an id that is not a uuid',
        () => tamper(cursor, { i: 'garage-1' }),
      ],
      [
        'for a garage that does not exist',
        () => tamper(cursor, { i: randomUUID() }),
      ],
    ])('%s', async (_, cursorOf) => {
      expect(await refusal(search.forBrand(dacia, cursorOf()))).toMatchObject({
        body: { code: 'invalid_cursor' },
        status: 400,
      });
    });
  });

  it('writes nothing while it searches', async () => {
    await garage('Alfa', { stance: 'works_on' });
    const before = await Promise.all([
      prisma.activityLog.count(),
      prisma.outboxEvent.count(),
    ]);

    await search.forBrand(dacia);
    await refusal(search.forBrand(randomUUID()));

    expect(
      await Promise.all([
        prisma.activityLog.count(),
        prisma.outboxEvent.count(),
      ]),
    ).toEqual(before);
  });
});

async function card(
  name: string,
  fields: Prisma.GarageUpdateInput,
  facilities: ('courtesy_car' | 'pickup_dropoff' | 'waiting_area')[] = [],
) {
  const id = await garage(name, { stance: 'works_on' });
  await prisma.garage.update({ data: fields, where: { id } });
  for (const facility of facilities) {
    await prisma.garageFacility.create({ data: { facility, garageId: id } });
  }
  return id;
}

// @traces 267-FR-003
describe('what a card shows', () => {
  it('carries the rating, reviews, rate in whole lei, kind, city and facilities in catalogue order', async () => {
    await card(
      'Alfa Service',
      {
        businessKind: 'company',
        cityKey: 'militari',
        cityName: 'Militari',
        labourFromBani: 17_950,
        rating: 4.8,
        reviewCount: 90,
      },
      ['waiting_area', 'courtesy_car'],
    );

    const [item] = (await search.forBrand(dacia)).items;

    expect(item).toMatchObject({
      businessKind: 'company',
      city: 'Militari',
      facilities: ['courtesy_car', 'waiting_area'],
      labourFromLei: 180,
      rating: 4.8,
      reviewCount: 90,
    });
    expect(item).not.toHaveProperty('serviceRadiusKm');
  });

  it('rounds the rate to the nearest leu', async () => {
    await card('Alfa', { labourFromBani: 18_049 });
    await card('Beta', { labourFromBani: 18_050 });

    const items = (await search.forBrand(dacia)).items;

    expect(items.map((item) => item.labourFromLei)).toEqual([180, 181]);
  });

  it("gives a mobile mechanic its area and never its seat's city", async () => {
    await card('Mecanic Ion', {
      businessKind: 'mobile',
      cityKey: 'militari',
      cityName: 'Militari',
      serviceRadiusKm: 35,
    });
    await card('Mecanic Dan', { businessKind: 'mobile' });

    const items = (await search.forBrand(dacia)).items;

    expect(items.map((item) => item.serviceRadiusKm)).toEqual([20, 35]);
    for (const item of items) {
      expect(item).not.toHaveProperty('city');
      expect(item.businessKind).toBe('mobile');
    }
  });

  it('leaves the city out when it is not known', async () => {
    await card('Alfa', { businessKind: 'pfa' });

    const [item] = (await search.forBrand(dacia)).items;

    expect(item).not.toHaveProperty('city');
    expect(item).not.toHaveProperty('serviceRadiusKm');
  });

  it('carries nothing private', async () => {
    await card('Alfa', {
      address: 'Strada Lungă 1',
      latitude: 44.43,
      longitude: 26.1,
      phone: '+40712345678',
    });

    const [item] = (await search.forBrand(dacia)).items;

    expect(JSON.stringify(item)).not.toMatch(/Strada|\+4071|44\.43|26\.1/);
  });
});

// @traces 267-FR-004
describe('naming the brand', () => {
  it('finds the brand by its slug as by its id, and names it in the answer', async () => {
    await garage('Alfa', { stance: 'works_on' });

    const bySlug = await search.forBrand({ slug: 'dacia' });
    const byId = await search.forBrand(dacia);

    expect(bySlug.brand).toEqual({ id: dacia, name: 'Dacia', slug: 'dacia' });
    expect(bySlug).toEqual(byId);
  });

  it('refuses a slug that names no brand with not found', async () => {
    expect(await refusal(search.forBrand({ slug: 'trabant' }))).toMatchObject({
      body: { code: 'not_found' },
      status: 404,
    });
  });

  it('pages on from a cursor when the brand is named by its slug', async () => {
    for (let n = 0; n < 21; n += 1) {
      await garage(`Garage ${String(n).padStart(2, '0')}`, {
        stance: 'works_on',
      });
    }
    const first = await search.forBrand({ slug: 'dacia' });

    const next = await search.forBrand(
      { slug: 'dacia' },
      first.nextCursor ?? undefined,
    );

    expect(next.items.map((item) => item.name)).toEqual(['Garage 20']);
  });
});

// A garage with its rating and reviews; an unrated one has no reviews.
async function rated(
  name: string,
  rating: number | null,
  stance?: Stance,
  reviewCount = rating === null ? 0 : 1,
) {
  const id = await garage(name, { stance });
  await prisma.garage.update({
    data: { rating, reviewCount },
    where: { id },
  });
  return id;
}

type Row = { id: string; name: string; rating: number | null; reviews: number };

// The order of a group: rating high to low with the unrated last, then more
// reviews, then the name, then the id.
const byOrder = (a: Row, b: Row) =>
  (b.rating ?? -1) - (a.rating ?? -1) ||
  b.reviews - a.reviews ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
  (a.id < b.id ? -1 : 1);

// @traces 267-FR-001
describe('the order of a group', () => {
  it('ranks by rating, then reviews, then name, with the unrated last in each group', async () => {
    await rated('Alfa', 4.8, 'works_on', 10);
    await rated('Beta', 4.8, 'works_on', 30);
    await rated('Gama', 4.9, 'works_on', 2);
    await rated('Aaron', null, 'works_on');
    await rated('Abel', 4.8, 'works_on', 30);
    await rated('Zeta', null, 'does_not_take');
    await rated('Yota', 3, undefined, 1);
    await rated('Beta Noua', null);

    const page = await search.forBrand(dacia);

    expect(page.items.map((item) => item.name)).toEqual([
      'Gama',
      'Abel',
      'Beta',
      'Alfa',
      'Aaron',
      'Yota',
      'Beta Noua',
      'Zeta',
    ]);
  });
});

const RATINGS = [5, 4.5, null, 4.5];

// The n-th of a list full of ties: four ratings, two review counts, five
// names, the first 25 taking the brand.
async function mixed(n: number) {
  const rating = RATINGS[n % 4] ?? null;
  const reviews = rating === null ? 0 : 1 + Number(n % 3 === 0);
  const name = `Service ${n % 5}`;
  const taker = n < 25;
  const stance: Stance | undefined = taker ? 'works_on' : undefined;
  const id = await rated(name, rating, stance, reviews);
  return { id, name, rating, reviews, taker };
}

// @traces 267-FR-002
describe('paging the order', () => {
  it('pages 45 garages with equal ratings, equal reviews and unrated ones, none repeated or skipped', async () => {
    const rows: (Row & { taker: boolean })[] = [];
    for (let n = 0; n < 45; n += 1) rows.push(await mixed(n));

    const pages = await everyPage(dacia);
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));

    expect(pages.map((page) => page.items.length)).toEqual([20, 20, 5]);
    expect(ids).toEqual(
      [
        ...rows.filter((row) => row.taker).sort(byOrder),
        ...rows.filter((row) => !row.taker).sort(byOrder),
      ].map((row) => row.id),
    );
  });

  it('goes on from a boundary suspended since, by its rating read back', async () => {
    for (let n = 0; n < 21; n += 1) {
      const rating = Math.round((5 - n / 10) * 10) / 10;
      await rated(
        `Garage ${String(20 - n).padStart(2, '0')}`,
        rating,
        'works_on',
      );
    }
    const first = await search.forBrand(dacia);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: first.items.at(-1)?.id },
    });

    const next = await search.forBrand(dacia, first.nextCursor ?? undefined);

    expect(first.items.at(-1)?.name).toBe('Garage 01');
    expect(next.items.map((item) => item.name)).toEqual(['Garage 00']);
  });
});

// Cluj-Napoca; a hundredth of a degree of latitude is about 1.1 km.
const CLUJ = { lat: 46.771, lng: 23.624 };

async function at(name: string, dLat: number, radiusKm?: number) {
  const id = await garage(name, { stance: 'works_on' });
  await prisma.garage.update({
    data: {
      latitude: CLUJ.lat + dLat,
      longitude: CLUJ.lng,
      ...(radiusKm !== undefined && {
        businessKind: 'mobile',
        seatAddress: 'Strada Sediului 1, Cluj-Napoca',
        serviceRadiusKm: radiusKm,
      }),
    },
    where: { id },
  });
  return id;
}

// @traces 267-FR-005
describe('the radius', () => {
  beforeEach(async () => {
    await at('Aproape', 0.1);
    await at('La 33 km', 0.3);
    await at('La 55 km', 0.5);
    await at('Mobil 20', 0.3, 20);
    await at('Mobil 35', 0.3, 35);
  });

  const names = (page: Page) => page.items.map((item) => item.name);

  it('reads 25 km by default and 50 km when asked, for fixed garages only', async () => {
    expect(names(await search.forBrand(dacia, undefined, CLUJ))).toEqual([
      'Aproape',
      'Mobil 35',
    ]);
    expect(names(await search.forBrand(dacia, undefined, CLUJ, 50))).toEqual([
      'Aproape',
      'La 33 km',
      'Mobil 35',
    ]);
  });

  it('ignores the radius without a place', async () => {
    const page = await search.forBrand(dacia, undefined, undefined, 50);

    expect(page.total).toBe(5);
  });
});

// @traces 271-garage-distance-FR-011
describe('reading the area', () => {
  it('counts and pages both groups of the area by the area itself, never by the ids an earlier read found', async () => {
    for (let n = 0; n < 21; n += 1) {
      await at(`Taker ${String(n).padStart(2, '0')}`, 0.01 * (n + 1));
    }
    const other = await garage('Zeta');
    await prisma.garage.update({
      data: { latitude: CLUJ.lat + 0.05, longitude: CLUJ.lng },
      where: { id: other },
    });
    await at('Far taker', 0.5);

    const reads = watchGarageReads(prisma);
    try {
      const first = await search.forBrand(dacia, undefined, CLUJ);
      const shownFirst = first.items.map((item) => item.id);
      const [countedFirst, listedFirst] = [reads.counted(), reads.listed()];
      const second = await search.forBrand(
        dacia,
        first.nextCursor ?? undefined,
        CLUJ,
      );
      const shownSecond = second.items.map((item) => item.id);

      expect(first.counts).toEqual({ doesNotTake: 1, worksOn: 21 });
      expect(first.items).toHaveLength(20);
      expect(first.items[0]).toMatchObject({
        distanceKm: 1.1,
        name: 'Taker 00',
      });
      expect(second.items.map((item) => item.name)).toEqual([
        'Taker 20',
        'Zeta',
      ]);
      expect(countedFirst).toEqual([]);
      expect(reads.counted()).toEqual([]);
      expect(shownFirst).toEqual(expect.arrayContaining(listedFirst.flat()));
      expect([...shownFirst, ...shownSecond]).toEqual(
        expect.arrayContaining(reads.listed().flat()),
      );
      expect(
        reads
          .listed()
          .slice(listedFirst.length)
          .every((list) => list.every((id) => shownSecond.includes(id))),
      ).toBe(true);
    } finally {
      reads.restore();
    }
  });
});

// @traces 267-FR-006
describe('refreshing the cards shown', () => {
  it('answers only the public garages among the ids, in the order of the search, with its counts', async () => {
    const low = await rated('Alfa', 3, 'works_on');
    const high = await rated('Beta', 5, 'works_on');
    const other = await rated('Gama', 4.5, 'does_not_take');
    await rated('Delta', 4, 'works_on');
    const hidden = await garage('Epsilon', {
      stance: 'works_on',
      status: 'suspended',
    });
    const before = await searches('results');

    const page = await search.byIds(dacia, [
      other,
      hidden,
      low,
      randomUUID(),
      high,
    ]);

    expect(page.items.map((item) => item.id)).toEqual([high, low, other]);
    expect(page).toMatchObject({
      brand: { id: dacia, name: 'Dacia', slug: 'dacia' },
      counts: { doesNotTake: 1, worksOn: 3 },
      nextCursor: null,
      total: 4,
    });
    expect(await searches('results')).toBe(before);
  });

  it('carries the distance when the search has a place', async () => {
    const near = await at('Aproape', 0.1);

    const [item] = (await search.byIds(dacia, [near], CLUJ)).items;

    expect(item).toMatchObject({ comesToYou: false, distanceKm: 11.1 });
  });
});

// A box over Cluj reaching 0.35° north: past the 25 km circle, short of
// 'La 55 km'.
const BOX = {
  east: CLUJ.lng + 0.1,
  north: CLUJ.lat + 0.35,
  south: CLUJ.lat - 0.05,
  west: CLUJ.lng - 0.1,
};
const OTHER_BOX = { ...BOX, north: CLUJ.lat + 0.36 };
// The row is written on the next turn of the event loop.
const settled = () => new Promise((resolve) => setTimeout(resolve, 50));

// @traces 269-FR-005
// @traces 269-FR-006
// @traces 269-FR-021
describe('the list of a box on the map', () => {
  const names = (page: Page) => page.items.map((item) => item.name);

  it('lists the fixed garages inside the box, past the radius, and the mobile mechanics over the place', async () => {
    await at('Aproape', 0.1);
    await at('La 33 km', 0.3);
    await at('La 55 km', 0.5);
    await at('Mobil 20', 0.3, 20);
    await at('Mobil 35', 0.3, 35);

    const page = await search.forBrand(dacia, undefined, CLUJ, 25, false, BOX);

    expect(names(page)).toEqual(['Aproape', 'La 33 km', 'Mobil 35']);
    expect(page.total).toBe(3);
  });

  it('ignores the radius', async () => {
    await at('Aproape', 0.1);
    await at('La 33 km', 0.3);
    await at('La 55 km', 0.5);

    const narrow = await search.forBrand(
      dacia,
      undefined,
      CLUJ,
      25,
      false,
      BOX,
    );
    const wide = await search.forBrand(dacia, undefined, CLUJ, 50, false, BOX);

    expect(wide).toEqual(narrow);
  });

  it('lists no mobile mechanic for a box alone', async () => {
    await at('Aproape', 0.1);
    await at('Mobil 35', 0.1, 35);

    const page = await search.forBrand(
      dacia,
      undefined,
      undefined,
      undefined,
      false,
      BOX,
    );

    expect(names(page)).toEqual(['Aproape']);
  });

  it('keeps the groups, their order, the counts and the distances from the place', async () => {
    const low = await rated('Alfa', 3, 'works_on');
    const high = await rated('Beta', 5, 'works_on');
    const other = await rated('Gama', 4.5, 'does_not_take');
    for (const id of [low, high, other]) {
      await prisma.garage.update({
        data: { latitude: CLUJ.lat + 0.1, longitude: CLUJ.lng },
        where: { id },
      });
    }

    const page = await search.forBrand(dacia, undefined, CLUJ, 25, false, BOX);

    expect(page.items.map((item) => item.id)).toEqual([high, low, other]);
    expect(page).toMatchObject({
      counts: { doesNotTake: 1, worksOn: 2 },
      total: 3,
    });
    expect(page.items[0]).toMatchObject({
      comesToYou: false,
      distanceKm: 11.1,
    });
  });

  describe('paging', () => {
    let cursor: string;

    beforeEach(async () => {
      for (let n = 0; n < 21; n += 1) {
        await at(`Garage ${String(n).padStart(2, '0')}`, 0.01);
      }
      cursor =
        (await search.forBrand(dacia, undefined, CLUJ, 25, false, BOX))
          .nextCursor ?? '';
    });

    it('pages on with a cursor of the same box', async () => {
      const next = await search.forBrand(dacia, cursor, CLUJ, 25, false, BOX);

      expect(names(next)).toEqual(['Garage 20']);
    });

    it.each([
      ['of another box', () => [cursor, OTHER_BOX] as const],
      ['of the box, without it', () => [cursor, undefined] as const],
    ])('refuses a cursor %s', async (_, args) => {
      const [given, box] = args();

      expect(
        await refusal(search.forBrand(dacia, given, CLUJ, 25, false, box)),
      ).toMatchObject({ body: { code: 'invalid_cursor' }, status: 400 });
    });

    it('refuses a cursor of the circle search in a box', async () => {
      const circle = (await search.forBrand(dacia, undefined, CLUJ)).nextCursor;

      expect(
        await refusal(
          search.forBrand(dacia, circle ?? undefined, CLUJ, 25, false, BOX),
        ),
      ).toMatchObject({ body: { code: 'invalid_cursor' }, status: 400 });
    });
  });

  it('writes no search log row when asked to log a box, as it does for the search itself', async () => {
    await at('Aproape', 0.1);

    await search.forBrand(dacia, undefined, CLUJ, 25, true, BOX);
    await settled();
    expect(await prisma.searchLog.count()).toBe(0);

    await search.forBrand(dacia, undefined, CLUJ, 25, true);
    await settled();
    expect(await prisma.searchLog.count()).toBe(1);
  });

  it('counts no search for a move of the map', async () => {
    await at('Aproape', 0.1);
    const before = await searches('results');

    await search.forBrand(dacia, undefined, CLUJ, 25, false, BOX);

    expect(await searches('results')).toBe(before);
  });

  it("reads the cards shown again with the box's counts", async () => {
    const near = await at('Aproape', 0.1);
    await at('La 33 km', 0.3);

    const page = await search.byIds(dacia, [near], CLUJ, 25, BOX);

    expect(page.items.map((item) => item.id)).toEqual([near]);
    expect(page.total).toBe(2);
  });
});
