import { afterRace, pricesWorld } from './garage-prices.testing';
import type { Prisma } from '../../generated/prisma/client';

const { prisma } = pricesWorld();

const dacia = { key: 'dacia', name: 'Dacia', slug: 'dacia' };

const insert = (data: Prisma.BrandCreateInput) =>
  prisma.brand.create({ data }).then(
    (row) => row.key,
    (e: { code?: string }) => e.code,
  );

const openTransactions = async () => {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    select count(*) as n from pg_stat_activity
    where datname = current_database()
      and pid <> pg_backend_pid()
      and state like 'idle in transaction%'`;
  return Number(rows[0].n);
};

describe('afterRace under hostile writers', () => {
  it('rejects with the first writer error and leaves nothing open', async () => {
    const boom = new Error('first writer failed');
    const second = jest.fn(async () => 'never');

    await expect(
      afterRace(
        prisma,
        async () => {
          throw boom;
        },
        second,
        { within: 1_000 },
      ),
    ).rejects.toBe(boom);

    expect(await openTransactions()).toBe(0);
    expect(await prisma.brand.count()).toBe(0);
  });

  it('lets a later write succeed after the first writer failed', async () => {
    await expect(
      afterRace(
        prisma,
        async (tx) => {
          await tx.brand.create({ data: dacia });
          throw new Error('rolled back');
        },
        async () => 'ok',
        { within: 1_000 },
      ),
    ).rejects.toThrow('rolled back');

    expect(await insert(dacia)).toBe('dacia');
    expect(await prisma.brand.count()).toBe(1);
  });

  it('rolls back the first row when the first writer throws after writing', async () => {
    await afterRace(
      prisma,
      async (tx) => {
        await tx.brand.create({ data: dacia });
        throw new Error('late failure');
      },
      async () => 'ok',
      { within: 1_000 },
    ).catch(() => {});

    expect(await prisma.brand.count()).toBe(0);
    expect(await openTransactions()).toBe(0);
  });

  it('rejects with the second writer error without a conflict and still commits the first', async () => {
    const bad = new Error('second writer failed');

    await expect(
      afterRace(
        prisma,
        (tx) => tx.brand.create({ data: dacia }),
        () => Promise.reject(bad),
        { within: 1_000 },
      ),
    ).rejects.toBe(bad);

    expect(await prisma.brand.count()).toBe(1);
    expect(await openTransactions()).toBe(0);
  });

  it('waits on a row lock when the second writer updates the row the first one updated', async () => {
    await prisma.brand.create({ data: dacia });

    const answer = await afterRace(
      prisma,
      async (tx) => {
        await tx.brand.update({ data: { name: 'A' }, where: { key: 'dacia' } });
      },
      async () => {
        const row = await prisma.brand.update({
          data: { name: 'B' },
          where: { key: 'dacia' },
        });
        return row.name;
      },
      { within: 5_000 },
    );

    expect(answer).toBe('B');
    expect(
      (await prisma.brand.findUnique({ where: { key: 'dacia' } }))?.name,
    ).toBe('B');
  });

  it('runs two races in a row on the same keys', async () => {
    const run = () =>
      afterRace(
        prisma,
        (tx) =>
          tx.brand.upsert({
            create: dacia,
            update: {},
            where: { key: 'dacia' },
          }),
        () => insert(dacia),
        { within: 5_000 },
      );

    expect(await run()).toBe('P2002');
    expect(await run()).toBe('P2002');
    expect(await openTransactions()).toBe(0);
  });

  it('fails the race by name and releases the first writer when the second never starts working', async () => {
    const run = afterRace(
      prisma,
      (tx) => tx.brand.create({ data: dacia }),
      () => new Promise<string>(() => {}),
      { within: 300 },
    );

    await expect(run).rejects.toThrow(/afterRace/);
    expect(await openTransactions()).toBe(0);
    expect(await prisma.brand.count()).toBe(1);
  });

  it('rejects with the error of a second writer that throws synchronously, and releases the first', async () => {
    await expect(
      afterRace(
        prisma,
        (tx) => tx.brand.create({ data: dacia }),
        () => {
          throw new Error('sync boom');
        },
        { within: 500 },
      ),
    ).rejects.toThrow('sync boom');

    expect(await openTransactions()).toBe(0);
  });
});
