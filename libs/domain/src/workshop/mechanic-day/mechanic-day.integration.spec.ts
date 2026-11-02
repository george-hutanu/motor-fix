import { MechanicDayService } from './mechanic-day.service';
import type { BookingStatus, JobStatus } from '../../generated/prisma/enums';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { team, world } = quotesApp();
const { prisma } = world;
const service = new MechanicDayService(prisma);

// Monday 6 December 2027, 09:00 in Bucharest.
const NOW = new Date('2027-12-06T07:00:00Z');

type Team = Awaited<ReturnType<typeof team>>;

const hand = (t: Team) => garageActor(t.plain, t.garage.id, 'mechanic');

// A booking of the plain mechanic with its job, held by one stretch per
// start given (a confirmed booking's first stretch comes with it).
async function bookedJob(
  t: Team,
  starts: string[],
  options: {
    booking?: BookingStatus;
    job?: JobStatus;
    lift?: number;
    mechanicId?: string;
  } = {},
) {
  const mechanicId = options.mechanicId ?? t.plainMechanic.id;
  const status = options.booking ?? 'confirmed';
  // The stretches hold no mechanic, so the cases may stack bookings the
  // schedule's exclusion would refuse; the day reads the booking's mechanic.
  const placed = await world.booked(t.garage.id, starts[0], status, {
    lift: options.lift,
  });
  const booking = await prisma.booking.update({
    data: { mechanicId },
    where: { id: placed.id },
  });
  const extra = status === 'confirmed' ? starts.slice(1) : starts;
  for (const start of extra) {
    const at = new Date(start);
    await prisma.bookingSegment.create({
      data: {
        bookingId: booking.id,
        endsAt: new Date(at.getTime() + 60 * 60_000),
        garageId: t.garage.id,
        lift: options.lift ?? null,
        startsAt: at,
      },
    });
  }
  const job = await world.job(booking.id, options.job ?? 'to_do', {
    mechanicId,
  });
  return { booking, job };
}

const off = (t: Team, key: string) =>
  prisma.garageFeature.create({
    data: { enabled: false, garageId: t.garage.id, key },
  });

// @traces 122-one-job-status-FR-007 122-one-job-status-FR-009 122-one-job-status-FR-010
describe('the mechanic’s day read', () => {
  it('lists the confirmed and completed bookings of the day in start order, with the counts', async () => {
    const t = await team('Atelier Dinamo');
    const late = await bookedJob(t, ['2027-12-07T12:00:00Z'], {
      job: 'in_work',
    });
    const early = await bookedJob(t, ['2027-12-07T07:00:00Z'], {
      booking: 'completed',
      job: 'done',
    });
    for (const status of [
      'awaiting_confirmation',
      'lapsed',
      'cancelled',
      'no_show',
    ] as const)
      await bookedJob(t, ['2027-12-07T09:00:00Z'], { booking: status });
    await bookedJob(t, ['2027-12-08T07:00:00Z']);
    await bookedJob(t, ['2027-12-07T08:00:00Z'], {
      mechanicId: t.answeringMechanic.id,
    });

    const day = await service.get(hand(t), { date: '2027-12-07' }, NOW);

    expect(day).toMatchObject({ date: '2027-12-07', inWork: 1, jobs: 2 });
    expect(day.rows.map((r) => r.bookingId)).toEqual([
      early.booking.id,
      late.booking.id,
    ]);
    expect(day.rows[1]).toEqual({
      bookingId: late.booking.id,
      car: { brand: 'Mini', model: 'Cooper S', plate: 'B123ABC' },
      carryOver: false,
      driverFirstName: 'Andrei',
      inWorkSince: null,
      jobId: late.job.id,
      jobs: ['Schimb ulei'],
      lock: null,
      start: '2027-12-07T12:00:00.000Z',
      status: 'in_work',
      stepsDone: 0,
      stepsTotal: 0,
      workedSeconds: 0,
    });
  });

  it('answers an empty day', async () => {
    const t = await team('Atelier Dinamo');

    const day = await service.get(hand(t), { date: '2027-12-07' }, NOW);

    expect(day).toEqual({ date: '2027-12-07', inWork: 0, jobs: 0, rows: [] });
  });

  it('orders rows of the same start by booking', async () => {
    const t = await team('Atelier Dinamo');
    const a = await bookedJob(t, ['2027-12-07T07:00:00Z']);
    const b = await bookedJob(t, ['2027-12-07T07:00:00Z']);

    const day = await service.get(hand(t), { date: '2027-12-07' }, NOW);

    expect(day.rows.map((r) => r.bookingId)).toEqual(
      [a.booking.id, b.booking.id].sort(),
    );
  });

  it('shows a booking over several days on each, from that day’s earliest stretch', async () => {
    const t = await team('Atelier Dinamo');
    const long = await bookedJob(t, [
      '2027-12-07T14:00:00Z',
      '2027-12-08T10:00:00Z',
      '2027-12-08T07:00:00Z',
    ]);

    const first = await service.get(hand(t), { date: '2027-12-07' }, NOW);
    const second = await service.get(hand(t), { date: '2027-12-08' }, NOW);

    expect(first.rows).toEqual([
      expect.objectContaining({
        bookingId: long.booking.id,
        start: '2027-12-07T14:00:00.000Z',
      }),
    ]);
    expect(second.rows).toEqual([
      expect.objectContaining({
        bookingId: long.booking.id,
        start: '2027-12-08T07:00:00.000Z',
      }),
    ]);
  });

  it('reads the day by Bucharest midnight, not UTC', async () => {
    const t = await team('Atelier Dinamo');
    const night = await bookedJob(t, ['2027-12-06T22:30:00Z']);

    const day = await service.get(hand(t), { date: '2027-12-07' }, NOW);
    const before = await service.get(hand(t), { date: '2027-12-06' }, NOW);

    expect(day.rows.map((r) => r.bookingId)).toEqual([night.booking.id]);
    expect(before.rows.map((r) => r.bookingId)).not.toContain(night.booking.id);
  });

  it('puts the jobs carried from earlier days first, on today only', async () => {
    const t = await team('Atelier Dinamo');
    const today = await bookedJob(t, ['2027-12-06T06:00:00Z']);
    const working = await bookedJob(
      t,
      ['2027-12-02T07:00:00Z', '2027-12-03T07:00:00Z'],
      { job: 'in_work' },
    );
    const paused = await bookedJob(t, ['2027-12-03T09:00:00Z'], {
      job: 'paused',
    });
    const doneToday = await bookedJob(t, ['2027-12-03T10:00:00Z'], {
      booking: 'completed',
      job: 'done',
    });
    await prisma.job.update({
      data: { finishedAt: new Date('2027-12-06T06:30:00Z') },
      where: { id: doneToday.job.id },
    });
    const doneBefore = await bookedJob(t, ['2027-12-03T11:00:00Z'], {
      booking: 'completed',
      job: 'done',
    });
    await prisma.job.update({
      data: { finishedAt: new Date('2027-12-03T15:00:00Z') },
      where: { id: doneBefore.job.id },
    });
    await bookedJob(t, ['2027-12-03T12:00:00Z'], { job: 'to_do' });

    const day = await service.get(hand(t), {}, NOW);
    const tomorrow = await service.get(hand(t), { date: '2027-12-07' }, NOW);

    expect(day.date).toBe('2027-12-06');
    expect(day.rows.map((r) => [r.bookingId, r.carryOver, r.start])).toEqual([
      [working.booking.id, true, '2027-12-03T07:00:00.000Z'],
      [paused.booking.id, true, '2027-12-03T09:00:00.000Z'],
      [doneToday.booking.id, true, '2027-12-03T10:00:00.000Z'],
      [today.booking.id, false, '2027-12-06T06:00:00.000Z'],
    ]);
    expect(day).toMatchObject({ inWork: 1, jobs: 4 });
    expect(tomorrow.rows).toEqual([]);
  });

  it('lists a job in work once when it also has a stretch today', async () => {
    const t = await team('Atelier Dinamo');
    const both = await bookedJob(
      t,
      ['2027-12-03T07:00:00Z', '2027-12-06T08:00:00Z'],
      { job: 'in_work' },
    );

    const day = await service.get(hand(t), {}, NOW);

    expect(day.rows).toEqual([
      expect.objectContaining({
        bookingId: both.booking.id,
        carryOver: false,
        start: '2027-12-06T08:00:00.000Z',
      }),
    ]);
  });

  it('names the lift only while the garage schedules lifts', async () => {
    const t = await team('Atelier Dinamo');
    await bookedJob(t, ['2027-12-07T07:00:00Z'], { lift: 2 });
    await bookedJob(t, ['2027-12-07T08:00:00Z']);

    const on = await service.get(hand(t), { date: '2027-12-07' }, NOW);
    await off(t, 'lift_schedule');
    const offDay = await service.get(hand(t), { date: '2027-12-07' }, NOW);

    expect(on.rows[0]).toMatchObject({ lift: 2 });
    expect(on.rows[1]).not.toHaveProperty('lift');
    for (const row of offDay.rows) expect(row).not.toHaveProperty('lift');
  });

  it('carries the clock, the steps and who holds the job', async () => {
    const t = await team('Atelier Dinamo');
    const { job } = await bookedJob(t, ['2027-12-06T06:00:00Z'], {
      job: 'in_work',
    });
    const since = new Date('2027-12-06T06:10:00Z');
    const lockAt = new Date('2027-12-06T06:11:00Z');
    await prisma.job.update({
      data: {
        inWorkSince: since,
        lockHolderId: t.plain,
        lockHolderRole: 'mechanic',
        lockLastChangeAt: lockAt,
        lockSince: lockAt,
        workedSeconds: 600,
      },
      where: { id: job.id },
    });
    await prisma.jobStep.createMany({
      data: [
        { doneAt: lockAt, jobId: job.id, label: 'Ridicare', position: 1 },
        { jobId: job.id, label: 'Filtru', position: 2 },
        { jobId: job.id, label: 'Ulei', position: 3 },
      ],
    });

    const [row] = (await service.get(hand(t), {}, NOW)).rows;

    expect(row).toMatchObject({
      inWorkSince: since.toISOString(),
      lock: {
        holder: { accountId: t.plain, firstName: 'Atelier', role: 'mechanic' },
        lastChangeAt: lockAt.toISOString(),
        since: lockAt.toISOString(),
      },
      stepsDone: 1,
      stepsTotal: 3,
      workedSeconds: 600,
    });
  });

  it('never carries the driver’s phone, e-mail or the garage’s notes', async () => {
    const t = await team('Atelier Dinamo');
    await bookedJob(t, ['2027-12-07T07:00:00Z']);

    const day = await service.get(hand(t), { date: '2027-12-07' }, NOW);

    expect(JSON.stringify(day)).not.toMatch(/@|phone|email|note/i);
  });
});
