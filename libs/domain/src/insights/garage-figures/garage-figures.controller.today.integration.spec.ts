// @traces 098-FR-001 098-FR-002 098-FR-003 098-FR-004 098-FR-005 098-FR-006 098-FR-007 098-FR-008 098-FR-009 098-FR-010 098-FR-011
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { Redis } from 'ioredis';

import { DailyFiguresService } from './daily/daily.service';
import { GarageFiguresModule } from './garage-figures.module';
import { GarageFiguresService } from './garage-figures.service';
import { atLocal } from '../../bucharest';
import type { BookingStatus } from '../../generated/prisma/enums';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { FreeSlotsCache } from '../../workshop/free-slots/free-slots.cache';
import { FreeSlotsService } from '../../workshop/free-slots/free-slots.service';

const { bearer, get, team, world } = quotesApp([GarageFiguresModule]);
const { prisma } = world;
const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
afterAll(() => redis.quit());
const engine = new FreeSlotsService(prisma, new FreeSlotsCache(redis));
const service = new DailyFiguresService(prisma, engine);

// Friday 11 December 2026, 10:00 in Bucharest: the week runs from Monday 7
// to Sunday 13 December.
const NOW = new Date('2026-12-11T08:00:00Z');

const path = (garageId: string) => `/garages/${garageId}/figures/today`;

type Team = Awaited<ReturnType<typeof team>>;
const owner = (t: Team) => garageActor(t.owner, t.garage.id);

const WEEKDAYS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => [day, [['08:00', '16:30']]]),
);

beforeEach(() =>
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {}),
);
afterEach(() => vi.restoreAllMocks());

async function reached(garageId: string, at: Date) {
  const driver = await world.account(`Driver ${randomUUID()}`);
  const request = await world.request(driver);
  const row = await world.recipient(request.id, garageId);
  await prisma.requestRecipient.update({
    data: { createdAt: at },
    where: { id: row.id },
  });
}

async function booked(garageId: string, status: BookingStatus, startsAt: Date) {
  const driver = await world.account(`Driver ${randomUUID()}`);
  const request = await world.request(driver);
  const q = await world.quote(request.id, garageId, 'accepted');
  const b = await world.booking(q.id, status);
  await prisma.booking.update({ data: { startsAt }, where: { id: b.id } });
}

// A quote the garage won at `acceptedAt`, booked well before the week when a
// booking is given.
async function won(
  garageId: string,
  acceptedAt: Date,
  fromBani: number,
  toBani: number,
  booking?: { status: BookingStatus; finalBani?: number },
) {
  const driver = await world.account(`Driver ${randomUUID()}`);
  const request = await world.request(driver);
  const q = await world.quote(request.id, garageId, 'accepted');
  await prisma.quote.update({
    data: { acceptedAt, fromBani, toBani },
    where: { id: q.id },
  });
  if (!booking) return;
  const b = await world.booking(q.id, booking.status);
  await prisma.booking.update({
    data: { startsAt: atLocal('2026-11-20', 9) },
    where: { id: b.id },
  });
  if (booking.finalBani === undefined) return;
  const job = await world.job(b.id);
  await prisma.job.update({
    data: { finalPriceBani: booking.finalBani },
    where: { id: job.id },
  });
}

async function dinamo() {
  const t = await team('Atelier Dinamo');
  await prisma.garage.update({
    data: { hours: WEEKDAYS, rating: 4.9, reviewCount: 212 },
    where: { id: t.garage.id },
  });
  return t;
}

describe('the numbers of the day', () => {
  it('counts the requests of today and of yesterday, Bucharest days', async () => {
    const t = await dinamo();
    const g = t.garage.id;
    await reached(g, atLocal('2026-12-11', 0));
    await reached(g, atLocal('2026-12-11', 9));
    await reached(g, atLocal('2026-12-11', 23));
    await reached(g, new Date(atLocal('2026-12-11', 0).getTime() - 60_000));
    await reached(g, atLocal('2026-12-12', 0));
    await reached(g, new Date(atLocal('2026-12-10', 0).getTime() - 60_000));

    const today = await service.today(owner(t), g, NOW);

    expect(today).toMatchObject({ requestsToday: 3, requestsYesterday: 1 });
  });

  it('counts the confirmed and completed bookings of the week and of today', async () => {
    const t = await dinamo();
    const g = t.garage.id;
    await booked(g, 'confirmed', atLocal('2026-12-07', 0));
    await booked(g, 'completed', atLocal('2026-12-09', 10));
    await booked(g, 'confirmed', atLocal('2026-12-11', 12));
    await booked(g, 'confirmed', atLocal('2026-12-13', 23));
    await booked(g, 'awaiting_confirmation', atLocal('2026-12-10', 9));
    await booked(g, 'cancelled', atLocal('2026-12-10', 9));
    await booked(g, 'lapsed', atLocal('2026-12-11', 9));
    await booked(g, 'confirmed', atLocal('2026-12-14', 0));
    await booked(
      g,
      'confirmed',
      new Date(atLocal('2026-12-07', 0).getTime() - 60_000),
    );

    const today = await service.today(owner(t), g, NOW);

    expect(today).toMatchObject({ bookingsThisWeek: 4, bookingsToday: 1 });
  });

  it('sums the month’s won work from final prices and accepted ranges', async () => {
    const t = await dinamo();
    const g = t.garage.id;
    await won(g, atLocal('2026-12-02', 10), 42_000, 65_000, {
      finalBani: 60_000,
      status: 'completed',
    });
    await won(g, atLocal('2026-12-09', 10), 76_000, 110_000, {
      status: 'confirmed',
    });
    await won(g, atLocal('2026-11-30', 23), 50_000, 70_000);
    await won(g, atLocal('2026-12-05', 10), 50_000, 70_000, {
      status: 'lapsed',
    });

    const today = await service.today(owner(t), g, NOW);

    expect(today).toMatchObject({
      estimatedWorkBani: 153_000,
      month: '2026-12-01',
    });
    // The period read gives the same sum for the same month.
    const month = await new GarageFiguresService(prisma).get(
      owner(t),
      { period: 'month' },
      NOW,
    );
    expect(month.current.estimatedWorkBani).toBe(153_000);
  });

  it('gives the stored rating and its review count', async () => {
    const t = await dinamo();

    const today = await service.today(owner(t), t.garage.id, NOW);

    expect(today).toMatchObject({ rating: 4.9, reviewCount: 212 });
  });

  it('names the first day of the week with a free start', async () => {
    const t = await dinamo();

    const today = await service.today(owner(t), t.garage.id, NOW);

    expect(today.freeSlotsUnavailable).toBe(false);
    expect(today.nextFreeSlots?.day).toBe('2026-12-11');
    expect(today.nextFreeSlots?.count).toBe(10);
  });

  it('answers zeros and no rating for a new garage', async () => {
    const t = await team('Service Nou');

    const today = await service.today(owner(t), t.garage.id, NOW);

    expect(today).toMatchObject({
      bookingsThisWeek: 0,
      bookingsToday: 0,
      estimatedWorkBani: 0,
      rating: null,
      requestsToday: 0,
      requestsYesterday: 0,
      reviewCount: 0,
    });
  });

  it('does not ask for free slots once the earliest start falls after Sunday', async () => {
    const t = await dinamo();
    const answer = vi.fn();
    const figures = new DailyFiguresService(prisma, {
      answer,
    } as unknown as FreeSlotsService);

    // Sunday 13 December 2026, 23:10 in Bucharest.
    const late = await figures.today(
      owner(t),
      t.garage.id,
      new Date('2026-12-13T21:10:00Z'),
    );

    expect(answer).not.toHaveBeenCalled();
    expect(late).toMatchObject({
      freeSlotsUnavailable: false,
      nextFreeSlots: null,
    });
  });

  it('still answers the counts when the free slots fail, marks it, logs and counts it once', async () => {
    const t = await dinamo();
    await booked(t.garage.id, 'confirmed', atLocal('2026-12-11', 12));
    const add = vi.fn();
    vi.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: () => ({ add }),
    } as unknown as ReturnType<typeof metrics.getMeter>);
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const figures = new DailyFiguresService(prisma, {
      answer: () => Promise.reject(new Error('hours unreadable')),
    } as unknown as FreeSlotsService);

    const today = await figures.today(owner(t), t.garage.id, NOW);

    expect(today).toMatchObject({
      bookingsThisWeek: 1,
      bookingsToday: 1,
      freeSlotsUnavailable: true,
      nextFreeSlots: null,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('writes nothing', async () => {
    const t = await dinamo();
    const written = async () => ({
      activity: await prisma.activityLog.count(),
      notifications: await prisma.notification.count(),
      outbox: await prisma.outboxEvent.count(),
    });
    const before = await written();

    await get(path(t.garage.id), bearer(t.owner, 'garage'));
    await service.today(owner(t), t.garage.id, NOW);

    expect(await written()).toEqual(before);
  });
});

describe('GET /garages/:garageId/figures/today', () => {
  it('answers the owner and the desk', async () => {
    const t = await dinamo();

    for (const auth of [
      bearer(t.owner, 'garage'),
      bearer(t.receptionist, 'receptionist'),
    ]) {
      const res = await get(path(t.garage.id), auth);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'bookingsThisWeek',
        'bookingsToday',
        'estimatedWorkBani',
        'freeSlotsUnavailable',
        'month',
        'nextFreeSlots',
        'rating',
        'requestsToday',
        'requestsYesterday',
        'reviewCount',
      ]);
      expect(res.body.rating).toBe(4.9);
      expect(res.body.month).toMatch(/^\d{4}-\d{2}-01$/);
    }
  });

  it('tells the garage’s own mechanic no', async () => {
    const t = await team('Atelier Dinamo');

    for (const auth of [
      bearer(t.plain, 'mechanic'),
      bearer(t.answering, 'mechanic'),
    ])
      expect((await get(path(t.garage.id), auth)).status).toBe(403);
  });

  it('answers 404 to another garage, a driver, an admin and a lone mechanic', async () => {
    const t = await team('Atelier Dinamo');
    const rival = await team('Service Militari');
    const driver = await world.account('Dan Vasile');
    const admin = await world.account('Ana Admin', ['admin']);
    const lone = await world.account('Ion Liber', ['mechanic']);

    for (const auth of [
      bearer(rival.owner, 'garage'),
      bearer(rival.receptionist, 'receptionist'),
      bearer(driver, 'driver'),
      bearer(admin, 'admin'),
      bearer(lone, 'mechanic'),
    ])
      expect((await get(path(t.garage.id), auth)).status).toBe(404);
  });

  it('answers 400 to an id that is not one and 401 to a visitor', async () => {
    const t = await team('Atelier Dinamo');

    const bad = await get(path('not-a-garage'), bearer(t.owner, 'garage'));
    expect(bad.status).toBe(400);
    const visitor = await get(path(t.garage.id));
    expect([visitor.status, visitor.body.code]).toEqual([
      401,
      'sign_in_required',
    ]);
  });
});

describe('the daily figures in the OpenAPI document', () => {
  const doc = JSON.parse(
    readFileSync(
      join(__dirname, '../../../../../apps/api/openapi.json'),
      'utf8',
    ),
  );
  const read = doc.paths['/api/v1/garages/{garageId}/figures/today']?.get;

  it('is one read with its refusals', () => {
    expect(read?.operationId).toBe('garageTodayFigures');
    expect(Object.keys(read?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
    ]);
  });
});
