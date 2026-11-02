import { randomUUID } from 'node:crypto';

import { quotesApp } from '../../quotes/quotes-api.testing';
import { SavedGaragesModule } from '../saved-garages/saved-garages.module';

const { bearer, get, send, world } = quotesApp([SavedGaragesModule]);
const { prisma } = world;

const path = (garageId: string) => `/me/save-suggestions/${garageId}/dismiss`;
const dismiss = (driver: string, garageId: string) =>
  send('post', path(garageId), bearer(driver, 'driver'));
const rows = (accountId: string) =>
  prisma.saveSuggestionDismissal.findMany({ where: { accountId } });
const suggestion = async (driver: string) =>
  (await get('/quote-requests/active', bearer(driver, 'driver'))).body.request
    .saveSuggestion;

type JobStatus = 'to_do' | 'in_work' | 'paused' | 'done' | 'cancelled';

async function worked(driver: string, garageId: string, status: JobStatus) {
  const { booking } = await world.chain(driver, garageId);
  return world.job(booking.id, status);
}

// @traces 293-FR-002 293-FR-003
describe('save suggestion edge cases', () => {
  describe('the saveSuggestion field', () => {
    it('carries the garage id and name for a done job at an approved garage', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await worked(andrei, dinamo.id, 'done');

      expect(await suggestion(andrei)).toEqual({
        garageId: dinamo.id,
        name: 'Atelier Dinamo',
      });
    });

    it.each(['to_do', 'in_work', 'paused', 'cancelled'] as const)(
      'is null for a %s job',
      async (status) => {
        const andrei = await world.account('Andrei Marin');
        const dinamo = await world.garage('Atelier Dinamo');
        await worked(andrei, dinamo.id, status);

        expect(await suggestion(andrei)).toBeNull();
      },
    );

    it('is null for a request with a booking and no job', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await world.chain(andrei, dinamo.id);

      expect(await suggestion(andrei)).toBeNull();
    });

    it('is null for a request with no booking', async () => {
      const andrei = await world.account('Andrei Marin');
      await world.request(andrei, { status: 'sent' });

      expect(await suggestion(andrei)).toBeNull();
    });

    it('is null for a garage the driver already saved', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await worked(andrei, dinamo.id, 'done');
      await prisma.savedGarage.create({
        data: { accountId: andrei, garageId: dinamo.id },
      });

      expect(await suggestion(andrei)).toBeNull();
    });

    it('is null for a garage suspended before the job was done', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await prisma.garage.update({
        data: { status: 'suspended' },
        where: { id: dinamo.id },
      });
      await worked(andrei, dinamo.id, 'done');

      expect(await suggestion(andrei)).toBeNull();
    });

    it('goes null when the garage is suspended after and returns on re-approval', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await worked(andrei, dinamo.id, 'done');
      await prisma.garage.update({
        data: { status: 'suspended' },
        where: { id: dinamo.id },
      });
      expect(await suggestion(andrei)).toBeNull();

      await prisma.garage.update({
        data: { status: 'approved' },
        where: { id: dinamo.id },
      });

      expect(await suggestion(andrei)).toEqual({
        garageId: dinamo.id,
        name: 'Atelier Dinamo',
      });
    });

    it('is not hidden for another driver who dismissed the same garage', async () => {
      const andrei = await world.account('Andrei Marin');
      const ioana = await world.account('Ioana Pop');
      const dinamo = await world.garage('Atelier Dinamo');
      await worked(andrei, dinamo.id, 'done');
      await worked(ioana, dinamo.id, 'done');
      await dismiss(ioana, dinamo.id);

      expect(await suggestion(andrei)).toEqual({
        garageId: dinamo.id,
        name: 'Atelier Dinamo',
      });
    });

    it('is not hidden by a dismissal of another garage', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      const rapid = await world.garage('Service Rapid');
      const earlier = await world.chain(andrei, dinamo.id, {
        booking: 'completed',
        request: 'closed',
      });
      await world.job(earlier.booking.id, 'done');
      await worked(andrei, rapid.id, 'done');
      await dismiss(andrei, dinamo.id);

      expect(await suggestion(andrei)).toEqual({
        garageId: rapid.id,
        name: 'Service Rapid',
      });
    });
  });

  describe('the dismiss route', () => {
    it('answers 404 when the only job there is cancelled', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await worked(andrei, dinamo.id, 'cancelled');

      expect((await dismiss(andrei, dinamo.id)).status).toBe(404);
      expect(await rows(andrei)).toHaveLength(0);
    });

    it('answers 404 for a done job at a different garage', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      const rapid = await world.garage('Service Rapid');
      await worked(andrei, dinamo.id, 'done');

      expect((await dismiss(andrei, rapid.id)).status).toBe(404);
      expect(await rows(andrei)).toHaveLength(0);
    });

    it('answers 204 and stores one row for two simultaneous calls', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await worked(andrei, dinamo.id, 'done');

      const results = await Promise.all(
        Array.from({ length: 8 }, () => dismiss(andrei, dinamo.id)),
      );

      expect(results.map((r) => r.status)).toEqual(Array(8).fill(204));
      expect(await rows(andrei)).toHaveLength(1);
    });

    it('answers 204 for a garage already saved and keeps the saved row', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await worked(andrei, dinamo.id, 'done');
      await prisma.savedGarage.create({
        data: { accountId: andrei, garageId: dinamo.id },
      });

      expect((await dismiss(andrei, dinamo.id)).status).toBe(204);
      expect(
        await prisma.savedGarage.count({ where: { accountId: andrei } }),
      ).toBe(1);
    });

    it('ignores a request body', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await worked(andrei, dinamo.id, 'done');

      const res = await send(
        'post',
        path(dinamo.id),
        bearer(andrei, 'driver'),
        {
          garageId: randomUUID(),
        },
      );

      expect(res.status).toBe(204);
      expect((await rows(andrei))[0].garageId).toBe(dinamo.id);
    });

    it.each([
      ['an empty-looking id', '%20'],
      ['an id with a trailing character', `${randomUUID()}x`],
      ['an id with unicode digits', '١٢٣٤٥٦٧٨-1234-1234-1234-123456789012'],
      ['an integer', '12345'],
    ])('answers 400 for %s', async (_title, id) => {
      const andrei = await world.account('Andrei Marin');

      expect((await dismiss(andrei, id)).status).toBe(400);
      expect(await rows(andrei)).toHaveLength(0);
    });

    it('answers 404 for the nil uuid', async () => {
      const andrei = await world.account('Andrei Marin');

      expect(
        (await dismiss(andrei, '00000000-0000-0000-0000-000000000000')).status,
      ).toBe(404);
    });
  });

  describe('the cascade', () => {
    it('removes the dismissal with the garage', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await prisma.saveSuggestionDismissal.create({
        data: { accountId: andrei, garageId: dinamo.id },
      });

      await prisma.garage.delete({ where: { id: dinamo.id } });

      expect(await rows(andrei)).toHaveLength(0);
    });

    it('removes the dismissal with the account', async () => {
      const andrei = await world.account('Andrei Marin');
      const dinamo = await world.garage('Atelier Dinamo');
      await prisma.saveSuggestionDismissal.create({
        data: { accountId: andrei, garageId: dinamo.id },
      });

      await prisma.account.delete({ where: { id: andrei } });

      expect(
        await prisma.saveSuggestionDismissal.count({
          where: { garageId: dinamo.id },
        }),
      ).toBe(0);
    });
  });
});
