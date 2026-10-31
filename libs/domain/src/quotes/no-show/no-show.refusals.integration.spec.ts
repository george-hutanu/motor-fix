import { randomUUID } from 'node:crypto';

import { noShowWorld } from './no-show.testing';
import type { BookingStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../quotes-api.testing';

const app = quotesApp();
const { bearer, send, team, world } = app;
const { prisma } = world;
const { due, snapshot } = noShowWorld(app);

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE outbox_event'));

const record = (bookingId: string, auth?: string) =>
  auth
    ? send('post', `/bookings/${bookingId}/no-show`, auth)
    : app.post(`/bookings/${bookingId}/no-show`, {});

// @traces 1259-FR-001
// @traces 1259-FR-002
// @traces 1259-FR-013
describe('refusing a no-show', () => {
  it('answers 409 before the booking’s time has come, writing nothing', async () => {
    const { booking, volt } = await due({ minutes: 10 });
    const before = await snapshot(booking.id);

    const res = await record(booking.id, bearer(volt.owner, 'garage'));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'confirmed',
    });
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it.each(['in_work', 'paused', 'done'] as const)(
    'answers 409 when the job is already %s',
    async (job) => {
      const { booking, volt } = await due({ job });
      const before = await snapshot(booking.id);

      const res = await record(booking.id, bearer(volt.owner, 'garage'));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('invalid_transition');
      expect(await snapshot(booking.id)).toEqual(before);
    },
  );

  // Each status carries the columns its check constraint asks for.
  const COLUMNS: Partial<Record<BookingStatus, object>> = {
    cancelled: {
      cancelledAt: new Date(),
      cancelledBySide: 'driver',
      cancelReason: 'plans_changed',
    },
    completed: { completedAt: new Date() },
    no_show: { noShowAt: new Date() },
  };

  it.each([
    'awaiting_confirmation',
    'cancelled',
    'lapsed',
    'completed',
    'no_show',
  ] as BookingStatus[])(
    'answers 409 to a %s booking, naming its status',
    async (status) => {
      const { booking, volt } = await due();
      await prisma.bookingSegment.deleteMany({
        where: { bookingId: booking.id },
      });
      await prisma.booking.update({
        data: { status, ...COLUMNS[status] },
        where: { id: booking.id },
      });
      const before = await snapshot(booking.id);

      const res = await record(booking.id, bearer(volt.owner, 'garage'));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: status,
      });
      expect(await snapshot(booking.id)).toEqual(before);
    },
  );

  it('answers 403 to another mechanic of the garage, in her language', async () => {
    const { booking, volt } = await due();
    const before = await snapshot(booking.id);

    const res = await record(booking.id, bearer(volt.plain, 'mechanic'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
    expect(res.body.message).toBe(
      'Nu poți înregistra neprezentarea pentru programarea altui mecanic',
    );
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('answers that 403 in English to a mechanic who reads English', async () => {
    const { booking, volt } = await due();
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: volt.plain },
    });

    const res = await record(booking.id, bearer(volt.plain, 'mechanic'));

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'You cannot record a no-show on another mechanic’s booking',
    );
  });

  it('answers 404 to another garage’s owner, the driver and an admin', async () => {
    const { booking } = await due();
    const nordic = await team('Garaj Nordic');
    const admin = await world.account('Ada Admin', ['admin']);
    const before = await snapshot(booking.id);

    for (const auth of [
      bearer(nordic.owner, 'garage'),
      bearer(nordic.answering, 'mechanic'),
      bearer(booking.driverId, 'driver'),
      bearer(admin, 'admin'),
    ]) {
      const res = await record(booking.id, auth);
      expect(res.status).toBe(404);
    }
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('answers 404 to the booking’s mechanic once her card is removed', async () => {
    const { booking, volt } = await due();
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: volt.answeringMechanic.id },
    });

    const res = await record(booking.id, bearer(volt.answering, 'mechanic'));

    expect(res.status).toBe(404);
  });

  it('answers 404 to a booking that does not exist, 400 to a malformed id, 401 without a session', async () => {
    const { volt } = await due();
    const owner = bearer(volt.owner, 'garage');

    expect((await record(randomUUID(), owner)).status).toBe(404);
    const malformed = await record('not-a-uuid', owner);
    expect(malformed.status).toBe(400);
    const anonymous = await record(randomUUID());
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('sign_in_required');
  });
});
