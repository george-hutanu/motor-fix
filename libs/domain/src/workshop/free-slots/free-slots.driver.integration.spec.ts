import { Logger } from '@nestjs/common';

import { addDays, atLocal, localDay } from '../../bucharest';
import type { BookingStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, world } = quotesApp();
const { prisma } = world;

const MINUTE = 60_000;
const STEP = 30 * MINUTE;
const WEEK = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
    day,
    [['08:00', '20:00']],
  ]),
);

// Three days out or later, on a weekday no public holiday closes.
let DAY: string;
const weekend = (d: string) => [0, 6].includes(new Date(d).getUTCDay());
const holiday = (d: string) =>
  prisma.publicHoliday.findUnique({
    where: { day: new Date(`${d}T00:00:00Z`) },
  });
beforeAll(async () => {
  let day = addDays(localDay(new Date()), 3);
  while (weekend(day) || (await holiday(day))) day = addDays(day, 1);
  DAY = day;
});

const at = (hour: number, minute = 0, day = DAY) =>
  new Date(atLocal(day, hour).getTime() + minute * MINUTE);

beforeEach(() =>
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {}),
);
afterEach(() => vi.restoreAllMocks());

// Atelier Dinamo open every day 08:00 to 20:00 with Elena, who works all
// of those hours, Saturdays included.
async function setting() {
  const garage = await world.garage('Atelier Dinamo');
  await prisma.garage.update({
    data: { hours: WEEK },
    where: { id: garage.id },
  });
  const elena = await prisma.mechanic.create({
    data: {
      garageId: garage.id,
      name: 'Elena Stan',
      workingHours: WEEK,
      worksSaturdays: true,
    },
  });
  return { elena, garage };
}

type Query = Record<string, string | number | undefined>;

const ask = (garageId: string, driverId: string, query: Query) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.append(key, String(value));
  }
  return get(
    `/garages/${garageId}/free-slots?${params}`,
    bearer(driverId, 'driver'),
  );
};

const starts = (body: { slots: { startsAt: string }[] }) =>
  body.slots.map((slot) => new Date(slot.startsAt).getTime());

// A driver holding a quote from the garage, on a request of her own.
async function quoted(garageId: string, status: 'waiting' | 'withdrawn') {
  const driver = await world.account('Ioana Popescu');
  const request = await world.request(driver);
  const quote = await world.quote(request.id, garageId, status);
  return { driver, quote };
}

// @traces 154-FR-002
// @traces 154-FR-007
describe('a driver moving her booking', () => {
  it.each<BookingStatus>(['awaiting_confirmation', 'confirmed'])(
    'offers back the time of her own %s booking when it is left out',
    async (status) => {
      const s = await setting();
      const booking = await world.booked(
        s.garage.id,
        at(10).toISOString(),
        status,
        { mechanicId: s.elena.id },
      );
      const query = {
        count: 1,
        duration: 90,
        earliest: at(10).toISOString(),
        horizonDays: 1,
      };

      const kept = await ask(s.garage.id, booking.driverId, query);
      const left = await ask(s.garage.id, booking.driverId, {
        ...query,
        excludeBookingId: booking.id,
      });

      expect([kept.status, left.status]).toEqual([200, 200]);
      expect(starts(kept.body)).toEqual([at(11, 30).getTime()]);
      expect(starts(left.body)).toEqual([at(10).getTime()]);
    },
  );

  it("refuses to leave out another driver's booking at the garage, 400", async () => {
    const s = await setting();
    const hers = await world.booked(
      s.garage.id,
      at(10).toISOString(),
      'confirmed',
    );
    const theirs = await world.booked(
      s.garage.id,
      at(14).toISOString(),
      'confirmed',
    );

    const res = await ask(s.garage.id, hers.driverId, {
      duration: 90,
      excludeBookingId: theirs.id,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });
});

// @traces 154-FR-002
describe('a driver accepting a quote', () => {
  it('answers a driver holding a waiting quote from the garage as it answers its staff', async () => {
    const s = await setting();
    const { driver } = await quoted(s.garage.id, 'waiting');

    const res = await ask(s.garage.id, driver, {
      count: 3,
      duration: 60,
      earliest: at(10).toISOString(),
    });

    expect(res.status).toBe(200);
    expect(starts(res.body)).toEqual([
      at(10).getTime(),
      at(10, 30).getTime(),
      at(11).getTime(),
    ]);
  });
});

// @traces 154-FR-002
describe('a driver with nothing left at the garage', () => {
  it.each([
    'nothing at all',
    'a booking already started',
    'a cancelled booking',
    'a booking at another garage',
    'a quote past its expiry',
    'a withdrawn quote',
  ])('answers a driver with %s, 404', async (held) => {
    const s = await setting();
    const other = await world.garage('Service Militari');
    let driver = await world.account('Ioana Popescu');
    const book = async (garageId: string, startsAt: Date, st: BookingStatus) =>
      (await world.booked(garageId, startsAt.toISOString(), st)).driverId;
    if (held === 'a booking already started') {
      const started = new Date(Date.now() - 30 * MINUTE);
      driver = await book(s.garage.id, started, 'confirmed');
    } else if (held === 'a cancelled booking') {
      driver = await book(s.garage.id, at(10), 'cancelled');
    } else if (held === 'a booking at another garage') {
      driver = await book(other.id, at(10), 'confirmed');
    } else if (held === 'a quote past its expiry') {
      const q = await quoted(s.garage.id, 'waiting');
      await prisma.quote.update({
        data: { expiresAt: new Date(Date.now() - MINUTE) },
        where: { id: q.quote.id },
      });
      driver = q.driver;
    } else if (held === 'a withdrawn quote') {
      driver = (await quoted(s.garage.id, 'withdrawn')).driver;
    }

    const res = await ask(s.garage.id, driver, { duration: 60 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it.each(['suspended', 'draft'] as const)(
    'answers a driver with a booking at a %s garage with 404',
    async (status) => {
      const s = await setting();
      const booking = await world.booked(
        s.garage.id,
        at(10).toISOString(),
        'confirmed',
      );
      await prisma.garage.update({
        data: { status },
        where: { id: s.garage.id },
      });

      const res = await ask(s.garage.id, booking.driverId, { duration: 60 });

      expect(res.status).toBe(404);
    },
  );
});

// @traces 154-FR-003
describe("the move's window", () => {
  it('offers nothing before now + 2 h rounded up to the step, and nothing after the 14th day', async () => {
    const s = await setting();
    const earliest = new Date(Date.now() + 120 * MINUTE);
    const rounded = Math.ceil(earliest.getTime() / STEP) * STEP;
    // The window opens on the rounded instant's day: from 23:30 on, now + 2 h
    // rounds up to the next day's midnight.
    const day14 = addDays(localDay(new Date(rounded)), 13);
    // Elena is taken until 18:00 on the 14th day; the 15th is all free.
    const blockedTo = at(18, 0, day14);
    const owner = await world.account('Mihai Dinu', ['garage']);
    const { id } = await prisma.timeBlock.create({
      data: {
        createdBy: owner,
        endsAt: blockedTo,
        garageId: s.garage.id,
        mechanicId: s.elena.id,
        startsAt: new Date(Date.now() - MINUTE),
        updatedBy: owner,
      },
    });
    await prisma.bookingSegment.create({
      data: {
        endsAt: blockedTo,
        garageId: s.garage.id,
        mechanicId: s.elena.id,
        startsAt: new Date(Date.now() - MINUTE),
        timeBlockId: id,
      },
    });
    const booking = await world.booked(
      s.garage.id,
      at(10, 0, addDays(day14, 2)).toISOString(),
      'awaiting_confirmation',
    );
    const expected = (await holiday(day14))
      ? []
      : [at(18, 0, day14).getTime(), at(18, 30, day14).getTime()];

    const res = await ask(s.garage.id, booking.driverId, {
      count: 10,
      duration: 90,
      earliest: earliest.toISOString(),
      horizonDays: 14,
    });

    expect(res.status).toBe(200);
    expect(starts(res.body)).toEqual(expected);
    for (const start of starts(res.body)) {
      expect(start).toBeGreaterThanOrEqual(rounded);
    }
  });

  it('rounds an earliest off the step up to the next half hour', async () => {
    const s = await setting();
    const { driver } = await quoted(s.garage.id, 'waiting');

    const res = await ask(s.garage.id, driver, {
      count: 1,
      duration: 60,
      earliest: at(10, 10).toISOString(),
    });

    expect(starts(res.body)).toEqual([at(10, 30).getTime()]);
  });
});
