import { randomUUID } from 'node:crypto';

import { noShowWorld } from './no-show.testing';
import { quotesApp } from '../quotes-api.testing';

const app = quotesApp();
const { bearer, send, world } = app;
const { prisma } = world;
const { due, snapshot } = noShowWorld(app);

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE outbox_event'));

const path = (id: string) => `/bookings/${id}/no-show`;
const events = (type: string) =>
  prisma.outboxEvent.findMany({ where: { kind: type } });

// @traces 1259-FR-001
// @traces 1259-FR-002
describe('recording a no-show twice or at once', () => {
  it('refuses the second recording, naming no_show, and tells the driver once', async () => {
    const { booking, volt } = await due({ job: 'to_do' });
    const owner = bearer(volt.owner, 'garage');

    expect((await send('post', path(booking.id), owner)).status).toBe(200);
    const before = await snapshot(booking.id);
    const again = await send('post', path(booking.id), owner);

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'no_show',
    });
    expect(await snapshot(booking.id)).toEqual(before);
    expect(await events('booking.no_show_recorded')).toHaveLength(1);
  });

  it('lets one of two simultaneous recordings win and writes one event', async () => {
    const { booking, volt } = await due({ job: 'to_do' });

    const results = await Promise.all([
      send('post', path(booking.id), bearer(volt.owner, 'garage')),
      send('post', path(booking.id), bearer(volt.receptionist, 'receptionist')),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await events('booking.no_show_recorded')).toHaveLength(1);
    expect(
      await prisma.bookingSegment.count({ where: { bookingId: booking.id } }),
    ).toBe(0);
  });

  it('refuses a booking whose job was cancelled by other means', async () => {
    const { booking, volt } = await due({ job: 'cancelled' });
    const before = await snapshot(booking.id);

    const res = await send(
      'post',
      path(booking.id),
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(409);
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('refuses a booking that starts a few seconds from now', async () => {
    const { booking, volt } = await due();
    await prisma.booking.update({
      data: { startsAt: new Date(Date.now() + 5_000) },
      where: { id: booking.id },
    });
    const before = await snapshot(booking.id);

    const res = await send(
      'post',
      path(booking.id),
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(409);
    expect(await snapshot(booking.id)).toEqual(before);
  });

  it('refuses a suspended account and writes nothing', async () => {
    const { booking, volt } = await due({ job: 'to_do' });
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id: volt.owner },
    });
    const before = await snapshot(booking.id);

    const res = await send(
      'post',
      path(booking.id),
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
    expect(await snapshot(booking.id)).toEqual(before);
  });
});

// @traces 1259-FR-004
// @traces 1259-FR-006
describe('withdrawing a no-show twice, by each role, and the round trip', () => {
  it('refuses a second withdrawal and tells the driver once', async () => {
    const { booking, volt } = await due({ job: 'to_do' });
    const owner = bearer(volt.owner, 'garage');
    await send('post', path(booking.id), owner);
    expect((await send('delete', path(booking.id), owner)).status).toBe(200);
    const before = await snapshot(booking.id);

    const again = await send('delete', path(booking.id), owner);

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'confirmed',
    });
    expect(await snapshot(booking.id)).toEqual(before);
    expect(await events('booking.no_show_withdrawn')).toHaveLength(1);
  });

  it('lets one of two simultaneous withdrawals win and writes one event', async () => {
    const { booking, volt } = await due({ job: 'to_do' });
    await send('post', path(booking.id), bearer(volt.owner, 'garage'));

    const results = await Promise.all([
      send('delete', path(booking.id), bearer(volt.owner, 'garage')),
      send(
        'delete',
        path(booking.id),
        bearer(volt.receptionist, 'receptionist'),
      ),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await events('booking.no_show_withdrawn')).toHaveLength(1);
    expect(
      await prisma.bookingSegment.count({ where: { bookingId: booking.id } }),
    ).toBe(1);
  });

  it.each([
    ['a receptionist', 'receptionist'],
    ['the booking’s mechanic', 'mechanic'],
  ] as const)(
    'lets %s withdraw what the owner recorded',
    async (_name, role) => {
      const { booking, volt } = await due({ job: 'to_do' });
      await send('post', path(booking.id), bearer(volt.owner, 'garage'));
      const account =
        role === 'receptionist' ? volt.receptionist : volt.answering;

      const res = await send('delete', path(booking.id), bearer(account, role));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmed');
      expect(res.body.noShowAt ?? null).toBeNull();
    },
  );

  it('restores booking, job, request and segment to what they were', async () => {
    const { booking, volt } = await due({ job: 'to_do' });
    const owner = bearer(volt.owner, 'garage');
    const strip = <T extends { id?: string }>(rows: T[]) =>
      rows.map(({ id: _id, ...rest }) => rest);
    const before = await snapshot(booking.id);

    await send('post', path(booking.id), owner);
    await send('delete', path(booking.id), owner);
    const after = await snapshot(booking.id);

    expect(after.booking).toEqual(before.booking);
    expect(after.job).toEqual(before.job);
    expect(after.request).toEqual(before.request);
    expect(strip(after.segments)).toEqual(strip(before.segments));
  });

  it('answers 404 to an admin and 401 to a visitor, and 400 to a malformed id', async () => {
    const { booking } = await due();
    const admin = await world.account('Ada Admin', ['admin']);

    expect(
      (await send('delete', path(booking.id), bearer(admin, 'admin'))).status,
    ).toBe(404);
    expect((await app.get(`/bookings/${booking.id}/no-show`)).status).not.toBe(
      200,
    );
    const visitor = await app.post(path(booking.id), {});
    expect(visitor.status).toBe(401);
    expect(
      (await send('delete', path('not-a-uuid'), bearer(admin, 'admin'))).status,
    ).toBe(400);
    expect(
      (await send('delete', path('ß-ü-日本'), bearer(admin, 'admin'))).status,
    ).toBe(400);
    expect(
      (await send('delete', path(randomUUID()), bearer(admin, 'admin'))).status,
    ).toBe(404);
  });

  it('answers 404 to the booking’s removed mechanic withdrawing', async () => {
    const { booking, volt } = await due({ job: 'to_do' });
    await send('post', path(booking.id), bearer(volt.owner, 'garage'));
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: volt.answeringMechanic.id },
    });

    const res = await send(
      'delete',
      path(booking.id),
      bearer(volt.answering, 'mechanic'),
    );

    expect(res.status).toBe(404);
  });

  it('refuses a withdrawal exactly when the recording is a day and a second old', async () => {
    const { booking, volt } = await due({ job: 'to_do' });
    const owner = bearer(volt.owner, 'garage');
    await send('post', path(booking.id), owner);
    await prisma.booking.update({
      data: { noShowAt: new Date(Date.now() - 48 * 3_600_000) },
      where: { id: booking.id },
    });
    const before = await snapshot(booking.id);

    const res = await send('delete', path(booking.id), owner);

    expect(res.status).toBe(409);
    expect(res.body.currentStatus).toBe('no_show');
    expect(await snapshot(booking.id)).toEqual(before);
  });
});
