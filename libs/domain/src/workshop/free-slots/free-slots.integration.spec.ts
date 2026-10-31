// @traces 154-FR-018
import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { Logger } from '@nestjs/common';
import { type Command, Redis } from 'ioredis';

import { AUTH_REDIS } from '../../auth/attempts';
import { addDays, atLocal, localDay } from '../../bucharest';
import { OutboxRelay } from '../../events/outbox-relay/outbox-relay';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, post, provider, team, world } = quotesApp();
const { prisma } = world;

const MINUTE = 60_000;
const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
afterAll(() => redis.quit());

const WEEKDAYS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => [day, [['08:00', '16:30']]]),
);

// Three days out or later, on a weekday no public holiday closes: inside the
// hours above, and after any confirm-by.
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

// Atelier Dinamo open on weekdays, its two mechanics following those hours.
async function setting(liftCount = 0) {
  const t = await team('Atelier Dinamo');
  await prisma.garage.update({
    data: { hours: WEEKDAYS, liftCount },
    where: { id: t.garage.id },
  });
  return { ...t, owner: bearer(t.owner, 'garage'), ownerId: t.owner };
}
type Setting = Awaited<ReturnType<typeof setting>>;

type Query = Record<string, string | number | boolean | undefined>;

const ask = (garageId: string, auth: string | undefined, query: Query) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.append(key, String(value));
  }
  return get(`/garages/${garageId}/free-slots?${params}`, auth);
};

const starts = (body: { slots: { startsAt: string }[] }) =>
  body.slots.map((slot) => new Date(slot.startsAt).getTime());

// A block as its service writes it: the row and one segment.
async function blocked(
  s: Setting,
  from: Date,
  to: Date,
  holder: { lift?: number; mechanicId?: string },
) {
  const row = {
    endsAt: to,
    garageId: s.garage.id,
    lift: holder.lift ?? null,
    mechanicId: holder.mechanicId ?? null,
    startsAt: from,
  };
  const { id } = await prisma.timeBlock.create({
    data: { ...row, createdBy: s.ownerId, updatedBy: s.ownerId },
  });
  await prisma.bookingSegment.create({ data: { ...row, timeBlockId: id } });
}

// A booking awaiting its confirm at `startsAt`, `minutes` long.
async function awaiting(garageId: string, startsAt: Date, minutes: number) {
  const booking = await world.booked(
    garageId,
    startsAt.toISOString(),
    'awaiting_confirmation',
  );
  return prisma.booking.update({
    data: { durationMinutes: minutes },
    where: { id: booking.id },
  });
}

const confirm = (bookingId: string, auth: string, body: object) =>
  post(`/bookings/${bookingId}/confirm`, body, auth);

async function relayAll() {
  const relay = new OutboxRelay(prisma, redis);
  while ((await relay.relay()) > 0);
}

// @traces 154-FR-001
// @traces 154-FR-002
describe('who may ask for free slots', () => {
  it.each([
    ['the owner', 'owner', 'garage'],
    ['a receptionist', 'receptionist', 'receptionist'],
    ['a mechanic who may answer quotes', 'answering', 'mechanic'],
    ['a mechanic who may move bookings', 'plain', 'mechanic'],
  ] as const)('answers %s with the first free starts', async (_, who, role) => {
    const s = await setting();
    await prisma.mechanic.update({
      data: { canMoveBookings: true },
      where: { id: s.plainMechanic.id },
    });
    const accountId = who === 'owner' ? s.ownerId : s[who];

    const res = await ask(s.garage.id, bearer(accountId, role), {
      duration: 60,
      earliest: at(0).toISOString(),
    });

    expect(res.status).toBe(200);
    expect(res.body.reason).toBeUndefined();
    expect(starts(res.body)).toEqual([
      at(8).getTime(),
      at(8, 30).getTime(),
      at(9).getTime(),
    ]);
    expect(res.body.slots[0]).toEqual({
      endsAt: expect.stringMatching(/T09:00:00(\.000)?\+0[23]:00$/),
      startsAt: expect.stringMatching(/T08:00:00(\.000)?\+0[23]:00$/),
    });
  });

  it('refuses a mechanic of the garage with neither right, 403', async () => {
    const s = await setting();

    const res = await ask(s.garage.id, bearer(s.plain, 'mechanic'), {
      duration: 60,
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it.each(['other owner', 'driver', 'admin', 'unknown garage'] as const)(
    'answers the %s with 404',
    async (who) => {
      const s = await setting();
      const other = await team('Service Militari');
      const actors: Record<typeof who, [string, Role]> = {
        admin: [await world.account('Ana Admin', ['admin']), 'admin'],
        driver: [await world.account('Andrei Marin'), 'driver'],
        'other owner': [other.owner, 'garage'],
        'unknown garage': [s.ownerId, 'garage'],
      };
      const [id, role] = actors[who];
      const garageId = who === 'unknown garage' ? randomUUID() : s.garage.id;

      const res = await ask(garageId, bearer(id, role), { duration: 60 });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    },
  );

  it('asks a visitor to sign in', async () => {
    const s = await setting();

    const res = await ask(s.garage.id, undefined, { duration: 60 });

    expect(res.status).toBe(401);
  });

  it.each(['suspended', 'draft'] as const)(
    'still answers the staff of a %s garage',
    async (status) => {
      const s = await setting();
      await prisma.garage.update({
        data: { status },
        where: { id: s.garage.id },
      });

      const res = await ask(s.garage.id, s.owner, {
        count: 1,
        duration: 60,
        earliest: at(0).toISOString(),
      });

      expect(res.status).toBe(200);
      expect(starts(res.body)).toEqual([at(8).getTime()]);
    },
  );

  it('writes no row, no history entry and no event', async () => {
    const s = await setting();
    const counts = async () => [
      await prisma.outboxEvent.count(),
      await prisma.activityLog.count(),
      await prisma.booking.count(),
      await prisma.bookingSegment.count(),
    ];
    const before = await counts();

    const res = await ask(s.garage.id, s.owner, { duration: 60 });

    expect(res.status).toBe(200);
    expect(await counts()).toEqual(before);
  });
});

// @traces 154-FR-003
describe('the refusals of a question', () => {
  it.each<[string, Query]>([
    ['no duration', {}],
    ['a duration of 10 minutes', { duration: 10 }],
    ['a duration over 5 working days', { duration: 2401 }],
    ['a count of 0', { count: 0, duration: 60 }],
    ['a count of 11', { count: 11, duration: 60 }],
    ['a horizon of 0 days', { duration: 60, horizonDays: 0 }],
    ['a horizon of 31 days', { duration: 60, horizonDays: 31 }],
    ['an unparsable earliest', { duration: 60, earliest: 'tomorrow' }],
    ['a mechanic that is not a uuid', { duration: 60, mechanicId: 'elena' }],
  ])('refuses %s with 400', async (_, query) => {
    const s = await setting();

    const res = await ask(s.garage.id, s.owner, query);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('takes the bounds themselves', async () => {
    const s = await setting();

    const low = await ask(s.garage.id, s.owner, {
      count: 1,
      duration: 15,
      horizonDays: 1,
    });
    const high = await ask(s.garage.id, s.owner, {
      count: 10,
      duration: 2400,
      horizonDays: 30,
    });

    expect([low.status, high.status]).toEqual([200, 200]);
  });

  it.each([
    'a team switched off',
    'a card of another garage',
    'a removed card',
  ])('refuses a mechanic with %s, 400', async (cause) => {
    const s = await setting();
    const other = await team('Service Militari');
    let mechanicId = s.plainMechanic.id;
    if (cause === 'a team switched off') {
      await prisma.garageFeature.create({
        data: { enabled: false, garageId: s.garage.id, key: 'team_mechanics' },
      });
    } else if (cause === 'a card of another garage') {
      mechanicId = other.plainMechanic.id;
    } else {
      await prisma.mechanic.update({
        data: { removedAt: new Date() },
        where: { id: mechanicId },
      });
    }

    const res = await ask(s.garage.id, s.owner, { duration: 60, mechanicId });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it("refuses to leave out another garage's booking, 400", async () => {
    const s = await setting();
    const other = await team('Service Militari');
    const theirs = await world.booked(
      other.garage.id,
      at(10).toISOString(),
      'confirmed',
    );

    const res = await ask(s.garage.id, s.owner, {
      duration: 60,
      excludeBookingId: theirs.id,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('takes an earliest in the past as now, never a 400', async () => {
    const s = await setting();
    const now = Date.now();

    const res = await ask(s.garage.id, s.owner, {
      count: 10,
      duration: 15,
      earliest: new Date(now - 3_600_000).toISOString(),
    });

    expect(res.status).toBe(200);
    for (const start of starts(res.body)) {
      expect(start).toBeGreaterThanOrEqual(now);
      expect(start % (30 * MINUTE)).toBe(0);
    }
  });
});

// @traces 154-FR-004
describe('free starts read from the stored schedule', () => {
  it('skips a start whose only free mechanic has no free lift, and keeps the next free pair', async () => {
    const s = await setting(2);
    await blocked(s, at(10), at(11, 30), {
      lift: 2,
      mechanicId: s.plainMechanic.id,
    });
    await world.booked(s.garage.id, at(10).toISOString(), 'confirmed', {
      lift: 1,
      mechanicId: s.answeringMechanic.id,
    });

    const lift = await ask(s.garage.id, s.owner, {
      count: 1,
      duration: 60,
      earliest: at(10).toISOString(),
      needsLift: true,
    });

    expect(lift.status).toBe(200);
    expect(starts(lift.body)).toEqual([at(11, 30).getTime()]);
  });

  it('answers an empty list with none_in_horizon on a closed day', async () => {
    const s = await setting();
    await prisma.garageClosedDay.create({
      data: { day: new Date(`${DAY}T00:00:00Z`), garageId: s.garage.id },
    });

    const res = await ask(s.garage.id, s.owner, {
      duration: 60,
      earliest: at(0).toISOString(),
      horizonDays: 1,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reason: 'none_in_horizon', slots: [] });
  });
});

// @traces 154-FR-011
describe('a start the confirm accepts', () => {
  it('has every start it returns accepted by the confirm for some mechanic and lift', async () => {
    const s = await setting(2);
    await world.booked(s.garage.id, at(9).toISOString(), 'confirmed', {
      lift: 1,
      mechanicId: s.answeringMechanic.id,
    });
    await blocked(s, at(10), at(11, 30), {
      lift: 2,
      mechanicId: s.plainMechanic.id,
    });
    const res = await ask(s.garage.id, s.owner, {
      count: 10,
      duration: 120,
      earliest: at(8).toISOString(),
      horizonDays: 1,
      needsLift: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(10);
    const mechanics = [s.answeringMechanic.id, s.plainMechanic.id];

    const places = mechanics.flatMap((mechanicId) =>
      [1, 2].map((lift) => ({ lift, mechanicId })),
    );
    const confirmedBySome = async (bookingId: string) => {
      for (const place of places) {
        const done = await confirm(bookingId, s.owner, place);
        if (done.status === 200) return true;
      }
      return false;
    };

    const refused: string[] = [];
    for (const start of starts(res.body)) {
      const booking = await awaiting(s.garage.id, new Date(start), 120);
      if (!(await confirmedBySome(booking.id))) {
        refused.push(new Date(start).toISOString());
      }
      // Each start is judged against the seeded schedule alone.
      await prisma.bookingSegment.deleteMany({
        where: { bookingId: booking.id },
      });
    }

    expect(refused).toEqual([]);
  });
});

// @traces 154-FR-012
describe('the cached answer', () => {
  it('stops offering a start once a booking takes it and the relay drops the cache', async () => {
    const s = await setting();
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: s.plainMechanic.id },
    });
    const query = {
      count: 1,
      duration: 60,
      earliest: at(10).toISOString(),
      horizonDays: 1,
    };
    const first = await ask(s.garage.id, s.owner, query);
    expect(starts(first.body)).toEqual([at(10).getTime()]);
    const booking = await awaiting(s.garage.id, at(10), 60);
    const confirmed = await confirm(booking.id, s.owner, {
      mechanicId: s.answeringMechanic.id,
    });
    expect(confirmed.status).toBe(200);

    // Until the relay hands on the confirm's event the 60-second entry
    // stands: the drop, not an expiry, is what moves the answer.
    const cached = await ask(s.garage.id, s.owner, query);
    await relayAll();
    const fresh = await ask(s.garage.id, s.owner, query);

    expect(cached.body).toEqual(first.body);
    expect(starts(fresh.body)).toEqual([at(11).getTime()]);
  });

  it('answers from PostgreSQL the same answer while Valkey is down', async () => {
    const s = await setting();
    const appRedis = provider<Redis>(AUTH_REDIS);
    const send = appRedis.sendCommand.bind(appRedis);
    vi.spyOn(appRedis, 'sendCommand').mockImplementation(
      (command: Command, ...rest) => {
        if (!String(command.args[0] ?? '').startsWith('free-slots')) {
          return send(command, ...rest);
        }
        command.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
        return command.promise;
      },
    );
    const query = { duration: 90, earliest: at(0).toISOString() };

    const down = await ask(s.garage.id, s.owner, query);
    const again = await ask(s.garage.id, s.owner, { ...query, count: 4 });
    vi.mocked(appRedis.sendCommand).mockRestore();
    const up = await ask(s.garage.id, s.owner, query);

    expect([down.status, again.status]).toEqual([200, 200]);
    expect(down.body).toEqual(up.body);
    expect(starts(down.body)).toEqual([
      at(8).getTime(),
      at(8, 30).getTime(),
      at(9).getTime(),
    ]);
    expect(vi.mocked(Logger.prototype.warn)).toHaveBeenCalledTimes(1);
  });
});

type Block = {
  day: string;
  from: number;
  to: number;
  lift?: number;
  mechanicId?: string;
};

const monthOfBlocks = (first: string, mechanics: { id: string }[]) =>
  Array.from({ length: 30 }, (_, d): Block[] => {
    const day = addDays(first, d);
    return [
      ...mechanics.map((m, i) => {
        const from = 8 + (i % 4) * 2;
        return { day, from, mechanicId: m.id, to: from + 2 };
      }),
      ...[1, 2, 3, 4, 5].map((lift) => ({
        day,
        from: 8 + lift,
        lift,
        to: 9 + lift,
      })),
    ];
  }).flat();

// @traces 154-FR-018
describe('the answer time', () => {
  it('answers 20 cold questions with a p95 under 300 ms on a garage of 10 mechanics, 5 lifts and a month of bookings', async () => {
    const s = await setting(5);
    await prisma.garage.update({
      data: {
        hours: { ...WEEKDAYS, sat: [['09:00', '14:00']] },
      },
      where: { id: s.garage.id },
    });
    await prisma.mechanic.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({
        garageId: s.garage.id,
        name: `Mecanic ${i + 3}`,
        worksSaturdays: i % 2 === 0,
      })),
    });
    const mechanics = await prisma.mechanic.findMany({
      where: { garageId: s.garage.id },
    });
    // Confirmed bookings and blocks are the same segments to the engine;
    // blocks seed a month of them without a request chain each.
    const first = localDay(new Date());
    const rows = monthOfBlocks(first, mechanics).map((b) => ({
      createdBy: s.ownerId,
      endsAt: atLocal(b.day, b.to),
      garageId: s.garage.id,
      id: randomUUID(),
      lift: b.lift ?? null,
      mechanicId: b.mechanicId ?? null,
      startsAt: atLocal(b.day, b.from),
      updatedBy: s.ownerId,
    }));
    await prisma.timeBlock.createMany({ data: rows });
    await prisma.bookingSegment.createMany({
      data: rows.map((row) => ({
        endsAt: row.endsAt,
        garageId: row.garageId,
        lift: row.lift,
        mechanicId: row.mechanicId,
        startsAt: row.startsAt,
        timeBlockId: row.id,
      })),
    });
    for (let d = 1; d <= 10; d++) {
      await awaiting(s.garage.id, atLocal(addDays(first, d * 3), 13), 90);
    }
    await ask(s.garage.id, s.owner, { duration: 600 });

    const took: number[] = [];
    for (let i = 0; i < 20; i++) {
      const begun = performance.now();
      const res = await ask(s.garage.id, s.owner, {
        count: 10,
        duration: 30 + i * 15,
        needsLift: i % 2 === 0,
      });
      took.push(performance.now() - begun);
      expect(res.status).toBe(200);
    }

    const p95 = [...took].sort((a, b) => a - b)[18];
    expect(p95).toBeLessThan(300);
  }, 60_000);
});
