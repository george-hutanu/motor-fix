import { randomUUID } from 'node:crypto';

import { GarageScheduleService } from './garage-schedule.service';
import { garageActor } from '../quotes.testing';
import { quotesApp } from '../quotes-api.testing';

const { team, world } = quotesApp();
const { prisma } = world;
const service = new GarageScheduleService(prisma);

const NOW = new Date('2026-10-09T07:00:00Z');

type Team = Awaited<ReturnType<typeof team>>;

const mechanicActor = (t: Team, canMoveBookings = false) =>
  garageActor(t.answering, t.garage.id, 'mechanic', { canMoveBookings });
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => 'answered',
    (error: { getStatus(): number; getResponse(): { code?: string } }) => [
      error.getStatus(),
      error.getResponse().code,
    ],
  );

// @traces 102-FR-008
describe('a mechanic’s schedule under hostile input', () => {
  it('answers an empty list, not an error, for a mechanic with no booking', async () => {
    const t = await team('Atelier Dinamo');
    await world.booked(t.garage.id, '2026-10-09T06:00:00Z', 'confirmed', {
      mechanicId: t.plainMechanic.id,
    });

    const answer = await service.list(mechanicActor(t), {}, NOW);

    expect(answer.entries).toEqual([]);
  });

  it('shows only her bookings among two hundred of the garage’s', async () => {
    const t = await team('Atelier Dinamo');
    const hers: string[] = [];
    // Completed, so the database's one-confirmed-booking-at-a-time rule for a
    // mechanic does not refuse two hundred in one day.
    for (let i = 0; i < 200; i++) {
      const own = i % 10 === 0;
      const b = await world.booked(
        t.garage.id,
        `2026-10-09T${String(5 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
        'completed',
        {
          mechanicId: own ? t.answeringMechanic.id : t.plainMechanic.id,
        },
      );
      if (own) hers.push(b.id);
    }

    const answer = await service.list(mechanicActor(t), {}, NOW);

    expect(answer.entries.map((e) => e.id).sort()).toEqual([...hers].sort());
  }, 120_000);

  it.each([
    ['a random uuid', () => randomUUID()],
    ['a not-a-uuid string', () => 'nobody'],
    ['the empty string', () => ''],
    ['a whitespace string', () => ' '],
    ['her own id upper-cased with a trailing space', () => 'X'],
  ])('answers 403 forbidden for mechanicId %s', async (_, make) => {
    const t = await team('Atelier Dinamo');
    const asked =
      make() === 'X' ? `${t.answeringMechanic.id.toUpperCase()} ` : make();

    expect(
      await refusal(service.list(mechanicActor(t), { mechanicId: asked }, NOW)),
    ).toEqual([403, 'forbidden']);
  });

  it('answers 403 for another garage’s mechanic id and for the plain mechanic of her own', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Militari');

    for (const id of [other.answeringMechanic.id, t.plainMechanic.id])
      expect(
        await refusal(service.list(mechanicActor(t), { mechanicId: id }, NOW)),
      ).toEqual([403, 'forbidden']);
  });

  it('never shows her a booking of another garage that carries her mechanic id', async () => {
    const t = await team('Atelier Dinamo');
    const other = await team('Service Militari');
    await world.booked(other.garage.id, '2026-10-09T06:00:00Z', 'confirmed', {
      mechanicId: other.answeringMechanic.id,
    });

    const answer = await service.list(mechanicActor(t), {}, NOW);

    expect(answer.entries).toEqual([]);
  });

  it('answers 404 to a mechanic card whose membership was removed', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: t.answeringMechanic.id },
    });
    await world.booked(t.garage.id, '2026-10-09T06:00:00Z', 'confirmed', {
      mechanicId: t.answeringMechanic.id,
    });

    const result = await refusal(service.list(mechanicActor(t), {}, NOW));

    // The status only: the HTTP layer names the code.
    expect(result).toEqual([404, undefined]);
  });

  it('gives a mechanic with a garage-less actor 404, not her bookings', async () => {
    const t = await team('Atelier Dinamo');
    const actor = { ...mechanicActor(t), garageId: undefined };

    expect(await refusal(service.list(actor as never, {}, NOW))).toEqual([
      404,
      undefined,
    ]);
  });

  it('answers the same twice and does not change by the move right', async () => {
    const t = await team('Atelier Dinamo');
    const b = await world.booked(
      t.garage.id,
      '2026-10-09T06:00:00Z',
      'confirmed',
      {
        mechanicId: t.answeringMechanic.id,
      },
    );

    const [off, on, again] = [
      await service.list(mechanicActor(t, false), {}, NOW),
      await service.list(mechanicActor(t, true), {}, NOW),
      await service.list(mechanicActor(t, false), {}, NOW),
    ];

    expect(off.entries.map((e) => e.id)).toEqual([b.id]);
    expect(on).toEqual(off);
    expect(again).toEqual(off);
  });

  it('keeps the lifts and phone out of her answer while still refusing a range over seven days', async () => {
    const t = await team('Atelier Dinamo');
    await world.booked(t.garage.id, '2026-10-09T06:00:00Z', 'confirmed', {
      mechanicId: t.answeringMechanic.id,
    });

    const answer = await service.list(mechanicActor(t), {}, NOW);

    expect(JSON.stringify(answer)).not.toMatch(/phone|B123ABC/);
    expect(
      await refusal(
        service.list(
          mechanicActor(t),
          { from: '2026-10-12', to: '2026-10-19' },
          NOW,
        ),
      ),
    ).toEqual([400, 'validation']);
  });
});
