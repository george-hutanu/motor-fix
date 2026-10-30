// @traces 144-profile-stats-weekly-FR-001
// @traces 144-profile-stats-weekly-FR-003
// @traces 144-profile-stats-weekly-FR-005
// @traces 144-profile-stats-weekly-FR-006
// @traces 144-profile-stats-weekly-FR-009
import { randomUUID } from 'node:crypto';

import { GarageFiguresModule } from './garage-figures.module';
import { GarageFiguresService } from './garage-figures.service';
import { atLocal } from '../../bucharest';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, team, world } = quotesApp([GarageFiguresModule]);
const { prisma } = world;
const service = new GarageFiguresService(prisma);

// Thursday 8 October 2026, 10:00 in Bucharest: the last whole week is W40.
const NOW = new Date('2026-10-08T07:00:00Z');

const path = (garageId: string, query = '') =>
  `/garages/${garageId}/figures/weekly${query}`;

type Team = Awaited<ReturnType<typeof team>>;

const approve = (garageId: string, at: Date | null) =>
  prisma.garage.update({ data: { approvedAt: at }, where: { id: garageId } });

const views = (garageId: string, day: string, profileViews: number) =>
  prisma.garageDailyFigures.create({
    data: {
      day: new Date(day),
      garageId,
      profileViews,
      profileViewsBySource: { search: profileViews },
      writtenAt: new Date(),
    },
  });

// A request that reached each of the garages at that instant.
async function reached(at: Date, ...garageIds: string[]) {
  const driver = await world.account(`Driver ${randomUUID()}`);
  const request = await world.request(driver, { createdAt: at });
  for (const garageId of garageIds) {
    const row = await world.recipient(request.id, garageId);
    await prisma.requestRecipient.update({
      data: { createdAt: at },
      where: { id: row.id },
    });
  }
}

const owner = (t: Team) => garageActor(t.owner, t.garage.id);

describe('GET /garages/:garageId/figures/weekly', () => {
  it('answers the owner and the desk with eight weeks', async () => {
    const t = await team('Atelier Dinamo');
    await approve(t.garage.id, new Date('2025-01-15T10:00:00Z'));

    for (const auth of [
      bearer(t.owner, 'garage'),
      bearer(t.receptionist, 'receptionist'),
    ]) {
      const res = await get(path(t.garage.id), auth);
      expect(res.status).toBe(200);
      expect(res.body.weeks).toHaveLength(8);
      expect(Object.keys(res.body.weeks[0]).sort()).toEqual([
        'conversion',
        'from',
        'key',
        'requests',
        'to',
        'views',
      ]);
    }
  });

  it('ignores a query it does not take', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(
      path(t.garage.id, '?period=12w'),
      bearer(t.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body.weeks).toHaveLength(8);
  });

  it('tells the garage’s own mechanic no', async () => {
    const t = await team('Atelier Dinamo');

    for (const auth of [
      bearer(t.plain, 'mechanic'),
      bearer(t.answering, 'mechanic'),
    ])
      expect((await get(path(t.garage.id), auth)).status).toBe(403);
  });

  it('answers 404 to another garage, a driver, an admin, a lone mechanic and an unknown garage', async () => {
    const t = await team('Atelier Dinamo');
    const rival = await team('Service Militari');
    const driver = await world.account('Dan Vasile');
    const admin = await world.account('Ana Admin', ['admin']);
    const lone = await world.account('Ion Liber', ['mechanic']);

    for (const auth of [
      bearer(rival.owner, 'garage'),
      bearer(rival.receptionist, 'receptionist'),
      bearer(rival.plain, 'mechanic'),
      bearer(driver, 'driver'),
      bearer(admin, 'admin'),
      bearer(lone, 'mechanic'),
    ])
      expect((await get(path(t.garage.id), auth)).status).toBe(404);
    expect(
      (await get(path(randomUUID()), bearer(t.owner, 'garage'))).status,
    ).toBe(404);
  });

  it('answers 400 to an id that is not one and 401 to a visitor', async () => {
    const t = await team('Atelier Dinamo');

    expect(
      (await get(path('not-a-garage'), bearer(t.owner, 'garage'))).status,
    ).toBe(400);
    expect((await get(path(t.garage.id))).status).toBe(401);
  });
});

describe('the weekly figures read', () => {
  it('sums the views and counts the requests of each week, once per garage', async () => {
    const t = await team('Atelier Dinamo');
    const other = await world.garage('Service Militari');
    const third = await world.garage('Auto Berceni');
    await approve(t.garage.id, new Date('2025-01-15T10:00:00Z'));
    await views(t.garage.id, '2026-09-29', 400);
    await views(t.garage.id, '2026-10-04', 72);
    await views(other.id, '2026-09-29', 999);
    await reached(atLocal('2026-10-01', 12), t.garage.id, other.id, third.id);
    await reached(
      new Date(atLocal('2026-10-04', 23).getTime() + 50 * 60_000),
      t.garage.id,
    );
    await reached(atLocal('2026-10-05', 0), t.garage.id);

    const { weeks } = await service.weekly(owner(t), t.garage.id, NOW);

    expect(weeks.at(-1)).toEqual({
      conversion: 0.4,
      from: '2026-09-28',
      key: '2026-W40',
      requests: 2,
      to: '2026-10-04',
      views: 472,
    });
    expect(weeks[0]).toMatchObject({ conversion: null, requests: 0, views: 0 });
  });

  it('answers null for the weeks before the approval', async () => {
    const t = await team('Atelier Dinamo');
    await approve(t.garage.id, atLocal('2026-09-16', 11));
    await views(t.garage.id, '2026-09-14', 5);
    await views(t.garage.id, '2026-09-08', 3);
    await reached(atLocal('2026-09-14', 9), t.garage.id);

    const { weeks } = await service.weekly(owner(t), t.garage.id, NOW);

    for (const week of weeks.slice(0, 5))
      expect(week).toMatchObject({
        conversion: null,
        requests: null,
        views: null,
      });
    expect(weeks[5]).toMatchObject({
      conversion: 20,
      key: '2026-W38',
      requests: 1,
      views: 5,
    });
  });

  it('answers null for every week of a garage never approved', async () => {
    const t = await team('Atelier Dinamo');
    await approve(t.garage.id, null);
    await views(t.garage.id, '2026-10-01', 4);

    const { weeks } = await service.weekly(owner(t), t.garage.id, NOW);

    expect(weeks).toHaveLength(8);
    for (const week of weeks) expect(week.views).toBeNull();
  });

  it('writes nothing', async () => {
    const t = await team('Atelier Dinamo');
    await approve(t.garage.id, new Date('2025-01-15T10:00:00Z'));
    await views(t.garage.id, '2026-10-01', 4);
    const before = await prisma.garageDailyFigures.findMany();

    await get(path(t.garage.id), bearer(t.owner, 'garage'));
    await service.weekly(owner(t), t.garage.id, NOW);

    expect(await prisma.garageDailyFigures.findMany()).toEqual(before);
    expect(
      await prisma.garage.findUnique({ where: { id: t.garage.id } }),
    ).toMatchObject({
      approvedAt: new Date('2025-01-15T10:00:00Z'),
    });
  });
});
