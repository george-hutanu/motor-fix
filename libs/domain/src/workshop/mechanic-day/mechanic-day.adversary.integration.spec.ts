import { MechanicDayService } from './mechanic-day.service';
import { addDays, localDay } from '../../bucharest';
import type { BookingStatus, JobStatus } from '../../generated/prisma/enums';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;
const service = new MechanicDayService(prisma);

// Monday 6 December 2027, 09:00 in Bucharest.
const NOW = new Date('2027-12-06T07:00:00Z');

type Team = Awaited<ReturnType<typeof team>>;

const hand = (t: Team) => garageActor(t.plain, t.garage.id, 'mechanic');

async function bookedJob(
  t: Team,
  start: string,
  options: {
    booking?: BookingStatus;
    job?: JobStatus;
    mechanicId?: string;
  } = {},
) {
  const mechanicId = options.mechanicId ?? t.plainMechanic.id;
  // The stretch holds no mechanic, so bookings a millisecond apart may
  // stack; the day reads the booking's mechanic.
  const placed = await world.booked(
    t.garage.id,
    start,
    options.booking ?? 'confirmed',
  );
  const booking = await prisma.booking.update({
    data: { mechanicId },
    where: { id: placed.id },
  });
  const job = await world.job(booking.id, options.job ?? 'to_do', {
    mechanicId,
  });
  return { booking, job };
}

const ids = (day: { rows: { bookingId: string }[] }) =>
  day.rows.map((r) => r.bookingId);

// @traces 122-FR-006 122-FR-007 122-FR-008
describe('the mechanic’s day read under hostile input', () => {
  it('refuses a date thirty-one days either way from the service and accepts thirty', async () => {
    const t = await team('Atelier Dinamo');
    const today = localDay(NOW);

    const edge = await service.get(hand(t), { date: addDays(today, 30) }, NOW);

    await expect(
      service.get(hand(t), { date: addDays(today, -31) }, NOW),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.get(hand(t), { date: addDays(today, 31) }, NOW),
    ).rejects.toMatchObject({ status: 422 });
    expect(edge).toEqual({
      date: addDays(today, 30),
      inWork: 0,
      jobs: 0,
      rows: [],
    });
  });

  it('puts the stretch starting at Bucharest midnight on the new day and the one a millisecond earlier on the old', async () => {
    const t = await team('Atelier Dinamo');
    const midnight = await bookedJob(t, '2027-12-06T22:00:00.000Z');
    const before = await bookedJob(t, '2027-12-06T21:59:59.999Z');

    const next = await service.get(hand(t), { date: '2027-12-07' }, NOW);
    const same = await service.get(hand(t), { date: '2027-12-06' }, NOW);

    expect(ids(next)).toEqual([midnight.booking.id]);
    expect(ids(same)).toEqual([before.booking.id]);
  });

  it('reads the day the clocks change as the Bucharest day it is', async () => {
    const t = await team('Atelier Dinamo');
    const now = new Date('2027-03-28T10:00:00Z');
    const inside = await bookedJob(t, '2027-03-27T22:30:00Z');
    await bookedJob(t, '2027-03-27T21:30:00Z');
    const late = await bookedJob(t, '2027-03-28T20:30:00Z');
    await bookedJob(t, '2027-03-28T21:30:00Z');

    const day = await service.get(hand(t), { date: '2027-03-28' }, now);

    expect(ids(day)).toEqual([inside.booking.id, late.booking.id]);
  });

  it('never carries over another mechanic’s job, a cancelled job or a job finished yesterday', async () => {
    const t = await team('Atelier Dinamo');
    await bookedJob(t, '2027-12-03T07:00:00Z', {
      job: 'in_work',
      mechanicId: t.answeringMechanic.id,
    });
    await bookedJob(t, '2027-12-03T08:00:00Z', {
      booking: 'cancelled',
      job: 'cancelled',
    });
    const yesterday = await bookedJob(t, '2027-12-03T09:00:00Z', {
      booking: 'completed',
      job: 'done',
    });
    await prisma.job.update({
      data: { finishedAt: new Date('2027-12-05T21:59:59Z') },
      where: { id: yesterday.job.id },
    });

    const day = await service.get(hand(t), {}, NOW);

    expect(day).toEqual({ date: '2027-12-06', inWork: 0, jobs: 0, rows: [] });
  });

  it('carries over by the booking’s mechanic, as the day’s rows do, whoever the job names', async () => {
    const t = await team('Atelier Dinamo');
    const mine = await bookedJob(t, '2027-12-03T07:00:00Z', { job: 'in_work' });
    const theirs = await bookedJob(t, '2027-12-03T08:00:00Z', {
      job: 'in_work',
      mechanicId: t.answeringMechanic.id,
    });
    await prisma.job.update({
      data: { mechanicId: t.answeringMechanic.id },
      where: { id: mine.job.id },
    });
    await prisma.job.update({
      data: { mechanicId: t.plainMechanic.id },
      where: { id: theirs.job.id },
    });

    const day = await service.get(hand(t), {}, NOW);

    expect(ids(day)).toEqual([mine.booking.id]);
  });

  it('keeps a removed mechanic card out of the service as not found', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: t.plainMechanic.id },
    });

    await expect(
      service.get(hand(t), { date: '2027-12-06' }, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ['an empty date', '?date='],
    ['a date with a time', '?date=2027-12-06T00:00:00Z'],
    ['a repeated date', '?date=2027-12-06&date=2027-12-07'],
    ['a unicode digit date', '?date=２０２７-12-06'],
    ['a date with spaces', '?date=%202027-12-06'],
    ['a year-zero date', '?date=0000-01-01'],
  ])('refuses %s with a validation problem on date', async (_, query) => {
    const t = await team('Atelier Dinamo');

    const res = await get(`/me/day${query}`, bearer(t.plain, 'mechanic'));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [expect.objectContaining({ field: 'date' })],
    });
  });

  it('ignores a query naming another mechanic and answers the caller’s own day', async () => {
    const t = await team('Atelier Dinamo');
    const today = localDay(new Date());
    const theirs = await bookedJob(t, `${today}T09:00:00Z`, {
      mechanicId: t.answeringMechanic.id,
    });

    const res = await get(
      `/me/day?mechanicId=${t.answeringMechanic.id}`,
      bearer(t.plain, 'mechanic'),
    );

    expect(JSON.stringify(res.body)).not.toContain(theirs.booking.id);
  });
});
