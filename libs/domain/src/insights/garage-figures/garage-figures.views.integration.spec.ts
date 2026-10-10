// @traces 143-FR-013
import { GarageFiguresService } from './garage-figures.service';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { team, world } = quotesApp();
const { prisma } = world;
const service = new GarageFiguresService(prisma);

type Team = Awaited<ReturnType<typeof team>>;

const owner = (t: Team) => garageActor(t.owner, t.garage.id);

async function day(
  garageId: string,
  on: string,
  bySource: Record<string, number>,
  views = Object.values(bySource).reduce((a, b) => a + b, 0),
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

// Monday 28 September to Monday 12 October 2026: weeks 40 and 41 whole, and
// the first day of week 42. Every day but 1 October has a row.
async function fortnight(garageId: string) {
  for (let d = 28; d <= 30; d++)
    await day(garageId, `2026-09-${d}`, { search: 1 });
  for (let d = 2; d <= 12; d++) {
    const on = `2026-10-${String(d).padStart(2, '0')}`;
    await day(garageId, on, { home: 1, search: 2 });
  }
}

describe('profile views by day', () => {
  it('gives every day of the span, with nothing for a day without a row', async () => {
    const t = await team('Atelier Dinamo');
    await fortnight(t.garage.id);

    const { buckets } = await service.profileViews(owner(t), {
      by: 'day',
      from: '2026-09-28',
      to: '2026-10-12',
    });

    expect(buckets).toHaveLength(15);
    expect(buckets[0]).toEqual({
      bySource: { search: 1 },
      key: '2026-09-28',
      views: 1,
    });
    expect(buckets[3]).toEqual({ bySource: {}, key: '2026-10-01', views: 0 });
    expect(buckets[14]).toEqual({
      bySource: { home: 1, search: 2 },
      key: '2026-10-12',
      views: 3,
    });
    expect(buckets.map((b) => b.key)).toEqual(
      [...Array(15).keys()].map((i) =>
        new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10),
      ),
    );
  });

  it('reads the total from the row, not the sum of its sources', async () => {
    const t = await team('Atelier Dinamo');
    await day(t.garage.id, '2026-10-05', { home: 1, search: 1 }, 1);

    const { buckets } = await service.profileViews(owner(t), {
      by: 'day',
      from: '2026-10-05',
      to: '2026-10-05',
    });

    expect(buckets).toEqual([
      { bySource: { home: 1, search: 1 }, key: '2026-10-05', views: 1 },
    ]);
  });

  it("never shows another garage's views", async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Militari');
    await day(other.garage.id, '2026-10-05', { search: 9 });

    const { buckets } = await service.profileViews(owner(t), {
      by: 'day',
      from: '2026-10-05',
      to: '2026-10-05',
    });

    expect(buckets).toEqual([{ bySource: {}, key: '2026-10-05', views: 0 }]);
  });
});

describe('profile views by ISO week', () => {
  it('sums the days of each week the span touches, labelled by ISO week', async () => {
    const t = await team('Atelier Dinamo');
    await fortnight(t.garage.id);

    const { buckets } = await service.profileViews(owner(t), {
      by: 'week',
      from: '2026-09-28',
      to: '2026-10-12',
    });

    expect(buckets).toEqual([
      { bySource: { home: 3, search: 9 }, key: '2026-W40', views: 12 },
      { bySource: { home: 7, search: 14 }, key: '2026-W41', views: 21 },
      { bySource: { home: 1, search: 2 }, key: '2026-W42', views: 3 },
    ]);
  });

  it('labels the weeks around the new year by their ISO year', async () => {
    const t = await team('Atelier Dinamo');
    await day(t.garage.id, '2026-12-31', { search: 1 });
    await day(t.garage.id, '2027-01-03', { home: 1 });
    await day(t.garage.id, '2027-01-04', { saved: 2 });

    const { buckets } = await service.profileViews(owner(t), {
      by: 'week',
      from: '2026-12-28',
      to: '2027-01-10',
    });

    expect(buckets).toEqual([
      { bySource: { home: 1, search: 1 }, key: '2026-W53', views: 2 },
      { bySource: { saved: 2 }, key: '2027-W01', views: 2 },
    ]);
  });

  it('gives a week with no rows as nothing', async () => {
    const t = await team('Atelier Dinamo');

    const { buckets } = await service.profileViews(owner(t), {
      by: 'week',
      from: '2026-10-07',
      to: '2026-10-07',
    });

    expect(buckets).toEqual([{ bySource: {}, key: '2026-W41', views: 0 }]);
  });
});

describe('who may read profile views', () => {
  it('gives the receptionist the same figures as the owner', async () => {
    const t = await team('Atelier Dinamo');
    await day(t.garage.id, '2026-10-05', { search: 2 });
    const query = { by: 'day', from: '2026-10-05', to: '2026-10-05' } as const;

    expect(
      await service.profileViews(
        garageActor(t.receptionist, t.garage.id, 'receptionist'),
        query,
      ),
    ).toEqual(await service.profileViews(owner(t), query));
  });

  it('refuses a mechanic, even one who may answer quotes, and a driver', async () => {
    const t = await team('Atelier Dinamo');
    const query = { by: 'day', from: '2026-10-05', to: '2026-10-05' } as const;

    await expect(
      service.profileViews(
        garageActor(t.plain, t.garage.id, 'mechanic'),
        query,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.profileViews(
        garageActor(t.answering, t.garage.id, 'mechanic', {
          canAnswerQuotes: true,
        }),
        query,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.profileViews(garageActor(t.owner, t.garage.id, 'driver'), query),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ['a span over 366 days', { from: '2025-10-01', to: '2026-10-02' }],
    [
      'a span ending before it starts',
      { from: '2026-10-02', to: '2026-10-01' },
    ],
  ])('refuses %s', async (_, range) => {
    const t = await team('Atelier Dinamo');

    await expect(
      service.profileViews(owner(t), { by: 'day', ...range }),
    ).rejects.toMatchObject({ response: { code: 'validation' }, status: 400 });
  });

  it('accepts a span of 366 days', async () => {
    const t = await team('Atelier Dinamo');

    const { buckets } = await service.profileViews(owner(t), {
      by: 'day',
      from: '2025-10-02',
      to: '2026-10-02',
    });

    expect(buckets).toHaveLength(366);
  });
});
