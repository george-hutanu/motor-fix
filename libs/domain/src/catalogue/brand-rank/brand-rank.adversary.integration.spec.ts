import { rankBrands } from './brand-rank';
import { serialDatabase } from '../../auth/serial-db.testing';
import { atLocal } from '../../bucharest';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma } = fixtures();
serialDatabase(databaseUrl);

const NOW = atLocal('2026-10-20', 1);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand, demand_daily CASCADE');
});

afterAll(() => prisma.$disconnect());

async function brand(name: string, popularity: number | null, active = true) {
  await prisma.brand.create({
    data: {
      active,
      key: name.toLowerCase(),
      name,
      popularity,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    },
  });
}

const searched = (
  day: string,
  name: string,
  searches: number,
  dimension = 'brand',
) =>
  prisma.demandDaily.create({
    data: {
      day: new Date(day),
      dimension,
      key: name,
      requests: 0,
      searches,
      writtenAt: NOW,
    },
  });

const ranks = async () =>
  Object.fromEntries(
    (
      await prisma.brand.findMany({
        orderBy: { name: 'asc' },
        select: { name: true, popularity: true },
      })
    ).map((b) => [b.name, b.popularity]),
  );

// @traces 228-FR-012
describe('rankBrands under hostile input', () => {
  it('returns zero ranked and zero changed with no brands at all', async () => {
    await searched('2026-10-10', 'Ghost', 5);

    expect(await rankBrands(prisma, NOW)).toEqual({ changed: 0, ranked: 0 });
  });

  it('ranks a single brand 1 with no searches', async () => {
    await brand('Solo', null);

    expect(await rankBrands(prisma, NOW)).toEqual({ changed: 1, ranked: 1 });
    expect(await ranks()).toEqual({ Solo: 1 });
  });

  it('counts the first and last day of the window and refuses the days just outside', async () => {
    await brand('A', null);
    await brand('B', null);
    await brand('C', null);
    await brand('D', null);
    await searched('2026-09-20', 'A', 4);
    await searched('2026-10-19', 'B', 3);
    await searched('2026-09-19', 'C', 99);
    await searched('2026-10-20', 'D', 99);

    await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual({ A: 1, B: 2, C: 3, D: 4 });
  });

  it('does not count another dimension whose key is a brand name', async () => {
    await brand('BMW', 1);
    await brand('Dacia', 2);
    await searched('2026-10-10', 'Dacia', 50, 'job');
    await searched('2026-10-10', 'Dacia', 50, 'city');

    await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual({ BMW: 1, Dacia: 2 });
  });

  it('sums a brand over many days against a brand with one big day', async () => {
    await brand('Many', null);
    await brand('Big', null);
    for (let d = 1; d <= 19; d += 1) {
      await searched(`2026-10-${String(d).padStart(2, '0')}`, 'Many', 2);
    }
    await searched('2026-10-05', 'Big', 37);

    await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual({ Big: 2, Many: 1 });
  });

  it('puts a brand with zero recorded searches after one with a single search', async () => {
    await brand('Zero', 1);
    await brand('One', 2);
    await searched('2026-10-10', 'Zero', 0);
    await searched('2026-10-10', 'One', 1);

    await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual({ One: 1, Zero: 2 });
  });

  it('orders unranked equal brands by code point, not by locale', async () => {
    await brand('Zeta', null);
    await brand('Škoda', null);
    await brand('abc', null);
    await brand('Äpfel', null);

    await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual({ abc: 2, Zeta: 1, Äpfel: 3, Škoda: 4 });
  });

  it('ranks by the Bucharest day, not the UTC day, just after local midnight', async () => {
    await brand('Zlate', null);
    await brand('Other', null);
    await searched('2026-10-19', 'Zlate', 5);
    // 21:30 UTC on 19 October is 00:30 on 20 October in Bucharest.
    const justAfterMidnight = new Date('2026-10-19T21:30:00Z');
    await rankBrands(prisma, justAfterMidnight);
    expect(await ranks()).toEqual({ Other: 2, Zlate: 1 });

    // 20:59 UTC is 23:59 on 19 October: yesterday is the 18th, so the 19th is open.
    await prisma.brand.updateMany({ data: { popularity: null } });
    await rankBrands(prisma, new Date('2026-10-19T20:59:00Z'));
    expect(await ranks()).toEqual({ Other: 1, Zlate: 2 });
  });

  it('keeps a 30-day window across the autumn clock change', async () => {
    await brand('In', null);
    await brand('Out', null);
    // On 26 October 2026 the window is 26 September to 25 October.
    await searched('2026-09-26', 'In', 2);
    await searched('2026-09-25', 'Out', 9);

    await rankBrands(prisma, atLocal('2026-10-26', 1));

    expect(await ranks()).toEqual({ In: 1, Out: 2 });
  });

  it('keeps a 30-day window across the spring clock change', async () => {
    await brand('In', null);
    await brand('Out', null);
    // On 30 March 2026 the window is 28 February to 29 March.
    await searched('2026-02-28', 'In', 2);
    await searched('2026-02-27', 'Out', 9);
    await searched('2026-03-30', 'Out', 9);

    await rankBrands(prisma, atLocal('2026-03-30', 1));

    expect(await ranks()).toEqual({ In: 1, Out: 2 });
  });

  it('ranks two thousand brands with no gap, no repeat and the busiest first', async () => {
    const names = Array.from(
      { length: 2000 },
      (_, i) => `B${String(i).padStart(4, '0')}`,
    );
    await prisma.brand.createMany({
      data: names.map((name, i) => ({
        active: true,
        key: name.toLowerCase(),
        name,
        popularity: i + 1,
        slug: name.toLowerCase(),
      })),
    });
    await searched('2026-10-10', 'B1999', 10);

    const result = await rankBrands(prisma, NOW);

    const rows = await prisma.brand.findMany({
      select: { name: true, popularity: true },
    });
    expect(result.ranked).toBe(2000);
    expect(
      rows.map((r) => r.popularity).sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual(Array.from({ length: 2000 }, (_, i) => i + 1));
    expect(rows.find((r) => r.name === 'B1999')?.popularity).toBe(1);
    expect(rows.find((r) => r.name === 'B0000')?.popularity).toBe(2);
  });

  it('gives the same ranking when run twice with a search arriving between', async () => {
    await brand('A', 1);
    await brand('B', 2);
    await rankBrands(prisma, NOW);
    await searched('2026-10-10', 'B', 1);
    await rankBrands(prisma, NOW);
    const first = await ranks();
    await rankBrands(prisma, NOW);

    expect(first).toEqual({ A: 2, B: 1 });
    expect(await ranks()).toEqual(first);
  });

  it('never gives an inactive brand a rank that collides with an active one', async () => {
    await brand('Old', 1, false);
    await brand('New', 5);

    await rankBrands(prisma, NOW);

    const active = await prisma.brand.findMany({
      select: { popularity: true },
      where: { active: true },
    });
    expect(active.map((b) => b.popularity)).toEqual([1]);
  });
});
