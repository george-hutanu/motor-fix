import { GarageFiguresService } from './garage-figures.service';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { team, world } = quotesApp();
const { prisma } = world;
const service = new GarageFiguresService(prisma);

type Team = Awaited<ReturnType<typeof team>>;
const owner = (t: Team) => garageActor(t.owner, t.garage.id);

async function row(
  garageId: string,
  on: string,
  views: number,
  bySource: Record<string, number>,
) {
  await prisma.garageDailyFigures.create({
    data: {
      day: new Date(on),
      garageId,
      profileViews: views,
      profileViewsBySource: bySource,
      writtenAt: new Date(),
    },
  });
}

// @traces 143-FR-013
describe('profile views over awkward spans', () => {
  it('counts a span of one day by day and by week', async () => {
    const t = await team('Atelier Dinamo');
    await row(t.garage.id, '2026-10-07', 2, { home: 2 });
    const query = { from: '2026-10-07', to: '2026-10-07' };

    expect(
      (await service.profileViews(owner(t), { ...query, by: 'day' })).buckets,
    ).toEqual([{ bySource: { home: 2 }, key: '2026-10-07', views: 2 }]);
    expect(
      (await service.profileViews(owner(t), { ...query, by: 'week' })).buckets,
    ).toEqual([{ bySource: { home: 2 }, key: '2026-W41', views: 2 }]);
  });

  it('leaves out the days of a week that fall outside the span', async () => {
    const t = await team('Atelier Dinamo');
    await row(t.garage.id, '2026-10-05', 5, { search: 5 });
    await row(t.garage.id, '2026-10-07', 1, { search: 1 });
    await row(t.garage.id, '2026-10-11', 2, { home: 2 });
    await row(t.garage.id, '2026-10-12', 4, { home: 4 });
    await row(t.garage.id, '2026-10-14', 9, { saved: 9 });

    const { buckets } = await service.profileViews(owner(t), {
      by: 'week',
      from: '2026-10-07',
      to: '2026-10-13',
    });

    expect(buckets).toEqual([
      { bySource: { home: 2, search: 1 }, key: '2026-W41', views: 3 },
      { bySource: { home: 4 }, key: '2026-W42', views: 4 },
    ]);
  });

  it('gives the same answer twice', async () => {
    const t = await team('Atelier Dinamo');
    await row(t.garage.id, '2026-10-07', 1, { search: 1 });
    const query = { by: 'week', from: '2026-09-28', to: '2026-10-12' } as const;

    expect(await service.profileViews(owner(t), query)).toEqual(
      await service.profileViews(owner(t), query),
    );
  });

  it('answers 366 days by week in order, one bucket for each ISO week touched', async () => {
    const t = await team('Atelier Dinamo');

    const { buckets } = await service.profileViews(owner(t), {
      by: 'week',
      from: '2025-10-02',
      to: '2026-10-02',
    });

    expect(buckets).toHaveLength(53);
    expect(buckets[0].key).toBe('2025-W40');
    expect(buckets[12].key).toBe('2025-W52');
    expect(buckets[13].key).toBe('2026-W01');
    expect(buckets[52].key).toBe('2026-W40');
  });

  it('gives one bucket for each day across both clock changes', async () => {
    const t = await team('Atelier Dinamo');

    for (const [from, to, keys] of [
      [
        '2026-03-27',
        '2026-03-31',
        ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31'],
      ],
      [
        '2026-10-24',
        '2026-10-27',
        ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'],
      ],
    ] as const) {
      const { buckets } = await service.profileViews(owner(t), {
        by: 'day',
        from,
        to,
      });
      expect(buckets.map((b) => b.key)).toEqual(keys);
    }
  });

  it('gives each day of a leap February', async () => {
    const t = await team('Atelier Dinamo');

    const { buckets } = await service.profileViews(owner(t), {
      by: 'day',
      from: '2028-02-27',
      to: '2028-03-01',
    });

    expect(buckets.map((b) => b.key)).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });

  it('adds up the sources of different days under one key each', async () => {
    const t = await team('Atelier Dinamo');
    await row(t.garage.id, '2026-10-05', 3, { search: 3 });
    await row(t.garage.id, '2026-10-06', 4, { home: 1, search: 4 });

    const { buckets } = await service.profileViews(owner(t), {
      by: 'week',
      from: '2026-10-05',
      to: '2026-10-11',
    });

    expect(buckets).toEqual([
      { bySource: { home: 1, search: 7 }, key: '2026-W41', views: 7 },
    ]);
  });
});

// @traces 143-FR-013
describe('profile views asked for in a wrong way', () => {
  it.each([
    ['a month that does not exist', { from: '2026-13-01', to: '2026-13-02' }],
    ['a day that does not exist', { from: '2026-02-30', to: '2026-03-01' }],
    ['a day without zeros', { from: '2026-1-5', to: '2026-1-6' }],
    [
      'a time with the day',
      { from: '2026-10-05T00:00:00Z', to: '2026-10-06T00:00:00Z' },
    ],
    ['a padded day', { from: ' 2026-10-05', to: '2026-10-06' }],
    ['empty days', { from: '', to: '' }],
    ['a span of 367 days', { from: '2025-10-01', to: '2026-10-02' }],
  ])('refuses %s', async (_, range) => {
    const t = await team('Atelier Dinamo');

    await expect(
      service.profileViews(owner(t), { by: 'day', ...range }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a grouping that is neither day nor week', async () => {
    const t = await team('Atelier Dinamo');

    await expect(
      service.profileViews(owner(t), {
        by: 'month' as 'day',
        from: '2026-10-05',
        to: '2026-10-06',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('answers a mechanic with 404 before it looks at the span', async () => {
    const t = await team('Atelier Dinamo');

    await expect(
      service.profileViews(garageActor(t.plain, t.garage.id, 'mechanic'), {
        by: 'day',
        from: '2026-10-06',
        to: '2026-10-05',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
