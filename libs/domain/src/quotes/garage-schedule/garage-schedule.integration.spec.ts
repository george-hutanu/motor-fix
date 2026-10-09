// @traces 374-FR-003
// @traces 374-FR-005
// @traces 374-FR-009
// @traces 374-FR-010
// @traces 374-FR-012
import { randomUUID } from 'node:crypto';

import { GarageScheduleService } from './garage-schedule.service';
import type { BookingStatus } from '../../generated/prisma/enums';
import { garageActor } from '../quotes.testing';
import { quotesApp } from '../quotes-api.testing';

const { team, world } = quotesApp();
const { prisma } = world;
const service = new GarageScheduleService(prisma);

// Friday 9 October 2026, 10:00 in Bucharest.
const NOW = new Date('2026-10-09T07:00:00Z');

type Team = Awaited<ReturnType<typeof team>>;

const booked = (
  t: Team,
  startsAt: string,
  status?: BookingStatus,
  options?: Parameters<typeof world.booked>[3],
) => world.booked(t.garage.id, startsAt, status, options);

const owner = (t: Team) => garageActor(t.owner, t.garage.id);
const ids = (answer: { entries: { id: string }[] }) =>
  answer.entries.map((e) => e.id);

describe('the garage schedule read', () => {
  it('lists today’s bookings in start order with car, jobs, mechanic, lift and state', async () => {
    const t = await team('Atelier Dinamo');
    const late = await booked(t, '2026-10-09T12:00:00Z', 'confirmed', {
      lift: 2,
      mechanicId: t.answeringMechanic.id,
    });
    const early = await booked(t, '2026-10-09T05:30:00Z', 'completed', {
      lift: 1,
    });

    const answer = await service.list(owner(t), {}, NOW);

    expect(answer).toMatchObject({
      from: '2026-10-09',
      lifts: true,
      to: '2026-10-09',
    });
    expect(ids(answer)).toEqual([early.id, late.id]);
    expect(answer.entries[1]).toEqual({
      car: { brand: 'Mini', model: 'Cooper S', year: 2019 },
      confirmBy: null,
      durationMinutes: 90,
      id: late.id,
      jobs: ['Schimb ulei'],
      lift: 2,
      mechanic: { id: t.answeringMechanic.id, name: 'Fixer' },
      minutesLeft: null,
      startsAt: '2026-10-09T12:00:00.000Z',
      state: 'confirmed',
    });
    expect(answer.entries[0].mechanic).toBeNull();
  });

  it('carries the time left to confirm a booking still awaiting the garage', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-09T14:00:00Z', 'awaiting_confirmation', {
      confirmBy: '2026-10-09T07:37:30Z',
    });

    const [entry] = (await service.list(owner(t), {}, NOW)).entries;

    expect(entry).toMatchObject({
      confirmBy: '2026-10-09T07:37:30.000Z',
      minutesLeft: 37,
      state: 'awaiting_confirmation',
    });
  });

  it('leaves out lapsed and cancelled bookings and keeps no-shows', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-09T06:00:00Z', 'lapsed');
    await booked(t, '2026-10-09T07:00:00Z', 'cancelled');
    const missed = await booked(t, '2026-10-09T08:00:00Z', 'no_show');

    const answer = await service.list(owner(t), {}, NOW);

    expect(ids(answer)).toEqual([missed.id]);
    expect(answer.entries[0].state).toBe('no_show');
  });

  it('covers whole Bucharest days, across the autumn clock change', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-24T20:30:00Z');
    const first = await booked(t, '2026-10-24T21:30:00Z');
    const last = await booked(t, '2026-10-25T21:30:00Z');
    await booked(t, '2026-10-25T22:30:00Z');

    const answer = await service.list(
      owner(t),
      { from: '2026-10-25', to: '2026-10-25' },
      NOW,
    );

    expect(ids(answer)).toEqual([first.id, last.id]);
  });

  it('spans up to seven days and refuses more', async () => {
    const t = await team('Atelier Dinamo');
    const monday = await booked(t, '2026-10-12T07:00:00Z');
    const sunday = await booked(t, '2026-10-18T07:00:00Z');

    const week = await service.list(
      owner(t),
      { from: '2026-10-12', to: '2026-10-18' },
      NOW,
    );

    expect(ids(week)).toEqual([monday.id, sunday.id]);
    await expect(
      service.list(owner(t), { from: '2026-10-12', to: '2026-10-19' }, NOW),
    ).rejects.toMatchObject({ response: { code: 'validation' }, status: 400 });
    await expect(
      service.list(owner(t), { from: '2026-10-12', to: '2026-10-11' }, NOW),
    ).rejects.toMatchObject({ response: { code: 'validation' }, status: 400 });
  });

  it('filters by lift and by mechanic', async () => {
    const t = await team('Atelier Dinamo');
    const onTwo = await booked(t, '2026-10-09T06:00:00Z', 'confirmed', {
      lift: 2,
    });
    const fixers = await booked(t, '2026-10-09T08:00:00Z', 'confirmed', {
      lift: 1,
      mechanicId: t.answeringMechanic.id,
    });

    expect(ids(await service.list(owner(t), { lift: 2 }, NOW))).toEqual([
      onTwo.id,
    ]);
    expect(
      ids(
        await service.list(
          owner(t),
          { mechanicId: t.answeringMechanic.id },
          NOW,
        ),
      ),
    ).toEqual([fixers.id]);
  });

  it('drops the lift and refuses a lift filter when the garage schedules without lifts', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-09T06:00:00Z', 'confirmed', { lift: 2 });
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: t.garage.id, key: 'lift_schedule' },
    });

    const answer = await service.list(owner(t), {}, NOW);

    expect(answer.lifts).toBe(false);
    expect(answer.entries).toHaveLength(1);
    expect(answer.entries[0]).not.toHaveProperty('lift');
    await expect(
      service.list(owner(t), { lift: 2 }, NOW),
    ).rejects.toMatchObject({ response: { code: 'validation' }, status: 400 });
  });

  it('answers as empty for another garage’s mechanic or lift, and never shows its bookings', async () => {
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    await booked(militari, '2026-10-09T06:00:00Z', 'confirmed', {
      lift: 2,
      mechanicId: militari.answeringMechanic.id,
    });

    expect((await service.list(owner(dinamo), {}, NOW)).entries).toEqual([]);
    expect(
      (
        await service.list(
          owner(dinamo),
          { mechanicId: militari.answeringMechanic.id },
          NOW,
        )
      ).entries,
    ).toEqual([]);
    expect(
      (await service.list(owner(dinamo), { mechanicId: randomUUID() }, NOW))
        .entries,
    ).toEqual([]);
  });

  it('lets the receptionist read it and no mechanic or driver', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-09T06:00:00Z');

    const desk = await service.list(
      garageActor(t.receptionist, t.garage.id, 'receptionist'),
      {},
      NOW,
    );

    expect(desk.entries).toHaveLength(1);
    await expect(
      service.list(
        garageActor(t.answering, t.garage.id, 'mechanic', {
          canAnswerQuotes: true,
        }),
        {},
        NOW,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.list(garageActor(t.owner, t.garage.id, 'driver'), {}, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('shows no plate and changes nothing', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t, '2026-10-09T06:00:00Z');
    const before = await prisma.booking.findMany({ orderBy: { id: 'asc' } });
    const logged = await prisma.activityLog.count();

    const answer = await service.list(owner(t), {}, NOW);

    expect(JSON.stringify(answer)).not.toContain('B123ABC');
    expect(await prisma.booking.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before,
    );
    expect(await prisma.activityLog.count()).toBe(logged);
  });
});
