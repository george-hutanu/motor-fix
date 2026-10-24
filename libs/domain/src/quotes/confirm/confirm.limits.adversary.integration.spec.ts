import { addDays, atLocal, localDay } from '../../bucharest';
import { quotesApp } from '../quotes-api.testing';

const { bearer, post, team, world } = quotesApp();
const { prisma } = world;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let TEN: Date;
beforeAll(async () => {
  let day = addDays(localDay(new Date()), 3);
  const holiday = (d: string) =>
    prisma.publicHoliday.findUnique({
      where: { day: new Date(`${d}T00:00:00Z`) },
    });
  while (await holiday(day)) day = addDays(day, 1);
  TEN = atLocal(day, 10);
});

type Team = Awaited<ReturnType<typeof team>>;

async function accepted(at: Team, startsAt = TEN) {
  const driver = await world.account('Andrei Ion Marin');
  const request = await world.request(driver, { status: 'booked' });
  const quote = await world.quote(request.id, at.garage.id, 'accepted');
  const booking = await prisma.booking.create({
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
  return { booking, request };
}

const lifts = (garageId: string, liftCount: number) =>
  prisma.garage.update({ data: { liftCount }, where: { id: garageId } });

const confirm = (id: string, t: Team, body: unknown) =>
  post(`/bookings/${id}/confirm`, body, bearer(t.owner, 'garage'));

// @traces 389-FR-006
describe('the lift number against the garage’s lift count', () => {
  it('takes the last lift and refuses the one past it', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 3);
    const a = await accepted(t);
    const b = await accepted(t, new Date(TEN.getTime() + 5 * HOUR));

    const past = await confirm(b.booking.id, t, {
      lift: 4,
      mechanicId: t.plainMechanic.id,
    });
    const last = await confirm(a.booking.id, t, {
      lift: 3,
      mechanicId: t.plainMechanic.id,
    });

    expect(past.status).toBe(400);
    expect(JSON.stringify(past.body)).toContain('lift');
    expect(last.status).toBe(200);
    expect(last.body).toMatchObject({ lift: 3 });
  });

  it('refuses a lift of zero', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 3);
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, t, {
      lift: 0,
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(400);
  });
});

// @traces 389-FR-004
describe('a mechanic that is not the garage’s', () => {
  it('answers 409 mechanic_unavailable for another garage’s mechanic, writing nothing', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Rival');
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, t, {
      mechanicId: other.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'mechanic_unavailable' });
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect([row.status, row.mechanicId]).toEqual([
      'awaiting_confirmation',
      null,
    ]);
  });
});

// @traces 055-FR-004
describe('a mechanic whose account was deleted', () => {
  it('answers 409 mechanic_unavailable, writing nothing', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    await prisma.mechanic.update({
      data: { accountId: null, onProfile: false, removedAt: new Date() },
      where: { id: t.plainMechanic.id },
    });

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'mechanic_unavailable' });
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(row.mechanicId).toBeNull();
  });
});

// @traces 389-FR-007
describe('what counts as an overlap', () => {
  it('lets the same lift number be taken at two garages at one time', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Rival');
    await lifts(t.garage.id, 2);
    await lifts(other.garage.id, 2);
    const a = await accepted(t);
    const b = await accepted(other);

    const first = await confirm(a.booking.id, t, {
      lift: 1,
      mechanicId: t.plainMechanic.id,
    });
    const second = await confirm(b.booking.id, other, {
      lift: 1,
      mechanicId: other.plainMechanic.id,
    });

    expect([first.status, second.status]).toEqual([200, 200]);
  });

  it('ignores a lapsed booking on the same mechanic and lift', async () => {
    const t = await team('Atelier Dinamo');
    await lifts(t.garage.id, 2);
    const old = await accepted(t);
    await prisma.booking.update({
      data: {
        lift: 1,
        mechanicId: t.plainMechanic.id,
        status: 'lapsed',
      },
      where: { id: old.booking.id },
    });
    const { booking } = await accepted(t);

    const res = await confirm(booking.id, t, {
      lift: 1,
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(200);
  });
});

// @traces 389-FR-003
describe('a booking that is no longer waiting', () => {
  it('names a cancelled booking as cancelled', async () => {
    const t = await team('Atelier Dinamo');
    const { booking } = await accepted(t);
    await prisma.booking.update({
      data: {
        cancelledAt: new Date(),
        cancelledBySide: 'driver',
        cancelReason: 'plans_changed',
        status: 'cancelled',
      },
      where: { id: booking.id },
    });

    const res = await confirm(booking.id, t, {
      mechanicId: t.plainMechanic.id,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'cancelled',
      entity: 'booking',
    });
  });
});
