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
  starts: string[],
  options: {
    booking?: BookingStatus;
    job?: JobStatus | null;
    mechanicId?: string | null;
  } = {},
) {
  const mechanicId =
    options.mechanicId === undefined ? t.plainMechanic.id : options.mechanicId;
  const status = options.booking ?? 'confirmed';
  const placed = await world.booked(t.garage.id, starts[0], status);
  const booking = await prisma.booking.update({
    data: { mechanicId },
    where: { id: placed.id },
  });
  for (const start of status === 'confirmed' ? starts.slice(1) : starts) {
    const at = new Date(start);
    await prisma.bookingSegment.create({
      data: {
        bookingId: booking.id,
        endsAt: new Date(at.getTime() + 60 * 60_000),
        garageId: t.garage.id,
        startsAt: at,
      },
    });
  }
  const job =
    options.job === null
      ? null
      : await world.job(booking.id, options.job ?? 'to_do', {
          mechanicId: mechanicId ?? undefined,
        });
  return { booking, job };
}

const ids = (day: { rows: { bookingId: string }[] }) =>
  day.rows.map((r) => r.bookingId);

const writes = async () => [
  await prisma.activityLog.count(),
  await prisma.outboxEvent.count(),
  await prisma.jobStageEntry.count(),
];

// @traces 122-FR-008
describe('the carry-over of the mechanic’s day at its edges', () => {
  it('carries a job finished at Bucharest midnight today and not one finished a millisecond before', async () => {
    const t = await team('Atelier Dinamo');
    const edge = await bookedJob(t, ['2027-12-03T07:00:00Z'], {
      booking: 'completed',
      job: 'done',
    });
    const before = await bookedJob(t, ['2027-12-03T08:00:00Z'], {
      booking: 'completed',
      job: 'done',
    });
    await prisma.job.update({
      data: { finishedAt: new Date('2027-12-05T22:00:00.000Z') },
      where: { id: edge.job?.id },
    });
    await prisma.job.update({
      data: { finishedAt: new Date('2027-12-05T21:59:59.999Z') },
      where: { id: before.job?.id },
    });

    const day = await service.get(hand(t), {}, NOW);

    expect(day.rows).toEqual([
      expect.objectContaining({
        bookingId: edge.booking.id,
        carryOver: true,
        status: 'done',
      }),
    ]);
  });

  it('shows a job in work that has only a later stretch as carry-over today at its first stretch', async () => {
    const t = await team('Atelier Dinamo');
    const ahead = await bookedJob(t, ['2027-12-08T07:00:00Z'], {
      job: 'in_work',
    });

    const today = await service.get(hand(t), {}, NOW);
    const thatDay = await service.get(hand(t), { date: '2027-12-08' }, NOW);

    expect(today.rows).toEqual([
      expect.objectContaining({
        bookingId: ahead.booking.id,
        carryOver: true,
        start: '2027-12-08T07:00:00.000Z',
      }),
    ]);
    expect(thatDay.rows).toEqual([
      expect.objectContaining({
        bookingId: ahead.booking.id,
        carryOver: false,
      }),
    ]);
  });

  it('takes the latest stretch before today as the carry-over start', async () => {
    const t = await team('Atelier Dinamo');
    const multi = await bookedJob(
      t,
      ['2027-12-01T07:00:00Z', '2027-12-03T07:00:00Z', '2027-12-05T07:00:00Z'],
      { job: 'paused' },
    );

    const day = await service.get(hand(t), {}, NOW);

    expect(day.rows).toEqual([
      expect.objectContaining({
        bookingId: multi.booking.id,
        carryOver: true,
        start: '2027-12-05T07:00:00.000Z',
      }),
    ]);
  });

  it.each(['2027-12-05', '2027-12-07'])(
    'lists no carry-over on %s, a day other than today',
    async (date) => {
      const t = await team('Atelier Dinamo');
      await bookedJob(t, ['2027-12-02T07:00:00Z'], { job: 'paused' });
      await bookedJob(t, ['2027-12-02T08:00:00Z'], { job: 'in_work' });

      const day = await service.get(hand(t), { date }, NOW);

      expect(day).toEqual({ date, inWork: 0, jobs: 0, rows: [] });
    },
  );

  it('does not carry a to_do job whose stretch was yesterday', async () => {
    const t = await team('Atelier Dinamo');
    await bookedJob(t, ['2027-12-05T07:00:00Z'], { job: 'to_do' });

    const day = await service.get(hand(t), {}, NOW);

    expect(day.rows).toEqual([]);
  });

  it('lists a job finished today with a stretch today once, not as carry-over', async () => {
    const t = await team('Atelier Dinamo');
    const done = await bookedJob(t, ['2027-12-06T05:00:00Z'], {
      booking: 'completed',
      job: 'done',
    });
    await prisma.job.update({
      data: { finishedAt: new Date('2027-12-06T06:00:00Z') },
      where: { id: done.job?.id },
    });

    const day = await service.get(hand(t), {}, NOW);

    expect(day.rows).toEqual([
      expect.objectContaining({ bookingId: done.booking.id, carryOver: false }),
    ]);
  });

  it('puts two stretches of one booking on one day in one row at the earlier start', async () => {
    const t = await team('Atelier Dinamo');
    const two = await bookedJob(t, [
      '2027-12-06T13:00:00Z',
      '2027-12-06T06:00:00Z',
    ]);

    const day = await service.get(hand(t), {}, NOW);

    expect(day.rows).toEqual([
      expect.objectContaining({
        bookingId: two.booking.id,
        start: '2027-12-06T06:00:00.000Z',
      }),
    ]);
    expect(day.jobs).toBe(1);
  });

  it('leaves out a booking with no mechanic and a job in work whose booking has none', async () => {
    const t = await team('Atelier Dinamo');
    await bookedJob(t, ['2027-12-06T07:00:00Z'], { mechanicId: null });
    await bookedJob(t, ['2027-12-02T07:00:00Z'], {
      job: 'in_work',
      mechanicId: null,
    });

    const day = await service.get(hand(t), {}, NOW);

    expect(day).toEqual({ date: '2027-12-06', inWork: 0, jobs: 0, rows: [] });
  });

  it('answers a confirmed booking that has no job without failing', async () => {
    const t = await team('Atelier Dinamo');
    const mine = await bookedJob(t, ['2027-12-06T07:00:00Z']);
    await bookedJob(t, ['2027-12-06T08:00:00Z'], { job: null });

    const day = await service.get(hand(t), {}, NOW);

    expect(ids(day)).toContain(mine.booking.id);
    expect(day.rows.every((r) => typeof r.jobId === 'string')).toBe(true);
  });

  it('counts only the in_work rows, carry-over included', async () => {
    const t = await team('Atelier Dinamo');
    await bookedJob(t, ['2027-12-02T07:00:00Z'], { job: 'in_work' });
    await bookedJob(t, ['2027-12-02T08:00:00Z'], { job: 'paused' });
    await bookedJob(t, ['2027-12-06T08:00:00Z'], { job: 'to_do' });

    const day = await service.get(hand(t), {}, NOW);

    expect({ inWork: day.inWork, jobs: day.jobs }).toEqual({
      inWork: 1,
      jobs: 3,
    });
  });

  it('orders three hundred rows of one start by booking id and lists each once', async () => {
    const t = await team('Atelier Dinamo');
    const made = [];
    for (let i = 0; i < 300; i++) {
      made.push(await bookedJob(t, ['2027-12-06T07:00:00Z']));
    }

    const day = await service.get(hand(t), {}, NOW);

    const expected = made.map((m) => m.booking.id).sort();
    expect(ids(day)).toEqual(expected);
    expect(day.jobs).toBe(300);
  }, 120_000);

  it('answers the same day twice and the same day to two reads at once', async () => {
    const t = await team('Atelier Dinamo');
    await bookedJob(t, ['2027-12-02T07:00:00Z'], { job: 'in_work' });
    await bookedJob(t, ['2027-12-06T08:00:00Z']);

    const [a, b] = await Promise.all([
      service.get(hand(t), {}, NOW),
      service.get(hand(t), {}, NOW),
    ]);
    const c = await service.get(hand(t), {}, NOW);

    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});

// @traces 122-FR-005 122-FR-006
describe('GET /me/day refusals', () => {
  it('names invalid and out_of_range apart on the date', async () => {
    const t = await team('Atelier Dinamo');
    const today = localDay(new Date());

    const bad = await get(
      '/me/day?date=2027-02-29',
      bearer(t.plain, 'mechanic'),
    );
    const far = await get(
      `/me/day?date=${addDays(today, 31)}`,
      bearer(t.plain, 'mechanic'),
    );
    const back = await get(
      `/me/day?date=${addDays(today, -31)}`,
      bearer(t.plain, 'mechanic'),
    );

    expect(bad.body.errors).toEqual([
      expect.objectContaining({ code: 'invalid', field: 'date' }),
    ]);
    expect(far.body.errors).toEqual([
      expect.objectContaining({ code: 'out_of_range', field: 'date' }),
    ]);
    expect(back.body.errors).toEqual([
      expect.objectContaining({ code: 'out_of_range', field: 'date' }),
    ]);
  });

  it('writes nothing when it refuses a caller, a date or a missing session', async () => {
    const t = await team('Atelier Dinamo');
    await bookedJob(t, [`${localDay(new Date())}T09:00:00Z`], {
      job: 'in_work',
    });
    const before = await writes();

    const owner = await get('/me/day', bearer(t.owner, 'garage'));
    const bad = await get('/me/day?date=nope', bearer(t.plain, 'mechanic'));
    const anon = await get('/me/day');

    expect([owner.status, bad.status, anon.status]).toEqual([404, 422, 401]);
    expect(anon.body).toMatchObject({ code: 'sign_in_required' });
    expect(await writes()).toEqual(before);
  });

  it('answers not found to a mechanic bearer whose account is a mechanic of another garage only', async () => {
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    await bookedJob(dinamo, [`${localDay(new Date())}T09:00:00Z`]);

    const res = await get('/me/day', bearer(militari.owner, 'mechanic'));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'not_found' });
  });
});
