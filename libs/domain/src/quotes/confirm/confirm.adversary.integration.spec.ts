import { randomUUID } from 'node:crypto';

import { addDays, atLocal, localDay } from '../../bucharest';
import { quotesApp } from '../quotes-api.testing';

const { bearer, get, post, team, world } = quotesApp();
const { prisma } = world;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let DAY: string;
let TEN: Date;
beforeAll(async () => {
  let day = addDays(localDay(new Date()), 3);
  const holiday = (d: string) =>
    prisma.publicHoliday.findUnique({
      where: { day: new Date(`${d}T00:00:00Z`) },
    });
  while (await holiday(day)) day = addDays(day, 1);
  DAY = day;
  TEN = atLocal(DAY, 10);
});

type Team = Awaited<ReturnType<typeof team>>;

async function accepted(at: Team, startsAt = TEN) {
  const driver = await world.account('Andrei Ion Marin');
  const request = await world.request(driver, { status: 'booked' });
  const quote = await world.quote(request.id, at.garage.id, 'accepted');
  await prisma.booking.create({
    data: {
      confirmBy: new Date(Date.now() + 24 * HOUR),
      driverId: driver,
      durationMinutes: 90,
      garageId: at.garage.id,
      quoteId: quote.id,
      requestId: request.id,
      startsAt,
      status: 'awaiting_confirmation',
    },
  });
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { quoteId: quote.id },
  });
  return { booking, driver, quote, request };
}

async function lifts(garageId: string, liftCount: number) {
  await prisma.garage.update({ data: { liftCount }, where: { id: garageId } });
}

async function switched(
  garageId: string,
  key: 'team_mechanics' | 'lift_schedule',
  enabled: boolean,
) {
  await prisma.garageFeature.create({ data: { enabled, garageId, key } });
}

const owner = (t: Team) => bearer(t.owner, 'garage');

const confirm = (bookingId: string, auth: string | undefined, body: unknown) =>
  post(`/bookings/${bookingId}/confirm`, body, auth);

async function untouched(bookingId: string) {
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
  });
  return {
    booking: [b.status, b.mechanicId, b.lift, b.confirmedAt?.toISOString()],
    events: await prisma.outboxEvent.count(),
    jobs: await prisma.job.count(),
    mechanics: await prisma.mechanic.count(),
  };
}

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE outbox_event'));

// @traces 389-FR-001
// @traces 389-FR-004
// @traces 389-FR-006
describe('a confirm body that is not what the contract says', () => {
  it.each([
    ['a lift written as a string', { lift: '1' }],
    ['a null lift', { lift: null }],
    ['a null mechanic', { mechanicId: null }],
    ['an empty mechanic id', { mechanicId: '' }],
    ['a negative lift', { lift: -1 }],
    ['a lift of a billion and one', { lift: 1_000_000_001 }],
    ['a lift past the 32-bit range', { lift: 2 ** 31 }],
    ['a lift past the safe integers', { lift: 1e21 }],
    ['a lift as a list', { lift: [1] }],
    ['a mechanic id as a number', { mechanicId: 7 }],
    ['a mechanic id as a list of uuids', { mechanicId: [randomUUID()] }],
    ['an extra field beside valid ones', { extra: true, lift: 1 }],
    ['a field spelled in snake case', { mechanic_id: randomUUID() }],
  ])('refuses %s with 400, writing nothing', async (_, extra) => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking } = await accepted(t);
    const before = await untouched(booking.id);
    const body = { mechanicId: t.plainMechanic.id, ...extra };

    const res = await confirm(booking.id, owner(t), body);

    // The API's problem filter names it validation_failed (apps/api).
    expect(res.status).toBe(400);
    expect(await untouched(booking.id)).toEqual(before);
  });

  it('refuses a body that is a list instead of an object', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    const before = await untouched(booking.id);

    const res = await confirm(booking.id, owner(t), []);

    expect(res.status).toBe(400);
    expect(await untouched(booking.id)).toEqual(before);
  });

  it('refuses a lift of a garage with no lifts', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    const before = await untouched(booking.id);

    const res = await confirm(booking.id, owner(t), {
      lift: 1,
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('lift');
    expect(await untouched(booking.id)).toEqual(before);
  });

  it('answers a booking id that is not a uuid with a client error, not a crash', async () => {
    const t = await team('Atelier Dinamo');

    const res = await confirm('not-a-uuid', owner(t), {});
    const options = await get('/bookings/not-a-uuid/confirm-options', owner(t));

    expect([400, 404]).toContain(res.status);
    expect([400, 404]).toContain(options.status);
  });

  it('keeps a mechanic’s non-ASCII name whole in the answer and the options', async () => {
    const t = await team('Atelier Dinamo');
    const name = 'Ștefan Țurcanu 🔧';
    const mechanic = await prisma.mechanic.create({
      data: { garageId: t.garage.id, name },
    });
    const { booking } = await accepted(t);

    const options = await get(
      `/bookings/${booking.id}/confirm-options`,
      owner(t),
    );
    const res = await confirm(booking.id, owner(t), {
      mechanicId: mechanic.id,
    });

    expect(options.body.mechanics).toContainEqual({ id: mechanic.id, name });
    expect(res.status).toBe(200);
    expect(res.body.mechanic).toEqual({ id: mechanic.id, name });
  });
});

// @traces 389-FR-005
describe('a garage whose team is switched off', () => {
  it.each([
    ['its own mechanic’s id', (t: Team) => t.plainMechanic.id],
    ['another garage’s mechanic id', (_: Team, o: Team) => o.plainMechanic.id],
    ['an unknown id', () => randomUUID()],
  ])(
    'refuses %s with 400 naming the field, writing nothing',
    async (_, pick) => {
      const t = await team('Atelier Dinamo');
      const other = await team('Service Militari');
      await switched(t.garage.id, 'team_mechanics', false);
      const { booking } = await accepted(t);
      const before = await untouched(booking.id);

      const res = await confirm(booking.id, owner(t), {
        mechanicId: pick(t, other),
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('mechanicId');
      expect(await untouched(booking.id)).toEqual(before);
    },
  );

  it('refuses a null mechanic with 400 as it does a missing one on a team garage', async () => {
    const t = await team('Atelier Dinamo');
    await switched(t.garage.id, 'team_mechanics', false);
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, owner(t), { mechanicId: null });

    expect(res.status).toBe(400);
  });

  it('leaves no owner mechanic row behind when the confirm is refused for the hours', async () => {
    const t = await team('Atelier Dinamo');
    await switched(t.garage.id, 'team_mechanics', false);
    await prisma.garage.update({
      data: {
        hours: Object.fromEntries(
          ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
            d,
            [['08:00', '09:00']],
          ]),
        ),
      },
      where: { id: t.garage.id },
    });
    const { booking } = await accepted(t);
    const before = await untouched(booking.id);

    const res = await confirm(booking.id, owner(t), {});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'outside_hours' });
    expect(await untouched(booking.id)).toEqual(before);
    expect(await prisma.mechanic.count({ where: { accountId: t.owner } })).toBe(
      0,
    );
  });
});

// @traces 389-FR-006
describe('a garage whose lift schedule is switched off', () => {
  it.each([0, 1, -1])(
    'refuses lift %s with 400 naming the field',
    async (lift) => {
      const t = await team('Atelier Dinamo');
      await lifts(t.garage.id, 2);
      await switched(t.garage.id, 'lift_schedule', false);
      const { booking } = await accepted(t);
      const before = await untouched(booking.id);

      const res = await confirm(booking.id, owner(t), {
        lift,
        mechanicId: t.plainMechanic.id,
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('lift');
      expect(await untouched(booking.id)).toEqual(before);
    },
  );
});

// @traces 389-FR-002
// @traces 389-FR-003
describe('the same confirm sent twice at once', () => {
  it('confirms once, refuses the other as already confirmed and opens one job', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const { booking } = await accepted(t);
    const body = { lift: 1, mechanicId: t.plainMechanic.id };

    const answers = await Promise.all([
      confirm(booking.id, owner(t), body),
      confirm(booking.id, owner(t), body),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(answers.find((r) => r.status === 409)?.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'confirmed',
    });
    expect(await prisma.job.count()).toBe(1);
    expect(
      await prisma.outboxEvent.count({ where: { kind: 'booking.confirmed' } }),
    ).toBe(1);
  });

  it('keeps the first answer’s mechanic when a second confirm names another', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    await confirm(booking.id, owner(t), { mechanicId: t.plainMechanic.id });

    const again = await confirm(booking.id, owner(t), {
      mechanicId: t.answeringMechanic.id,
    });

    expect(again.status).toBe(409);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .mechanicId,
    ).toBe(t.plainMechanic.id);
  });
});

// @traces 389-FR-002
describe('a confirm racing the lapse', () => {
  it('ends every pair with the booking either confirmed with its job or lapsed with none', async () => {
    const t = await team('Atelier Dinamo');
    const rounds = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) =>
        accepted(t, new Date(TEN.getTime() + i * 3 * HOUR)),
      ),
    );

    const answers = await Promise.all(
      rounds.map(async ({ booking }) => {
        const [res] = await Promise.all([
          confirm(booking.id, owner(t), { mechanicId: t.plainMechanic.id }),
          prisma.booking.updateMany({
            data: { status: 'lapsed' },
            where: { id: booking.id, status: 'awaiting_confirmation' },
          }),
        ]);
        return res;
      }),
    );

    for (const [i, { booking }] of rounds.entries()) {
      const row = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      const jobs = await prisma.job.count({ where: { bookingId: booking.id } });
      if (answers[i].status === 200) {
        expect(row.status).toBe('confirmed');
        expect(jobs).toBe(1);
      } else {
        expect(answers[i].status).toBe(409);
        expect(answers[i].body).toMatchObject({
          code: 'invalid_transition',
          currentStatus: 'lapsed',
        });
        expect(row.status).toBe('lapsed');
        expect(row.mechanicId).toBeNull();
        expect(jobs).toBe(0);
      }
    }
  });

  it('refuses a booking whose confirm-by is this very instant as lapsed', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    await prisma.booking.update({
      data: { confirmBy: new Date(Date.now() - 1) },
      where: { id: booking.id },
    });

    const res = await confirm(booking.id, owner(t), {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'lapsed',
    });
  });
});

// @traces 389-FR-004
describe('GET /bookings/:id/confirm-options', () => {
  it('answers 404 for a booking that does not exist', async () => {
    const t = await team('Atelier Dinamo');

    const res = await get(
      `/bookings/${randomUUID()}/confirm-options`,
      owner(t),
    );

    expect(res.status).toBe(404);
  });

  it('answers the same twice and never lists a mechanic of another garage', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Militari');
    const { booking } = await accepted(t);
    const path = `/bookings/${booking.id}/confirm-options`;

    const first = await get(path, owner(t));
    const second = await get(path, owner(t));

    expect(second.body).toEqual(first.body);
    const ids = first.body.mechanics.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(other.plainMechanic.id);
    expect(ids).not.toContain(other.answeringMechanic.id);
  });
});

// @traces 055-FR-004
describe('a card detached from a deleted account', () => {
  it('is not offered to the booking', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    await prisma.mechanic.update({
      data: { accountId: null, onProfile: false, removedAt: new Date() },
      where: { id: t.plainMechanic.id },
    });

    const options = await get(
      `/bookings/${booking.id}/confirm-options`,
      owner(t),
    );

    const ids = options.body.mechanics.map((m: { id: string }) => m.id);
    expect(ids).toContain(t.answeringMechanic.id);
    expect(ids).not.toContain(t.plainMechanic.id);
  });
});
