// @traces 374-FR-007
// @traces 374-FR-008
// @traces 374-FR-009
// @traces 374-FR-012
// @traces 374-FR-013
import { GarageFiguresService } from './garage-figures.service';
import type { BookingStatus } from '../../generated/prisma/enums';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { team, world } = quotesApp();
const { prisma } = world;
const service = new GarageFiguresService(prisma);

// Friday 9 October 2026, 10:00 in Bucharest: the week is 5 to 11 October.
const NOW = new Date('2026-10-09T07:00:00Z');
const MINUTE = 60_000;

type Team = Awaited<ReturnType<typeof team>>;

const owner = (t: Team) => garageActor(t.owner, t.garage.id);

// A request reaching the garage at `at`, answered `minutes` later when given,
// with a quote sent then, accepted and booked as asked.
async function asked(
  garageId: string,
  at: string,
  minutes?: number,
  quote?: {
    acceptedAt?: string;
    booking?: { status: BookingStatus; startsAt: string; finalBani?: number };
  },
) {
  const driver = await world.account('Andrei Ion Marin');
  const request = await world.request(driver);
  const createdAt = new Date(at);
  const answeredAt =
    minutes === undefined
      ? null
      : new Date(createdAt.getTime() + minutes * MINUTE);
  const recipient = await world.recipient(
    request.id,
    garageId,
    answeredAt ? 'quoted' : 'waiting',
  );
  await prisma.requestRecipient.update({
    data: { answeredAt, createdAt },
    where: { id: recipient.id },
  });
  if (!answeredAt || !quote) return;
  const q = await world.quote(
    request.id,
    garageId,
    quote.acceptedAt ? 'accepted' : 'waiting',
  );
  await prisma.quote.update({
    data: {
      sentAt: answeredAt,
      ...(quote.acceptedAt && { acceptedAt: new Date(quote.acceptedAt) }),
    },
    where: { id: q.id },
  });
  if (!quote.booking) return;
  const booking = await world.booking(q.id, quote.booking.status);
  await prisma.booking.update({
    data: { startsAt: new Date(quote.booking.startsAt) },
    where: { id: booking.id },
  });
  if (quote.booking.finalBani !== undefined) {
    const job = await world.job(booking.id);
    await prisma.job.update({
      data: { finalPriceBani: quote.booking.finalBani },
      where: { id: job.id },
    });
  }
}

async function twoWeeks(t: Team) {
  const g = t.garage.id;
  await asked(g, '2026-10-06T08:00:00Z', 30, {
    acceptedAt: '2026-10-07T09:00:00Z',
    booking: {
      finalBani: 70_000,
      startsAt: '2026-10-08T07:00:00Z',
      status: 'confirmed',
    },
  });
  await asked(g, '2026-10-07T10:00:00Z', 50, {
    acceptedAt: '2026-10-08T09:00:00Z',
    booking: {
      startsAt: '2026-10-12T07:00:00Z',
      status: 'awaiting_confirmation',
    },
  });
  await asked(g, '2026-10-05T06:00:00Z', 10, {
    acceptedAt: '2026-10-05T09:00:00Z',
    booking: { startsAt: '2026-10-06T07:00:00Z', status: 'cancelled' },
  });
  // 00:30 on Monday 5 October in Bucharest, still Sunday in UTC.
  await asked(g, '2026-10-04T21:30:00Z');
  await asked(g, '2026-09-29T08:00:00Z', 20, {});
}

const THIS_WEEK = {
  bookings: 1,
  estimatedWorkBani: 70_000 + 52_500,
  quotesSent: 3,
  quotesWon: 3,
  requests: 4,
  responseTimeMinutes: 30,
};

describe('the garage figures read', () => {
  it('counts this week, Monday to Sunday in Bucharest, beside the week before', async () => {
    const t = await team('Atelier Dinamo');
    await twoWeeks(t);

    const figures = await service.get(
      owner(t),
      { compareWithPrevious: true, period: 'week' },
      NOW,
    );

    expect(figures).toEqual({
      current: THIS_WEEK,
      period: { from: '2026-10-05', to: '2026-10-11' },
      previous: {
        bookings: 0,
        estimatedWorkBani: 0,
        period: { from: '2026-09-28', to: '2026-10-04' },
        quotesSent: 1,
        quotesWon: 0,
        requests: 1,
        responseTimeMinutes: 20,
      },
    });
  });

  it('answers the week alone by default', async () => {
    const t = await team('Atelier Dinamo');
    await twoWeeks(t);

    const figures = await service.get(owner(t), {}, NOW);

    expect(figures).toEqual({
      current: THIS_WEEK,
      period: { from: '2026-10-05', to: '2026-10-11' },
    });
  });

  it('counts the calendar month beside the month before', async () => {
    const t = await team('Atelier Dinamo');
    await twoWeeks(t);

    const figures = await service.get(
      owner(t),
      { compareWithPrevious: true, period: 'month' },
      NOW,
    );

    expect(figures.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(figures.current).toEqual(THIS_WEEK);
    expect(figures.previous).toMatchObject({
      period: { from: '2026-09-01', to: '2026-09-30' },
      requests: 1,
    });
  });

  it('compares a range with as many days ending the day before it', async () => {
    const t = await team('Atelier Dinamo');
    await twoWeeks(t);

    const figures = await service.get(
      owner(t),
      { compareWithPrevious: true, from: '2026-10-06', to: '2026-10-08' },
      NOW,
    );

    expect(figures.period).toEqual({ from: '2026-10-06', to: '2026-10-08' });
    expect(figures.current.requests).toBe(2);
    expect(figures.previous?.period).toEqual({
      from: '2026-10-03',
      to: '2026-10-05',
    });
    expect(figures.previous?.requests).toBe(2);
  });

  it('takes the middle of two response times, rounded half up', async () => {
    const t = await team('Atelier Dinamo');
    await asked(t.garage.id, '2026-10-06T08:00:00Z', 10);
    await asked(t.garage.id, '2026-10-06T09:00:00Z', 25);

    const figures = await service.get(owner(t), {}, NOW);

    expect(figures.current.responseTimeMinutes).toBe(18);
  });

  it('answers zeros and no response time for a quiet period', async () => {
    const t = await team('Atelier Dinamo');

    const figures = await service.get(owner(t), {}, NOW);

    expect(figures.current).toEqual({
      bookings: 0,
      estimatedWorkBani: 0,
      quotesSent: 0,
      quotesWon: 0,
      requests: 0,
      responseTimeMinutes: null,
    });
  });

  it('never counts another garage’s rows', async () => {
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    await twoWeeks(dinamo);
    await twoWeeks(militari);
    await asked(militari.garage.id, '2026-10-06T08:00:00Z', 5);

    const figures = await service.get(owner(dinamo), {}, NOW);

    expect(figures.current).toEqual(THIS_WEEK);
  });

  it.each([
    [
      'a period and a range',
      { from: '2026-10-01', period: 'week', to: '2026-10-02' },
    ],
    ['a range with no end', { from: '2026-10-01' }],
    [
      'a range ending before it starts',
      { from: '2026-10-02', to: '2026-10-01' },
    ],
    ['a range of 367 days', { from: '2025-10-01', to: '2026-10-02' }],
  ] as const)('refuses %s', async (_case, input) => {
    const t = await team('Atelier Dinamo');

    await expect(service.get(owner(t), input, NOW)).rejects.toMatchObject({
      response: { code: 'validation' },
      status: 400,
    });
  });

  it('accepts a range of 366 days', async () => {
    const t = await team('Atelier Dinamo');

    const figures = await service.get(
      owner(t),
      { from: '2025-10-02', to: '2026-10-02' },
      NOW,
    );

    expect(figures.period).toEqual({ from: '2025-10-02', to: '2026-10-02' });
  });

  it('gives the receptionist the same numbers and refuses a mechanic or a driver', async () => {
    const t = await team('Atelier Dinamo');
    await twoWeeks(t);

    const desk = await service.get(
      garageActor(t.receptionist, t.garage.id, 'receptionist'),
      {},
      NOW,
    );

    expect(desk.current).toEqual(THIS_WEEK);
    await expect(
      service.get(garageActor(t.plain, t.garage.id, 'mechanic'), {}, NOW),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.get(garageActor(t.owner, t.garage.id, 'driver'), {}, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('changes nothing', async () => {
    const t = await team('Atelier Dinamo');
    await twoWeeks(t);
    const before = await prisma.quote.findMany({ orderBy: { id: 'asc' } });
    const logged = await prisma.activityLog.count();

    await service.get(owner(t), { compareWithPrevious: true }, NOW);

    expect(await prisma.quote.findMany({ orderBy: { id: 'asc' } })).toEqual(
      before,
    );
    expect(await prisma.activityLog.count()).toBe(logged);
  });
});
