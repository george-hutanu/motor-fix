import { randomUUID } from 'node:crypto';

import { ReviewsModule } from './reviews.module';
import type { ReviewStatus } from '../generated/prisma/enums';
import { quotesApp } from '../quotes/quotes-api.testing';

const { get, world } = quotesApp([ReviewsModule]);
const { prisma } = world;

async function setting() {
  const dinamo = await world.garage('Atelier Dinamo');
  const nord = await world.garage('Service Nord');
  const account = await world.account('Elena Pop', ['mechanic']);
  const mechanic = await prisma.mechanic.create({
    data: {
      accountId: account,
      garageId: nord.id,
      name: 'Elena',
      onProfile: true,
    },
  });
  const driver = await world.account('Andrei Ion Marin', ['driver']);
  return { dinamo, driver, mechanic, nord };
}

async function reviewed(
  driverId: string,
  garageId: string,
  mechanicId: string | null,
  minutesAgo: number,
  extra: { status?: ReviewStatus; text?: string | null } = {},
) {
  const { booking } = await world.chain(driverId, garageId);
  const job = await world.job(booking.id, 'done', {
    mechanicId: mechanicId ?? undefined,
  });
  return prisma.review.create({
    data: {
      driverId,
      garageId,
      jobId: job.id,
      mechanicId,
      postedAt: new Date(Date.now() - minutesAgo * 60_000),
      rating: 4,
      status: extra.status ?? 'published',
      text: extra.text === undefined ? null : extra.text,
    },
  });
}

const listOf = (mechanicId: string, query = '') =>
  get(`/reviews/mechanic/${mechanicId}${query}`);

const ids = (body: { items: { id: string }[] }) => body.items.map((r) => r.id);

// @traces 025-FR-012
describe('the page number of a mechanic’s reviews', () => {
  it.each([
    ['99999999999999999999'],
    ['2147483648'],
    ['9007199254740993'],
    ['4294967297'],
  ])(
    'answers 200 with no items and the real total for page %s',
    async (page) => {
      const s = await setting();
      await reviewed(s.driver, s.nord.id, s.mechanic.id, 1);

      const read = await listOf(s.mechanic.id, `?page=${page}`);

      expect(read.status).toBe(200);
      expect(read.body.items).toEqual([]);
      expect(read.body.total).toBe(1);
    },
  );

  it('reads 01 as page 1', async () => {
    const s = await setting();
    const one = await reviewed(s.driver, s.nord.id, s.mechanic.id, 1);

    const read = await listOf(s.mechanic.id, '?page=01');

    expect(read.status).toBe(200);
    expect(read.body.page).toBe(1);
    expect(ids(read.body)).toEqual([one.id]);
  });

  it.each([
    ['1e1'],
    ['0x2'],
    ['+1'],
    ['%201'],
    ['1%20'],
    [''],
    ['null'],
    ['undefined'],
    ['NaN'],
    ['Infinity'],
    ['%EF%BC%91'],
    ['1,2'],
    ['1;2'],
    ['-0'],
    ['0'],
    ['1.0'],
    ['%00'],
  ])('refuses page %p with 400', async (page) => {
    const s = await setting();

    const refused = await listOf(s.mechanic.id, `?page=${page}`);

    expect(refused.status).toBe(400);
  });

  it('refuses a page repeated in the query', async () => {
    const s = await setting();

    expect((await listOf(s.mechanic.id, '?page=1&page=2')).status).toBe(400);
  });

  it('refuses a page given as a bracketed list or an object', async () => {
    const s = await setting();

    expect((await listOf(s.mechanic.id, '?page[]=1')).status).toBe(400);
    expect((await listOf(s.mechanic.id, '?page[a]=1')).status).toBe(400);
  });

  it('refuses a query key the read does not take', async () => {
    const s = await setting();

    expect((await listOf(s.mechanic.id, '?pageSize=100')).status).toBe(400);
    expect((await listOf(s.mechanic.id, '?page=1&status=removed')).status).toBe(
      400,
    );
  });

  it('answers page 1 for an empty query string', async () => {
    const s = await setting();

    const read = await listOf(s.mechanic.id, '?');

    expect(read.status).toBe(200);
    expect(read.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });
});

// @traces 025-FR-011
describe('the id of a mechanic whose reviews are read', () => {
  it('finds a mechanic by an upper-case uuid', async () => {
    const s = await setting();
    const one = await reviewed(s.driver, s.nord.id, s.mechanic.id, 1);

    const read = await listOf(s.mechanic.id.toUpperCase());

    expect(read.status).toBe(200);
    expect(ids(read.body)).toEqual([one.id]);
  });

  it.each([
    ['a uuid with braces', '%7B00000000-0000-4000-8000-000000000000%7D'],
    ['a uuid with a trailing space', '00000000-0000-4000-8000-000000000000%20'],
    ['an encoded null byte', '%00'],
    ['a quote', "'"],
    ['a sql tail', "00000000-0000-4000-8000-000000000000'--"],
  ])('refuses %s with 400', async (_, id) => {
    const read = await get(`/reviews/mechanic/${id}`);

    expect(read.status).toBe(400);
  });

  it('answers 404 for the nil uuid', async () => {
    const read = await listOf('00000000-0000-0000-0000-000000000000');

    expect(read.status).toBe(404);
  });
});

// @traces 025-FR-011
describe('what a mechanic’s page holds', () => {
  it('answers an empty page for a mechanic nobody reviewed', async () => {
    const s = await setting();

    const read = await listOf(s.mechanic.id);

    expect(read.status).toBe(200);
    expect(read.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it.each([
    [1, 1, 0],
    [19, 19, 0],
    [20, 20, 0],
    [21, 20, 1],
  ])('splits %i reviews into 20 and the rest', async (made, first, second) => {
    const s = await setting();
    for (let i = 0; i < made; i++) {
      await reviewed(s.driver, s.nord.id, s.mechanic.id, i);
    }

    const one = await listOf(s.mechanic.id);
    const two = await listOf(s.mechanic.id, '?page=2');

    expect(one.body.items).toHaveLength(first);
    expect(two.body.items).toHaveLength(second);
    expect([one.body.total, two.body.total]).toEqual([made, made]);
  });

  it('leaves out the reviews that name another mechanic, none or the same garage’s other hand', async () => {
    const s = await setting();
    const other = await prisma.mechanic.create({
      data: { garageId: s.nord.id, name: 'Ionuț', onProfile: true },
    });
    const mine = await reviewed(s.driver, s.nord.id, s.mechanic.id, 1);
    await reviewed(s.driver, s.nord.id, other.id, 2);
    await reviewed(s.driver, s.nord.id, null, 3);

    const read = await listOf(s.mechanic.id);

    expect(ids(read.body)).toEqual([mine.id]);
    expect(read.body.total).toBe(1);
  });

  it('answers an empty page, not 404, when every review was unpublished after being published', async () => {
    const s = await setting();
    await reviewed(s.driver, s.nord.id, s.mechanic.id, 1);
    await reviewed(s.driver, s.dinamo.id, s.mechanic.id, 2);
    await prisma.review.updateMany({
      data: { status: 'reported' },
      where: { mechanicId: s.mechanic.id },
    });

    const read = await listOf(s.mechanic.id);

    expect(read.status).toBe(200);
    expect(read.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('gives the same answer twice and the same pages in either order', async () => {
    const s = await setting();
    for (let i = 0; i < 23; i++) {
      await reviewed(
        s.driver,
        i % 2 ? s.dinamo.id : s.nord.id,
        s.mechanic.id,
        i,
      );
    }

    const second = await listOf(s.mechanic.id, '?page=2');
    const first = await listOf(s.mechanic.id);
    const again = await listOf(s.mechanic.id);

    expect(again.body).toEqual(first.body);
    expect(new Set([...ids(first.body), ...ids(second.body)]).size).toBe(23);
  });

  it('returns text with NUL-free unicode, quotes and markup exactly as stored', async () => {
    const s = await setting();
    const text = 'Șurubelniță “bună” 🚗 <b>x</b> \' " \\ \n a';
    await reviewed(s.driver, s.nord.id, s.mechanic.id, 1, { text });

    const read = await listOf(s.mechanic.id);

    expect(read.body.items[0].text).toBe(text);
  });

  it('keeps an empty-string text as written, not as null', async () => {
    const s = await setting();
    await reviewed(s.driver, s.nord.id, s.mechanic.id, 1, { text: '' });

    const read = await listOf(s.mechanic.id);

    expect(read.body.items[0].text).toBe('');
  });

  it('lists reviews of a garage that was suspended or renamed with its current name and slug', async () => {
    const s = await setting();
    await reviewed(s.driver, s.dinamo.id, s.mechanic.id, 1);
    await prisma.garage.update({
      data: { name: 'Dinamo Nou', slug: 'dinamo-nou' },
      where: { id: s.dinamo.id },
    });

    const read = await listOf(s.mechanic.id);

    expect(read.body.items[0].garage).toEqual({
      id: s.dinamo.id,
      name: 'Dinamo Nou',
      slug: 'dinamo-nou',
    });
  });

  it('answers 404 once the garage the mechanic worked at is deleted', async () => {
    const s = await setting();
    await reviewed(s.driver, s.nord.id, s.mechanic.id, 1);
    await prisma.garage.delete({ where: { id: s.nord.id } });

    const read = await listOf(s.mechanic.id);

    expect(read.status).toBe(404);
  });

  it('lists a review whose author deleted the account with a name and nothing private', async () => {
    const s = await setting();
    await reviewed(s.driver, s.nord.id, s.mechanic.id, 1);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: s.driver },
    });

    const read = await listOf(s.mechanic.id);
    const body = JSON.stringify(read.body);

    expect(read.status).toBe(200);
    expect(body).not.toContain(s.driver);
    expect(Object.keys(read.body.items[0]).sort()).toEqual([
      'author',
      'garage',
      'id',
      'postedAt',
      'rating',
      'text',
    ]);
  });

  it('answers the same 404 body for a random uuid and an upper-case one', async () => {
    const lower = await listOf(randomUUID());
    const upper = await listOf(randomUUID().toUpperCase());

    expect([lower.status, upper.status]).toEqual([404, 404]);
    expect(upper.body).toEqual(lower.body);
  });
});
