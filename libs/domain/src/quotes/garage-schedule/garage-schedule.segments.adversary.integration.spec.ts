import { randomUUID } from 'node:crypto';

import { atLocal } from '../../bucharest';
import type { BookingStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

type Team = Awaited<ReturnType<typeof team>>;

const FRI = '2027-02-05';
const MON = '2027-02-08';
const TUE = '2027-02-09';
const at = (day: string, hour: number, minute = 0) =>
  new Date(atLocal(day, hour).getTime() + minute * 60_000);

const owner = (t: Team) => bearer(t.owner, 'garage');
const read = (garageId: string, query: string, auth?: string) =>
  get(`/garages/${garageId}/schedule${query}`, auth);

async function seed(
  t: Team,
  startsAt: Date,
  status: BookingStatus,
  segments: [Date, Date][] = [],
) {
  const b = await world.booked(t.garage.id, startsAt.toISOString(), status);
  await prisma.bookingSegment.deleteMany({ where: { bookingId: b.id } });
  for (const [s, e] of segments)
    await prisma.bookingSegment.create({
      data: {
        bookingId: b.id,
        endsAt: e,
        garageId: t.garage.id,
        mechanicId: null,
        startsAt: s,
      },
    });
  return b;
}

const ids = (res: { body: { entries: { id: string }[] } }) =>
  res.body.entries.map((e) => e.id);

// @traces 150-FR-009
describe('GET /garages/:garageId/schedule asked wrongly', () => {
  it.each([
    ['a date that does not exist', '?from=2027-02-30'],
    ['a word for a date', '?from=tomorrow'],
    ['a timestamp for a date', '?from=2027-02-08T10:00:00Z'],
    ['a to before the from', `?from=${MON}&to=${FRI}`],
    ['eight days', `?from=${FRI}&to=2027-02-12`],
    ['a to that is not a date', `?from=${MON}&to=x`],
    ['a mechanic id that is not a uuid', `?from=${MON}&mechanicId=abc`],
    ['an unknown query field', `?from=${MON}&bogus=1`],
    ['an empty from', '?from='],
  ])('answers 400 for %s', async (_, query) => {
    const t = await team('Atelier Dinamo');

    const res = await read(t.garage.id, query, owner(t));

    expect(res.status).toBe(400);
  });

  it('takes exactly seven days and the same day twice', async () => {
    const t = await team('Atelier Dinamo');

    const seven = await read(
      t.garage.id,
      `?from=${FRI}&to=2027-02-11`,
      owner(t),
    );
    const one = await read(t.garage.id, `?from=${FRI}&to=${FRI}`, owner(t));

    expect(seven.status).toBe(200);
    expect(seven.body).toMatchObject({
      entries: [],
      from: FRI,
      to: '2027-02-11',
    });
    expect(one.body).toMatchObject({ entries: [], from: FRI, to: FRI });
  });

  it('answers 400 or 404 for a garage id that is not a uuid', async () => {
    const t = await team('Atelier Dinamo');

    const res = await read('not-a-uuid', `?from=${MON}`, owner(t));

    expect([400, 404]).toContain(res.status);
  });
});

// @traces 150-FR-009
describe('GET /garages/:garageId/schedule asked by the wrong person', () => {
  it('answers 401 to a visitor', async () => {
    const t = await team('Atelier Dinamo');

    const res = await read(t.garage.id, `?from=${MON}`);

    expect(res.status).toBe(401);
  });

  it('answers 404 to a driver, an admin, another garage’s owner and for an unknown garage', async () => {
    const t = await team('Atelier Dinamo');
    const rival = await team('Service Rival');
    const driver = await world.account('Dan Vasile', ['driver']);
    const admin = await world.account('Ana Admin', ['admin']);
    await seed(t, at(MON, 10), 'confirmed', [[at(MON, 10), at(MON, 11)]]);
    const q = `?from=${MON}`;

    const statuses = [
      (await read(t.garage.id, q, bearer(driver, 'driver'))).status,
      (await read(t.garage.id, q, bearer(admin, 'admin'))).status,
      (await read(t.garage.id, q, owner(rival))).status,
      (await read(randomUUID(), q, owner(t))).status,
    ];

    expect(statuses).toEqual([404, 404, 404, 404]);
  });

  it('lets a receptionist read every booking of the garage', async () => {
    const t = await team('Atelier Dinamo');
    const a = await seed(t, at(MON, 10), 'confirmed', [
      [at(MON, 10), at(MON, 11)],
    ]);

    const res = await read(
      t.garage.id,
      `?from=${MON}`,
      bearer(t.receptionist, 'receptionist'),
    );

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([a.id]);
  });

  it('answers a plain mechanic 403 when she asks for another card', async () => {
    const t = await team('Atelier Dinamo');

    const res = await read(
      t.garage.id,
      `?from=${MON}&mechanicId=${t.answeringMechanic.id}`,
      bearer(t.plain, 'mechanic'),
    );

    expect(res.status).toBe(403);
  });
});

// @traces 150-FR-010
describe('GET /garages/:garageId/schedule listing', () => {
  it('lists a long job on each day it has a segment, with all its segments, and not on a gap day', async () => {
    const t = await team('Atelier Dinamo');
    const segments: [Date, Date][] = [
      [at(FRI, 14), at(FRI, 16)],
      [at(MON, 8), at(MON, 16)],
      [at(TUE, 8), at(TUE, 10)],
    ];
    const long = await seed(t, at(FRI, 14), 'confirmed', segments);

    const monday = await read(t.garage.id, `?from=${MON}`, owner(t));
    const weekend = await read(
      t.garage.id,
      '?from=2027-02-06&to=2027-02-07',
      owner(t),
    );
    const friday = await read(t.garage.id, `?from=${FRI}`, owner(t));

    expect(ids(monday)).toEqual([long.id]);
    expect(monday.body.entries[0].segments).toHaveLength(3);
    expect(monday.body.entries[0].startsAt).toBe(at(FRI, 14).toISOString());
    expect(ids(friday)).toEqual([long.id]);
    expect(weekend.body.entries).toEqual([]);
  });

  it('lists a job once when the range covers several of its days', async () => {
    const t = await team('Atelier Dinamo');
    const long = await seed(t, at(FRI, 14), 'confirmed', [
      [at(FRI, 14), at(FRI, 16)],
      [at(MON, 8), at(MON, 12)],
    ]);

    const res = await read(t.garage.id, `?from=${FRI}&to=${TUE}`, owner(t));

    expect(ids(res)).toEqual([long.id]);
  });

  it('never lists a lapsed or a cancelled booking and lists a no-show by its start', async () => {
    const t = await team('Atelier Dinamo');
    await seed(t, at(MON, 9), 'lapsed');
    await seed(t, at(MON, 10), 'cancelled');
    const missed = await seed(t, at(MON, 11), 'no_show');
    const done = await seed(t, at(MON, 12), 'completed');

    const res = await read(t.garage.id, `?from=${MON}`, owner(t));

    expect(ids(res)).toEqual([missed.id, done.id]);
    expect(res.body.entries.map((e: { status: string }) => e.status)).toEqual([
      'no_show',
      'completed',
    ]);
  });

  it('lists an awaiting booking on its start day with no segments', async () => {
    const t = await team('Atelier Dinamo');
    const waiting = await seed(t, at(MON, 10), 'awaiting_confirmation');

    const same = await read(t.garage.id, `?from=${MON}`, owner(t));
    const next = await read(t.garage.id, `?from=${TUE}`, owner(t));

    expect(ids(same)).toEqual([waiting.id]);
    expect(same.body.entries[0]).toMatchObject({
      jobStatus: null,
      segments: [],
      status: 'awaiting_confirmation',
    });
    expect(next.body.entries).toEqual([]);
  });

  it('reads the day on the Bucharest clock: half past midnight belongs to its local day', async () => {
    const t = await team('Atelier Dinamo');
    const night = await seed(t, at(MON, 0, 30), 'completed');
    const before = await seed(t, at(MON, 0, -1), 'completed');

    const monday = await read(t.garage.id, `?from=${MON}`, owner(t));
    const sunday = await read(t.garage.id, '?from=2027-02-07', owner(t));

    expect(ids(monday)).toEqual([night.id]);
    expect(ids(sunday)).toEqual([before.id]);
  });

  it('puts a segment ending exactly at midnight on the earlier day only', async () => {
    const t = await team('Atelier Dinamo');
    const late = await seed(t, at(MON, 22), 'confirmed', [
      [at(MON, 22), at(TUE, 0)],
    ]);

    const monday = await read(t.garage.id, `?from=${MON}`, owner(t));
    const tuesday = await read(t.garage.id, `?from=${TUE}`, owner(t));

    expect(ids(monday)).toEqual([late.id]);
    expect(tuesday.body.entries).toEqual([]);
  });

  it('sorts by start and keeps another garage’s bookings out', async () => {
    const t = await team('Atelier Dinamo');
    const rival = await team('Service Rival');
    const late = await seed(t, at(MON, 15), 'completed');
    const early = await seed(t, at(MON, 9), 'completed');
    await seed(rival, at(MON, 10), 'completed');

    const res = await read(t.garage.id, `?from=${MON}`, owner(t));

    expect(ids(res)).toEqual([early.id, late.id]);
  });

  it('answers the same twice', async () => {
    const t = await team('Atelier Dinamo');
    await seed(t, at(MON, 9), 'confirmed', [[at(MON, 9), at(MON, 10)]]);

    const one = await read(t.garage.id, `?from=${MON}`, owner(t));
    const two = await read(t.garage.id, `?from=${MON}`, owner(t));

    expect(two.body).toEqual(one.body);
  });
});
