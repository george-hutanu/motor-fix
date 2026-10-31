import { noShowWorld } from './no-show.testing';
import { quotesApp } from '../quotes-api.testing';

const app = quotesApp();
const { bearer, send, team, world } = app;
const { prisma } = world;
const { due, snapshot } = noShowWorld(app);

const DAY = 24 * 3_600_000;

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE outbox_event'));

const path = (id: string) => `/bookings/${id}/no-show`;

async function recorded() {
  const made = await due();
  const res = await send(
    'post',
    path(made.booking.id),
    bearer(made.volt.owner, 'garage'),
  );
  expect(res.status).toBe(200);
  return made;
}

// @traces 1259-FR-004
// @traces 1259-FR-005
// @traces 1259-FR-013
describe('refusing a withdrawal', () => {
  it('answers 409 to a booking with no no-show, writing nothing', async () => {
    const { booking, volt } = await due();
    const before = await snapshot(booking.id);

    const res = await send(
      'delete',
      path(booking.id),
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'confirmed',
    });
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('answers 409 once the Bucharest day of the recording is over', async () => {
    const { booking, volt } = await recorded();
    await prisma.booking.update({
      data: { noShowAt: new Date(Date.now() - DAY - 60_000) },
      where: { id: booking.id },
    });
    const before = await snapshot(booking.id);

    const res = await send(
      'delete',
      path(booking.id),
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'no_show',
    });
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('answers the confirmation’s mechanic_busy when a time block now covers the slot', async () => {
    const { booking, volt } = await recorded();
    await prisma.timeBlock.create({
      data: {
        createdBy: volt.owner,
        endsAt: new Date(booking.startsAt.getTime() + 60 * 60_000),
        garageId: volt.garage.id,
        mechanicId: volt.answeringMechanic.id,
        segments: {
          create: {
            endsAt: new Date(booking.startsAt.getTime() + 60 * 60_000),
            garageId: volt.garage.id,
            mechanicId: volt.answeringMechanic.id,
            startsAt: booking.startsAt,
          },
        },
        startsAt: booking.startsAt,
        updatedBy: volt.owner,
      },
    });
    const before = await snapshot(booking.id);

    const res = await send(
      'delete',
      path(booking.id),
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('mechanic_busy');
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('answers the confirmation’s lift_busy when another booking now holds the lift', async () => {
    const { booking, volt } = await recorded();
    await world.booked(
      volt.garage.id,
      booking.startsAt.toISOString(),
      'confirmed',
      {
        lift: 1,
        mechanicId: volt.plainMechanic.id,
      },
    );
    const before = await snapshot(booking.id);

    const res = await send(
      'delete',
      path(booking.id),
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('lift_busy');
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('answers 409 when the request was closed for another reason', async () => {
    const { booking, volt } = await recorded();
    await prisma.quoteRequest.update({
      data: { closedReason: 'booking_cancelled' },
      where: { id: booking.requestId },
    });

    const res = await send(
      'delete',
      path(booking.id),
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_transition');
  });

  it('answers 403 to another mechanic and 404 outside the garage, to the driver and to an admin', async () => {
    const { booking, volt } = await recorded();
    const nordic = await team('Garaj Nordic');
    const admin = await world.account('Ada Admin', ['admin']);

    const other = await send(
      'delete',
      path(booking.id),
      bearer(volt.plain, 'mechanic'),
    );
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('forbidden');
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: volt.plain },
    });
    const inEnglish = await send(
      'delete',
      path(booking.id),
      bearer(volt.plain, 'mechanic'),
    );
    expect(inEnglish.body.message).toBe(
      'You cannot withdraw a no-show on another mechanic’s booking',
    );
    for (const auth of [
      bearer(nordic.owner, 'garage'),
      bearer(booking.driverId, 'driver'),
      bearer(admin, 'admin'),
    ]) {
      expect((await send('delete', path(booking.id), auth)).status).toBe(404);
    }
  });
});
