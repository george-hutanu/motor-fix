// @traces 228-FR-012 228-FR-013 228-FR-014
import { rankBrands } from './brand-rank';
import { serialDatabase } from '../../auth/serial-db.testing';
import { atLocal } from '../../bucharest';
import {
  databaseUrl,
  failWritesAfter,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma } = fixtures();
serialDatabase(databaseUrl);

// Tuesday 20 October 2026, 01:00 in Bucharest: the window is the 30 closed
// days 20 September to 19 October.
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
      slug: name.toLowerCase(),
    },
  });
}

const searched = (day: string, name: string, searches: number) =>
  prisma.demandDaily.create({
    data: {
      day: new Date(day),
      dimension: 'brand',
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

describe('rankBrands', () => {
  it('ranks searched brands by their searches, then the rest by their current rank, then by name', async () => {
    await brand('BMW', 1);
    await brand('Dacia', 2);
    await brand('Volkswagen', 3);
    await brand('Audi', null);
    await brand('Opel', 4);
    await searched('2026-10-19', 'Dacia', 7);
    await searched('2026-10-01', 'Volkswagen', 4);
    await searched('2026-10-02', 'Volkswagen', 2);

    const result = await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual({
      Audi: 5,
      BMW: 3,
      Dacia: 1,
      Opel: 4,
      Volkswagen: 2,
    });
    expect(result).toEqual({ changed: 4, ranked: 5 });
  });

  it('counts the 30 closed days ending yesterday and nothing outside them', async () => {
    await brand('BMW', 1);
    await brand('Dacia', 2);
    await brand('Kia', 3);
    await searched('2026-09-19', 'BMW', 100);
    await searched('2026-10-20', 'BMW', 100);
    await searched('2026-09-20', 'Kia', 1);
    await searched('2026-10-19', 'Dacia', 2);

    await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual({ BMW: 3, Dacia: 1, Kia: 2 });
  });

  it('breaks a tie in searches by the current rank, then by name', async () => {
    await brand('Seat', null);
    await brand('Mini', null);
    await brand('Ford', 9);
    await searched('2026-10-10', 'Seat', 3);
    await searched('2026-10-10', 'Mini', 3);
    await searched('2026-10-10', 'Ford', 3);

    await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual({ Ford: 1, Mini: 2, Seat: 3 });
  });

  it('leaves a retired brand as it is and ranks only the active ones', async () => {
    await brand('BMW', 2);
    await brand('Saab', 1, false);
    await searched('2026-10-10', 'Saab', 50);

    await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual({ BMW: 1, Saab: 1 });
  });

  it('writes the same ranks on a second run and changes nothing', async () => {
    await brand('BMW', 1);
    await brand('Dacia', 2);
    await searched('2026-10-10', 'Dacia', 1);

    await rankBrands(prisma, NOW);
    const before = await ranks();
    const again = await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual(before);
    expect(again).toEqual({ changed: 0, ranked: 2 });
  });

  it('ignores searches kept under a name no active brand holds', async () => {
    await brand('Škoda', 1);
    await searched('2026-10-10', 'Skoda', 9);

    await rankBrands(prisma, NOW);

    expect(await ranks()).toEqual({ Škoda: 1 });
  });

  it('gives every active brand its own rank from 1 up', async () => {
    for (const [n, name] of ['A', 'B', 'C', 'D'].entries()) {
      await brand(name, n % 2 === 0 ? null : n);
    }

    await rankBrands(prisma, NOW);

    expect(Object.values(await ranks()).sort()).toEqual([1, 2, 3, 4]);
  });

  it('fails and keeps every rank as it was when the write does not go through', async () => {
    await brand('BMW', 1);
    await brand('Dacia', 2);
    await searched('2026-10-10', 'Dacia', 5);
    const undo = failWritesAfter(prisma, () => true, 1);

    try {
      await expect(rankBrands(prisma, NOW)).rejects.toThrow('connection lost');
    } finally {
      undo();
    }
    expect(await ranks()).toEqual({ BMW: 1, Dacia: 2 });
  });
});
