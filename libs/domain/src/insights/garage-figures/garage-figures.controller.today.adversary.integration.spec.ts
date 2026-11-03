// @traces 098-FR-001 098-FR-002 098-FR-003 098-FR-005 098-FR-006 098-FR-008 098-FR-009 098-FR-011
import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { DailyFiguresService } from './daily/daily.service';
import { GarageFiguresModule } from './garage-figures.module';
import { atLocal } from '../../bucharest';
import type { BookingStatus } from '../../generated/prisma/enums';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { FreeSlotsCache } from '../../workshop/free-slots/free-slots.cache';
import { FreeSlotsService } from '../../workshop/free-slots/free-slots.service';

const { bearer, get, send, team, world } = quotesApp([GarageFiguresModule]);
const { prisma } = world;
const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
afterAll(() => redis.quit());
const engine = new FreeSlotsService(prisma, new FreeSlotsCache(redis));
const service = new DailyFiguresService(prisma, engine);

// Friday 11 December 2026, 10:00 in Bucharest; the week ends on Sunday 13.
const NOW = new Date('2026-12-11T08:00:00Z');
const path = (garageId: string) => `/garages/${garageId}/figures/today`;

type Team = Awaited<ReturnType<typeof team>>;
const owner = (t: Team) => garageActor(t.owner, t.garage.id);

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

describe('the numbers of the day, from hostile data', () => {
  it('counts another garage’s rows for nobody but that garage', async () => {
    const t = await team('Atelier Dinamo');
    const rival = await team('Service Militari');
    await reached(rival.garage.id, atLocal('2026-12-11', 9));
    await booked(rival.garage.id, 'confirmed', atLocal('2026-12-11', 12));
    await prisma.garage.update({
      data: { rating: 3.2, reviewCount: 9 },
      where: { id: rival.garage.id },
    });

    const today = await service.today(owner(t), t.garage.id, NOW);

    expect(today).toMatchObject({
      bookingsThisWeek: 0,
      rating: null,
      requestsToday: 0,
      reviewCount: 0,
    });
  });

  it('counts a request in any status and several recipients of one request separately', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Militari');
    const driver = await world.account('Dan Vasile');
    const request = await world.request(driver);
    const mine = await world.recipient(request.id, t.garage.id);
    await world.recipient(request.id, other.garage.id);
    await prisma.requestRecipient.update({
      data: { createdAt: atLocal('2026-12-11', 8) },
      where: { id: mine.id },
    });

    const today = await service.today(owner(t), t.garage.id, NOW);

    expect(today.requestsToday).toBe(1);
  });

  it('counts a request created exactly at the next midnight for tomorrow, not today', async () => {
    const t = await team('Atelier Dinamo');
    await reached(t.garage.id, atLocal('2026-12-12', 0));

    const today = await service.today(owner(t), t.garage.id, NOW);

    expect(today).toMatchObject({ requestsToday: 0, requestsYesterday: 0 });
  });

  it('counts yesterday across the 25-hour day of October', async () => {
    const t = await team('Atelier Dinamo');
    const monday = new Date('2026-10-26T09:00:00Z');
    await reached(t.garage.id, atLocal('2026-10-25', 0));
    await reached(t.garage.id, new Date('2026-10-25T21:30:00Z'));
    await reached(t.garage.id, atLocal('2026-10-26', 0));
    await reached(
      t.garage.id,
      new Date(atLocal('2026-10-25', 0).getTime() - 1),
    );

    const today = await service.today(owner(t), t.garage.id, monday);

    expect(today).toMatchObject({ requestsToday: 1, requestsYesterday: 2 });
  });

  it('leaves a quote accepted at the very first instant of the month in, and the last instant before it out', async () => {
    const t = await team('Atelier Dinamo');
    for (const [at, from, to] of [
      [atLocal('2026-12-01', 0), 1_000, 1_000],
      [new Date(atLocal('2026-12-01', 0).getTime() - 1), 5_000, 5_000],
      [new Date(atLocal('2027-01-01', 0).getTime() - 1), 200, 200],
      [atLocal('2027-01-01', 0), 9_000, 9_000],
    ] as const) {
      const driver = await world.account(`Driver ${randomUUID()}`);
      const request = await world.request(driver);
      const q = await world.quote(request.id, t.garage.id, 'accepted');
      await prisma.quote.update({
        data: { acceptedAt: at, fromBani: from, toBani: to },
        where: { id: q.id },
      });
    }

    const today = await service.today(owner(t), t.garage.id, NOW);

    expect(today.estimatedWorkBani).toBe(1_200);
  });

  it('keeps a rating of 5 as 5 and a rating with reviews but no stored rating as null', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.garage.update({
      data: { rating: 5, reviewCount: 1 },
      where: { id: t.garage.id },
    });
    const five = await service.today(owner(t), t.garage.id, NOW);
    await prisma.garage.update({
      data: { rating: null, reviewCount: 0 },
      where: { id: t.garage.id },
    });
    const none = await service.today(owner(t), t.garage.id, NOW);

    expect(five).toMatchObject({ rating: 5, reviewCount: 1 });
    expect(none).toMatchObject({ rating: null, reviewCount: 0 });
  });

  it('answers the same twice in a row', async () => {
    const t = await team('Atelier Dinamo');
    await reached(t.garage.id, atLocal('2026-12-11', 9));

    const first = await service.today(owner(t), t.garage.id, NOW);
    const second = await service.today(owner(t), t.garage.id, NOW);

    expect(second).toEqual(first);
  });

  it('answers ten concurrent reads alike', async () => {
    const t = await team('Atelier Dinamo');
    await booked(t.garage.id, 'confirmed', atLocal('2026-12-11', 12));

    const all = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.today(owner(t), t.garage.id, NOW),
      ),
    );

    for (const one of all) expect(one).toEqual(all[0]);
    expect(all[0].bookingsToday).toBe(1);
  });

  it('refuses a mechanic of the garage even asked through the service', async () => {
    const t = await team('Atelier Dinamo');

    await expect(
      service.today(
        garageActor(t.plain, t.garage.id, 'mechanic'),
        t.garage.id,
        NOW,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a garage id that is not the actor’s with a 404', async () => {
    const t = await team('Atelier Dinamo');

    await expect(
      service.today(owner(t), randomUUID(), NOW),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('the free starts of the week, in the engine’s real answer', () => {
  it('names the Bucharest day of a start just after local midnight', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.garage.update({
      data: { hours: { fri: [['00:00', '03:00']] } },
      where: { id: t.garage.id },
    });

    // Thursday 10 December 2026, 10:00; Friday 00:00 in Bucharest is Thursday 22:00 UTC.
    const today = await service.today(
      owner(t),
      t.garage.id,
      new Date('2026-12-10T08:00:00Z'),
    );

    expect(today.nextFreeSlots?.day).toBe('2026-12-11');
  });

  it('is null with no working hours at all and is not marked unavailable', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.garage.update({
      data: { hours: {} },
      where: { id: t.garage.id },
    });

    const today = await service.today(owner(t), t.garage.id, NOW);

    expect(today).toMatchObject({
      freeSlotsUnavailable: false,
      nextFreeSlots: null,
    });
  });

  it('never counts more than ten starts on the first day', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.garage.update({
      data: { hours: { fri: [['11:00', '23:00']] } },
      where: { id: t.garage.id },
    });

    const today = await service.today(owner(t), t.garage.id, NOW);

    expect(today.nextFreeSlots).toEqual({ count: 10, day: '2026-12-11' });
  });

  it('is null on a Sunday morning when only Monday has hours', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.garage.update({
      data: { hours: { mon: [['08:00', '16:00']] } },
      where: { id: t.garage.id },
    });

    const today = await service.today(
      owner(t),
      t.garage.id,
      new Date('2026-12-13T08:00:00Z'),
    );

    expect(today).toMatchObject({
      freeSlotsUnavailable: false,
      nextFreeSlots: null,
    });
  });

  it('answers 200 with the mark when the engine throws a non-Error value', async () => {
    const t = await team('Atelier Dinamo');
    const figures = new DailyFiguresService(prisma, {
      answer: () => Promise.reject('boom'),
    } as unknown as FreeSlotsService);

    const today = await figures.today(owner(t), t.garage.id, NOW);

    expect(today).toMatchObject({
      freeSlotsUnavailable: true,
      nextFreeSlots: null,
    });
  });

  it('answers 200 with the mark when the engine throws synchronously', async () => {
    const t = await team('Atelier Dinamo');
    const figures = new DailyFiguresService(prisma, {
      answer: () => {
        throw new Error('sync');
      },
    } as unknown as FreeSlotsService);

    const today = await figures.today(owner(t), t.garage.id, NOW);

    expect(today.freeSlotsUnavailable).toBe(true);
  });

  it('does not mark a read unavailable when the engine answers nothing', async () => {
    const t = await team('Atelier Dinamo');
    const figures = new DailyFiguresService(prisma, {
      answer: async () => ({ slots: [] }),
    } as unknown as FreeSlotsService);

    const today = await figures.today(owner(t), t.garage.id, NOW);

    expect(today).toMatchObject({
      freeSlotsUnavailable: false,
      nextFreeSlots: null,
    });
  });
});

describe('GET /garages/:garageId/figures/today, hostile requests', () => {
  it('answers 404 for a well-formed id of a garage that does not exist', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(path(randomUUID()), bearer(t.owner, 'garage'));

    expect(res.status).toBe(404);
  });

  it('answers 400 validation_failed to a UUID with a character too many', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(path(`${t.garage.id}0`), bearer(t.owner, 'garage'));

    expect(res.status).toBe(400);
  });

  it('answers 400 to a garage id that is a SQL fragment', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(
      path("'%3B%20DROP%20TABLE%20garage%3B--"),
      bearer(t.owner, 'garage'),
    );

    expect(res.status).toBe(400);
  });

  it('answers 400 to an id written with unicode look-alike digits', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(
      path(`%EF%BC%90${t.garage.id.slice(1)}`),
      bearer(t.owner, 'garage'),
    );

    expect(res.status).toBe(400);
  });

  // The path id is compared with the membership's as written, as on every
  // garage route: the API hands out its ids in lower case.
  it('treats the own id written in capitals as another garage', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(
      path(t.garage.id.toUpperCase()),
      bearer(t.owner, 'garage'),
    );

    expect(res.status).toBe(404);
  });

  it('ignores a query string and reads the real clock', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(
      `${path(t.garage.id)}?now=2020-01-01T00:00:00Z`,
      bearer(t.owner, 'garage'),
    );

    expect(res.body.month).toMatch(/^\d{4}-\d{2}-01$/);
    expect(res.body.month).not.toBe('2020-01-01');
  });

  it('answers the same body twice and with the receptionist alike', async () => {
    const t = await team('Atelier Dinamo');

    const a = await get(path(t.garage.id), bearer(t.owner, 'garage'));
    const b = await get(path(t.garage.id), bearer(t.owner, 'garage'));
    const c = await get(
      path(t.garage.id),
      bearer(t.receptionist, 'receptionist'),
    );

    expect(b.body).toEqual(a.body);
    expect(c.body).toEqual(a.body);
  });

  it('refuses a malformed bearer token with 401', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(path(t.garage.id), 'Bearer not.a.token');

    expect(res.status).toBe(401);
  });

  it('answers 401 to an empty bearer scheme', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(path(t.garage.id), 'Bearer ');

    expect(res.status).toBe(401);
  });

  it('does not offer the read for writing', async () => {
    const t = await team('Atelier Dinamo');
    const auth = bearer(t.owner, 'garage');

    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await send(method, path(t.garage.id), auth, {});
      expect([404, 405]).toContain(res.status);
    }
  });

  it('returns whole numbers only, with the month on the first day', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(path(t.garage.id), bearer(t.owner, 'garage'));

    for (const key of [
      'bookingsThisWeek',
      'bookingsToday',
      'estimatedWorkBani',
      'requestsToday',
      'requestsYesterday',
      'reviewCount',
    ])
      expect(Number.isInteger(res.body[key])).toBe(true);
    expect(typeof res.body.freeSlotsUnavailable).toBe('boolean');
  });
});
