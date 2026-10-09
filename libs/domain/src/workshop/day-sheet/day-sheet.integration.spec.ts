// @traces 374-FR-006
// @traces 374-FR-009
// @traces 374-FR-010
// @traces 374-FR-012
// @traces 374-FR-013
import { randomUUID } from 'node:crypto';

import { DaySheetService } from './day-sheet.service';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { team, world } = quotesApp();
const { prisma } = world;
const service = new DaySheetService(prisma);

// Friday 9 October 2026, 10:00 in Bucharest.
const NOW = new Date('2026-10-09T07:00:00Z');

type Team = Awaited<ReturnType<typeof team>>;

const owner = (t: Team) => garageActor(t.owner, t.garage.id);

async function mechanic(t: Team, name: string) {
  return prisma.mechanic.create({ data: { garageId: t.garage.id, name } });
}

describe('the mechanic’s day sheet read', () => {
  it('lists the mechanic’s confirmed and completed bookings of the day in start order, with the totals', async () => {
    const t = await team('Atelier Dinamo');
    const costel = await mechanic(t, 'Costel Ionescu');
    const on = (startsAt: string, status: 'confirmed' | 'completed') =>
      world.booked(t.garage.id, startsAt, status, { mechanicId: costel.id });
    const late = await on('2026-10-10T11:00:00Z', 'confirmed');
    const early = await on('2026-10-10T06:00:00Z', 'completed');
    await world.booked(
      t.garage.id,
      '2026-10-10T08:00:00Z',
      'awaiting_confirmation',
      {
        mechanicId: costel.id,
      },
    );
    await world.booked(t.garage.id, '2026-10-10T09:00:00Z', 'cancelled', {
      mechanicId: costel.id,
    });
    await world.booked(t.garage.id, '2026-10-11T06:00:00Z', 'confirmed', {
      mechanicId: costel.id,
    });
    await world.booked(t.garage.id, '2026-10-10T07:00:00Z', 'confirmed', {
      mechanicId: t.answeringMechanic.id,
    });
    await prisma.booking.update({
      data: { durationMinutes: 50 },
      where: { id: late.id },
    });

    const sheet = await service.get(
      owner(t),
      { day: '2026-10-10', mechanic: 'Costel' },
      NOW,
    );

    expect(sheet).toMatchObject({
      day: '2026-10-10',
      jobCount: 2,
      mechanic: { id: costel.id, name: 'Costel Ionescu' },
      totalHours: 2.25,
    });
    expect(sheet.entries.map((e) => e.id)).toEqual([early.id, late.id]);
    expect(sheet.entries[1]).toEqual({
      car: { brand: 'Mini', model: 'Cooper S', year: 2019 },
      durationMinutes: 50,
      id: late.id,
      jobs: ['Schimb ulei'],
      note: 'Scârțâie la frânare',
      startsAt: '2026-10-10T11:00:00.000Z',
      state: 'confirmed',
    });
  });

  it('defaults to today in Bucharest and echoes the day', async () => {
    const t = await team('Atelier Dinamo');
    const costel = await mechanic(t, 'Costel Ionescu');
    const today = await world.booked(
      t.garage.id,
      '2026-10-09T06:00:00Z',
      'confirmed',
      { description: null, mechanicId: costel.id },
    );

    const sheet = await service.get(owner(t), { mechanic: costel.id }, NOW);

    expect(sheet.day).toBe('2026-10-09');
    expect(sheet.entries.map((e) => e.id)).toEqual([today.id]);
    expect(sheet.entries[0].note).toBeNull();
  });

  it('answers an empty sheet for a day with no job', async () => {
    const t = await team('Atelier Dinamo');
    await mechanic(t, 'Costel Ionescu');

    const sheet = await service.get(
      owner(t),
      { day: '2026-10-10', mechanic: 'costel' },
      NOW,
    );

    expect(sheet).toMatchObject({ entries: [], jobCount: 0, totalHours: 0 });
  });

  it.each(['Ștefan', 'stefan', 'STEFAN DUMITRESCU', 'Ştefan Dumitrescu'])(
    'finds the mechanic by %s, ignoring case and diacritics',
    async (asked) => {
      const t = await team('Atelier Dinamo');
      const stefan = await mechanic(t, 'Ștefan Dumitrescu');

      const sheet = await service.get(owner(t), { mechanic: asked }, NOW);

      expect(sheet.mechanic).toEqual({
        id: stefan.id,
        name: 'Ștefan Dumitrescu',
      });
    },
  );

  it.each([
    ['matches nobody', 'Gigel'],
    ['matches two mechanics', 'Costel'],
  ])('lists the garage’s mechanics when the name %s', async (_case, asked) => {
    const t = await team('Atelier Dinamo');
    const ionescu = await mechanic(t, 'Costel Ionescu');
    const pop = await mechanic(t, 'Costel Pop');
    const other = await team('Service Militari');
    await mechanic(other, 'Gigel Stan');

    const refused = service.get(owner(t), { mechanic: asked }, NOW);

    await expect(refused).rejects.toMatchObject({ status: 404 });
    const body = await refused.then(
      () => {
        throw new Error('the name was taken as a mechanic');
      },
      (error: { getResponse(): { code: string; mechanics: unknown[] } }) =>
        error.getResponse(),
    );
    expect(body.code).toBe('mechanic_not_found');
    expect(body.mechanics).toEqual(
      expect.arrayContaining([
        { id: ionescu.id, name: 'Costel Ionescu' },
        { id: pop.id, name: 'Costel Pop' },
        { id: t.answeringMechanic.id, name: 'Fixer' },
        { id: t.plainMechanic.id, name: 'Hand' },
      ]),
    );
    expect(body.mechanics).toHaveLength(4);
  });

  it('answers not_found for another garage’s mechanic id and shows nothing of it', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Militari');
    const theirs = await mechanic(other, 'Costel Ionescu');
    await world.booked(other.garage.id, '2026-10-09T06:00:00Z', 'confirmed', {
      mechanicId: theirs.id,
    });

    await expect(
      service.get(owner(t), { mechanic: theirs.id }, NOW),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.get(owner(t), { mechanic: randomUUID() }, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lets the receptionist read it and no mechanic or driver', async () => {
    const t = await team('Atelier Dinamo');
    const costel = await mechanic(t, 'Costel Ionescu');

    const desk = await service.get(
      garageActor(t.receptionist, t.garage.id, 'receptionist'),
      { mechanic: costel.id },
      NOW,
    );

    expect(desk.mechanic.id).toBe(costel.id);
    await expect(
      service.get(
        garageActor(t.answering, t.garage.id, 'mechanic', {
          canAnswerQuotes: true,
        }),
        { mechanic: costel.id },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.get(
        garageActor(t.owner, t.garage.id, 'driver'),
        { mechanic: costel.id },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('shows no plate and changes nothing', async () => {
    const t = await team('Atelier Dinamo');
    const costel = await mechanic(t, 'Costel Ionescu');
    await world.booked(t.garage.id, '2026-10-09T06:00:00Z', 'confirmed', {
      mechanicId: costel.id,
    });
    const before = await prisma.booking.findMany({ orderBy: { id: 'asc' } });
    const logged = await prisma.activityLog.count();

    const sheet = await service.get(owner(t), { mechanic: costel.id }, NOW);

    expect(sheet.entries).toHaveLength(1);
    expect(JSON.stringify(sheet)).not.toContain('B123ABC');
    expect(await prisma.booking.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before,
    );
    expect(await prisma.activityLog.count()).toBe(logged);
  });
});
