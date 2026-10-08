import { afterRace, pricesWorld } from './garage-prices.testing';
import type { Prisma } from '../../generated/prisma/client';

const { prisma } = pricesWorld();

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dacia = { key: 'dacia', name: 'Dacia', slug: 'dacia' };

const insert = (data: Prisma.BrandCreateInput) =>
  prisma.brand.create({ data }).then(
    (row) => row.key,
    (e: { code?: string }) => e.code,
  );

describe('afterRace', () => {
  it('holds the first write until a second writer that starts late waits on its lock', async () => {
    const loser = await afterRace(
      prisma,
      (tx) => tx.brand.create({ data: dacia }),
      async () => {
        await later(1_000);
        const seen = await prisma.brand.findUnique({
          where: { key: dacia.key },
        });
        return { seen, wrote: await insert(dacia) };
      },
    );

    expect(loser).toEqual({ seen: null, wrote: 'P2002' });
    expect(await prisma.brand.count()).toBe(1);
  });

  it('resolves with a second writer that never meets the first one', async () => {
    const loser = await afterRace(
      prisma,
      (tx) => tx.brand.create({ data: dacia }),
      () => insert({ key: 'ford', name: 'Ford', slug: 'ford' }),
    );

    expect(loser).toBe('ford');
    expect(await prisma.brand.count()).toBe(2);
  });
});
