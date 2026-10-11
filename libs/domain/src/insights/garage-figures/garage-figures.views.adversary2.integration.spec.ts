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
describe('profile views read by week at the year boundaries', () => {
  it.each([
    ['2026-12-28', '2027-01-03', ['2026-W53']],
    ['2027-01-04', '2027-01-04', ['2027-W01']],
    ['2024-12-30', '2025-01-05', ['2025-W01']],
    ['2024-12-29', '2024-12-30', ['2024-W52', '2025-W01']],
    ['2021-01-01', '2021-01-03', ['2020-W53']],
    ['2020-12-31', '2021-01-04', ['2020-W53', '2021-W01']],
    ['2028-02-28', '2028-03-05', ['2028-W09']],
  ])('labels %s to %s as %j', async (from, to, keys) => {
    const t = await team('Atelier Dinamo');

    const { buckets } = await service.profileViews(owner(t), {
      by: 'week',
      from,
      to,
    });

    expect(buckets.map((b) => b.key)).toEqual(keys);
  });

  it('sums a week that crosses the year under the week of its Thursday', async () => {
    const t = await team('Atelier Dinamo');
    await row(t.garage.id, '2024-12-31', 2, { home: 2 });
    await row(t.garage.id, '2025-01-01', 3, { home: 1, search: 2 });

    const { buckets } = await service.profileViews(owner(t), {
      by: 'week',
      from: '2024-12-30',
      to: '2025-01-05',
    });

    expect(buckets).toEqual([
      { bySource: { home: 3, search: 2 }, key: '2025-W01', views: 5 },
    ]);
  });
});

// @traces 143-FR-013
describe('profile views read at the limits of a span', () => {
  it('answers exactly 366 days by day with a zero for each day without a row', async () => {
    const t = await team('Atelier Dinamo');
    await row(t.garage.id, '2025-10-01', 1, { home: 1 });

    const { buckets } = await service.profileViews(owner(t), {
      by: 'day',
      from: '2025-10-01',
      to: '2026-10-01',
    });

    expect(buckets).toHaveLength(366);
    expect(buckets[0]).toEqual({
      bySource: { home: 1 },
      key: '2025-10-01',
      views: 1,
    });
    expect(buckets[365]).toEqual({ bySource: {}, key: '2026-10-01', views: 0 });
  });

  it('refuses a span that ends before it starts', async () => {
    const t = await team('Atelier Dinamo');

    await expect(
      service.profileViews(owner(t), {
        by: 'day',
        from: '2026-10-06',
        to: '2026-10-05',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a missing from or to', async () => {
    const t = await team('Atelier Dinamo');

    await expect(
      service.profileViews(owner(t), {
        by: 'day',
        from: undefined as unknown as string,
        to: '2026-10-05',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.profileViews(owner(t), {
        by: 'day',
        from: '2026-10-05',
        to: null as unknown as string,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('leaves out the rows of another garage', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Rival');
    await row(t.garage.id, '2026-10-07', 1, { home: 1 });
    await row(other.garage.id, '2026-10-07', 40, { search: 40 });

    const { buckets } = await service.profileViews(owner(t), {
      by: 'day',
      from: '2026-10-07',
      to: '2026-10-07',
    });

    expect(buckets).toEqual([
      { bySource: { home: 1 }, key: '2026-10-07', views: 1 },
    ]);
  });

  it('counts a row on the first and the last day of the span and not the day outside either', async () => {
    const t = await team('Atelier Dinamo');
    await row(t.garage.id, '2026-10-05', 9, { home: 9 });
    await row(t.garage.id, '2026-10-06', 1, { home: 1 });
    await row(t.garage.id, '2026-10-08', 2, { home: 2 });
    await row(t.garage.id, '2026-10-09', 9, { home: 9 });

    const { buckets } = await service.profileViews(owner(t), {
      by: 'week',
      from: '2026-10-06',
      to: '2026-10-08',
    });

    expect(buckets).toEqual([
      { bySource: { home: 3 }, key: '2026-W41', views: 3 },
    ]);
  });

  it('leaves an empty split for a day whose row has no sources', async () => {
    const t = await team('Atelier Dinamo');
    await row(t.garage.id, '2026-10-07', 0, {});

    const { buckets } = await service.profileViews(owner(t), {
      by: 'week',
      from: '2026-10-07',
      to: '2026-10-07',
    });

    expect(buckets).toEqual([{ bySource: {}, key: '2026-W41', views: 0 }]);
  });
});
