// @traces 427-FR-004
import { todayInBucharest } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';

import { addDays, atLocal } from '../../bucharest';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, send, team, world } = quotesApp();
const { prisma } = world;

// A day a week ahead, so every block is in the future.
const DAY = addDays(todayInBucharest(), 7);
const at = (hour: number) => atLocal(DAY, hour).toISOString();

async function setting(off: string[]) {
  const t = await team('Atelier Dinamo');
  await prisma.garage.update({
    data: { liftCount: 2 },
    where: { id: t.garage.id },
  });
  for (const key of off) {
    await prisma.garageFeature.upsert({
      create: { enabled: false, garageId: t.garage.id, key },
      update: { enabled: false },
      where: { garageId_key: { garageId: t.garage.id, key } },
    });
  }
  const create = (body: object) =>
    send(
      'post',
      `/garages/${t.garage.id}/time-blocks`,
      bearer(t.owner, 'garage'),
      body,
    );
  return { ...t, create };
}

const span = { endsAt: at(11), startsAt: at(10) };

beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
afterEach(() => jest.restoreAllMocks());

describe('blocking time under each switch', () => {
  it('saves a lift-only block with no mechanic while the team is off', async () => {
    const s = await setting(['team_mechanics']);

    const res = await s.create({ ...span, lift: 1 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ lift: 1, mechanic: null });
    expect(
      await prisma.bookingSegment.findMany({
        select: { lift: true, mechanicId: true },
        where: { timeBlockId: res.body.id },
      }),
    ).toEqual([{ lift: 1, mechanicId: null }]);
  });

  it('refuses a mechanic with feature_off while the team is off', async () => {
    const s = await setting(['team_mechanics']);

    const res = await s.create({
      ...span,
      lift: 1,
      mechanicId: s.plainMechanic.id,
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('feature_off');
    expect(await prisma.timeBlock.count()).toBe(0);
  });

  it('saves a mechanic-only block while the lifts are off, and shows no lift on it', async () => {
    const s = await setting(['lift_schedule']);

    const res = await s.create({ ...span, mechanicId: s.plainMechanic.id });

    expect(res.status).toBe(201);
    expect(res.body.mechanic).toEqual(
      expect.objectContaining({ id: s.plainMechanic.id }),
    );
    expect(res.body).not.toHaveProperty('lift');
    expect(
      await prisma.timeBlock.findUniqueOrThrow({ where: { id: res.body.id } }),
    ).toMatchObject({ lift: null, mechanicId: s.plainMechanic.id });
  });

  it('refuses a lift with feature_off while the lifts are off', async () => {
    const s = await setting(['lift_schedule']);

    const res = await s.create({ ...span, lift: 1 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('feature_off');
    expect(await prisma.timeBlock.count()).toBe(0);
  });

  it('says nothing_to_block for any block while both are off', async () => {
    const s = await setting(['team_mechanics', 'lift_schedule']);

    const results = await Promise.all([
      s.create(span),
      s.create({ ...span, lift: 1 }),
      s.create({ ...span, mechanicId: s.plainMechanic.id }),
    ]);

    for (const res of results) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('nothing_to_block');
    }
    expect(await prisma.timeBlock.count()).toBe(0);
  });
});
