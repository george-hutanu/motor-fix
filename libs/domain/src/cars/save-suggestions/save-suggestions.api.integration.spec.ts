import { randomUUID } from 'node:crypto';

import { outboxMark } from '../../events/outbox.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { SavedGaragesModule } from '../saved-garages/saved-garages.module';

const { bearer, get, post, send, world } = quotesApp([SavedGaragesModule]);
const { prisma } = world;

const path = (garageId: string) => `/me/save-suggestions/${garageId}/dismiss`;
const dismiss = (driver: string, garageId: string) =>
  send('post', path(garageId), bearer(driver, 'driver'));
const rows = (accountId: string) =>
  prisma.saveSuggestionDismissal.findMany({ where: { accountId } });

// A request booked at the garage, its job in the status asked.
async function worked(
  driver: string,
  garageId: string,
  status: 'in_work' | 'done',
) {
  const { booking } = await world.chain(driver, garageId);
  return world.job(booking.id, status);
}

// @traces 293-FR-001 293-FR-002 293-FR-004 293-FR-007
describe('POST /me/save-suggestions/:garageId/dismiss', () => {
  it('records the driver’s no once, answering 204', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await worked(andrei, dinamo.id, 'done');

    const res = await dismiss(andrei, dinamo.id);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await rows(andrei)).toEqual([
      expect.objectContaining({ accountId: andrei, garageId: dinamo.id }),
    ]);
  });

  it('answers 204 again and keeps the first time', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await worked(andrei, dinamo.id, 'done');
    await dismiss(andrei, dinamo.id);
    const [first] = await rows(andrei);

    const res = await dismiss(andrei, dinamo.id);

    expect(res.status).toBe(204);
    expect(await rows(andrei)).toEqual([first]);
  });

  it('leaves the active request with no suggestion for that garage', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await worked(andrei, dinamo.id, 'done');
    const before = await get(
      '/quote-requests/active',
      bearer(andrei, 'driver'),
    );
    expect(before.body.request.saveSuggestion?.garageId).toBe(dinamo.id);

    await dismiss(andrei, dinamo.id);

    const after = await get('/quote-requests/active', bearer(andrei, 'driver'));
    expect(after.body.request.saveSuggestion).toBeNull();
  });

  it('records it for a garage no longer approved', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await worked(andrei, dinamo.id, 'done');
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: dinamo.id },
    });

    expect((await dismiss(andrei, dinamo.id)).status).toBe(204);
    expect(await rows(andrei)).toHaveLength(1);
  });

  it('writes no audit entry and no event', async () => {
    const andrei = await world.account('Andrei Marin');
    const dinamo = await world.garage('Atelier Dinamo');
    await worked(andrei, dinamo.id, 'done');
    const mark = await outboxMark(prisma);
    const [{ now }] = await prisma.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;

    await dismiss(andrei, dinamo.id);

    expect(
      await prisma.activityLog.count({
        where: { actorId: andrei, at: { gte: now } },
      }),
    ).toBe(0);
    expect(
      await prisma.outboxEvent.count({ where: { id: { gt: mark } } }),
    ).toBe(0);
  });

  describe('answers 404 not_found and records nothing', () => {
    it('while the driver’s job there is still in work', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await worked(andrei, dinamo.id, 'in_work');

      const res = await dismiss(andrei, dinamo.id);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      expect(await rows(andrei)).toHaveLength(0);
    });

    it('for a garage where only another driver’s job is done', async () => {
      const andrei = await world.account('Andrei Marin');
      const ioana = await world.account('Ioana Pop');
      const dinamo = await world.garage('Atelier Dinamo');
      await worked(ioana, dinamo.id, 'done');

      const res = await dismiss(andrei, dinamo.id);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      expect(await rows(andrei)).toHaveLength(0);
    });

    it('for an unknown garage', async () => {
      const andrei = await world.account('Andrei Marin');

      const res = await dismiss(andrei, randomUUID());

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      expect(await rows(andrei)).toHaveLength(0);
    });
  });

  describe('who may call it', () => {
    it.each(['garage', 'receptionist', 'mechanic', 'admin'] as const)(
      'answers 403 driver_role_required to the %s role',
      async (role) => {
        const staff = await world.account('Staff', ['driver', role]);
        const dinamo = await world.garage('Atelier Dinamo');
        await worked(staff, dinamo.id, 'done');

        const res = await send('post', path(dinamo.id), bearer(staff, role));

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('driver_role_required');
        expect(await rows(staff)).toHaveLength(0);
      },
    );

    it('answers 401 sign_in_required to a visitor', async () => {
      const dinamo = await world.garage('Atelier Dinamo');

      const res = await post(path(dinamo.id), {});

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    });

    // The code, validation_failed, is the API's global filter's, which this
    // app does not boot.
    it('answers 400 to a malformed id and records nothing', async () => {
      const andrei = await world.account('Andrei Marin');

      const res = await dismiss(andrei, 'not-a-uuid');

      expect(res.status).toBe(400);
      expect(await rows(andrei)).toHaveLength(0);
    });

    it('checks the session, then the role, then the id', async () => {
      const owner = await world.account('Owner', ['garage']);

      expect((await post(path('not-a-uuid'), {})).status).toBe(401);
      expect(
        (await send('post', path('not-a-uuid'), bearer(owner, 'garage')))
          .status,
      ).toBe(403);
    });
  });
});
