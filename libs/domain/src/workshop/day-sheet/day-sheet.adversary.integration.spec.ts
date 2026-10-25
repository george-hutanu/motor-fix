import { randomUUID } from 'node:crypto';

import { DaySheetService } from './day-sheet.service';
import { garageActor } from '../../quotes/quotes.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { team, world } = quotesApp();
const { prisma } = world;
const service = new DaySheetService(prisma);

const NOW = new Date('2026-10-09T07:00:00Z');

type Team = Awaited<ReturnType<typeof team>>;

const self = (t: Team) =>
  garageActor(t.answering, t.garage.id, 'mechanic', { canMoveBookings: true });
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'answered' as const,
    (error: { getStatus(): number; getResponse(): unknown }) => ({
      body: JSON.stringify(error.getResponse()),
      status: error.getStatus(),
    }),
  );

// @traces 102-FR-008
describe('a mechanic’s day sheet under hostile input', () => {
  it.each([
    ['a random uuid', randomUUID()],
    ['the empty string', ''],
    ['a lone wildcard', '%'],
    ['an sql fragment', "' OR 1=1 --"],
    ['a prefix of her own name', 'Fix'],
    ['her name with other text around it', 'Fixer Hand'],
    ['the other mechanic’s name in upper case', 'HAND'],
  ])('answers 403 and no mechanics list for %s', async (_, asked) => {
    const t = await team('Atelier Dinamo');

    const result = await outcome(
      service.get(self(t), { mechanic: asked }, NOW),
    );

    expect(result).toMatchObject({ status: 403 });
    expect(JSON.stringify(result)).not.toMatch(/mechanic_not_found|Hand/);
  });

  it('answers 403 for another garage’s mechanic id, hiding whether it exists', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Militari');

    const real = await outcome(
      service.get(self(t), { mechanic: other.answeringMechanic.id }, NOW),
    );
    const fake = await outcome(
      service.get(self(t), { mechanic: randomUUID() }, NOW),
    );

    expect(real).toEqual(fake);
    expect(real).toMatchObject({ status: 403 });
  });

  it('gives her own sheet for her id in upper case and for her name in any case', async () => {
    const t = await team('Atelier Dinamo');

    for (const asked of [
      t.answeringMechanic.id.toUpperCase(),
      'FIXER',
      'fixer',
    ]) {
      const sheet = await service.get(self(t), { mechanic: asked }, NOW);
      expect([asked, sheet.mechanic.id]).toEqual([
        asked,
        t.answeringMechanic.id,
      ]);
    }
  });

  it('gives her own sheet when no mechanic is named, and never the garage’s other jobs', async () => {
    const t = await team('Atelier Dinamo');
    const hers = await world.booked(
      t.garage.id,
      '2026-10-09T06:00:00Z',
      'confirmed',
      {
        mechanicId: t.answeringMechanic.id,
      },
    );
    await world.booked(t.garage.id, '2026-10-09T08:00:00Z', 'confirmed', {
      mechanicId: t.plainMechanic.id,
    });
    await world.booked(t.garage.id, '2026-10-09T09:00:00Z', 'confirmed');

    const sheet = await service.get(self(t), {} as never, NOW);

    expect(sheet.mechanic.id).toBe(t.answeringMechanic.id);
    expect(sheet.entries.map((e) => e.id)).toEqual([hers.id]);
  });

  it('keeps a mechanic with the same name in another garage out of her reach', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Militari');
    await world.booked(other.garage.id, '2026-10-09T06:00:00Z', 'confirmed', {
      mechanicId: other.answeringMechanic.id,
    });

    const sheet = await service.get(self(t), { mechanic: 'Fixer' }, NOW);

    expect(sheet.mechanic.id).toBe(t.answeringMechanic.id);
    expect(sheet.entries).toEqual([]);
  });

  it('answers a removed mechanic card 404, not her sheet', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: t.answeringMechanic.id },
    });

    const result = await outcome(service.get(self(t), {} as never, NOW));

    expect(result).toMatchObject({ status: 404 });
  });

  it('still answers the owner 404 mechanic_not_found with the list for an unknown name', async () => {
    const t = await team('Atelier Dinamo');

    const result = await outcome(
      service.get(garageActor(t.owner, t.garage.id), { mechanic: 'zzz' }, NOW),
    );

    expect(result).toMatchObject({ status: 404 });
    expect(JSON.stringify(result)).toContain('mechanic_not_found');
  });

  it('carries no phone and no plate in her sheet', async () => {
    const t = await team('Atelier Dinamo');
    await world.booked(t.garage.id, '2026-10-09T06:00:00Z', 'confirmed', {
      mechanicId: t.answeringMechanic.id,
    });

    const sheet = await service.get(self(t), {} as never, NOW);

    expect(JSON.stringify(sheet)).not.toMatch(/phone|B123ABC/);
  });
});
