import type { Role } from '@motor-fix/contracts/capabilities';
import { Logger } from '@nestjs/common';

import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

// Atelier Dinamo with three lifts and the cards Fixer and Hand, plus the
// switches turned off.
async function setting(off: string[] = []) {
  const t = await team('Atelier Dinamo');
  await prisma.garage.update({
    data: { liftCount: 3 },
    where: { id: t.garage.id },
  });
  for (const key of off) {
    await prisma.garageFeature.upsert({
      create: { enabled: false, garageId: t.garage.id, key },
      update: { enabled: false },
      where: { garageId_key: { garageId: t.garage.id, key } },
    });
  }
  const path = `/garages/${t.garage.id}/time-blocks/options`;
  const read = (id = t.owner, role: Role = 'garage') =>
    get(path, bearer(id, role));
  return { ...t, path, read };
}

const card = (m: { id: string; name: string }) => ({ id: m.id, name: m.name });

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

// @traces 1395-FR-001
// @traces 1395-FR-003
// @traces 1395-FR-004
// @traces 1395-FR-008
describe('what a block may take', () => {
  it("tells the receptionist the lift count and the team's current cards, in the confirm options' order", async () => {
    const s = await setting();
    await prisma.mechanic.create({
      data: {
        garageId: s.garage.id,
        name: 'Gone',
        removedAt: new Date(),
      },
    });
    const stefan = await prisma.mechanic.create({
      data: { garageId: s.garage.id, name: 'Ștefan Ilie' },
    });
    const confirmOrder = await prisma.mechanic.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      where: { garageId: s.garage.id, removedAt: null },
    });

    const res = await s.read(s.receptionist, 'receptionist');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      liftCount: 3,
      mechanics: confirmOrder.map(card),
    });
    expect(res.body.mechanics.map((m: { id: string }) => m.id)).toEqual(
      expect.arrayContaining([
        s.answeringMechanic.id,
        s.plainMechanic.id,
        stefan.id,
      ]),
    );
    expect(res.body.mechanics).toHaveLength(3);
  });

  it('gives the owner the same answer as the receptionist', async () => {
    const s = await setting();

    const owner = await s.read();
    const desk = await s.read(s.receptionist, 'receptionist');

    expect(owner.status).toBe(200);
    expect(owner.body).toEqual(desk.body);
  });

  it('offers no lift while the lifts are off', async () => {
    const s = await setting(['lift_schedule']);

    const res = await s.read();

    expect(res.status).toBe(200);
    expect(res.body.liftCount).toBe(0);
    expect(res.body.mechanics).toHaveLength(2);
  });

  it('offers no mechanic while the team is off', async () => {
    const s = await setting(['team_mechanics']);

    const res = await s.read(s.receptionist, 'receptionist');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ liftCount: 3, mechanics: [] });
  });

  it('answers nothing to offer, not a refusal, while both are off', async () => {
    const s = await setting(['team_mechanics', 'lift_schedule']);

    const res = await s.read();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ liftCount: 0, mechanics: [] });
    expect(warn).not.toHaveBeenCalled();
  });

  it('lists no mechanic for a team with no card yet', async () => {
    const s = await setting();
    await prisma.mechanic.deleteMany({ where: { garageId: s.garage.id } });

    const res = await s.read();

    expect(res.body).toEqual({ liftCount: 3, mechanics: [] });
  });

  it("lists the owner's own card as any other", async () => {
    const s = await setting();
    const own = await prisma.mechanic.create({
      data: { accountId: s.owner, garageId: s.garage.id, name: 'Owner Card' },
    });

    const res = await s.read();

    expect(res.body.mechanics).toContainEqual(card(own));
  });
});

// @traces 1395-FR-002
// @traces 1395-FR-005
// @traces 1395-FR-008
describe('who may read what a block may take', () => {
  it.each([false, true])(
    'refuses a mechanic of the garage, moving bookings %s, 403',
    async (canMoveBookings) => {
      const s = await setting();
      await prisma.mechanic.update({
        data: { canMoveBookings },
        where: { id: s.plainMechanic.id },
      });

      const res = await s.read(s.plain, 'mechanic');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
      expect(res.body.message).toBe(
        'Doar proprietarul sau recepția blochează timp',
      );
      expect(res.body).not.toHaveProperty('mechanics');
      expect(res.body).not.toHaveProperty('liftCount');
    },
  );

  it.each(['other owner', 'driver', 'admin'] as const)(
    'answers the %s with 404',
    async (who) => {
      const s = await setting();
      const other = await team('Service Militari');
      const actors: Record<typeof who, [string, Role]> = {
        admin: [await world.account('Ana Admin', ['admin']), 'admin'],
        driver: [await world.account('Andrei Marin', ['driver']), 'driver'],
        'other owner': [other.owner, 'garage'],
      };

      const res = await s.read(...actors[who]);

      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('mechanics');
    },
  );

  it('logs one line per refusal with the garage and the code, as the blocked-time list does', async () => {
    const s = await setting();
    const other = await team('Service Militari');

    await s.read(s.plain, 'mechanic');
    await get(
      `/garages/${s.garage.id}/time-blocks`,
      bearer(other.owner, 'garage'),
    );

    expect(warn.mock.calls).toEqual([
      [{ blockId: undefined, code: 'forbidden', garageId: s.garage.id }],
      [{ blockId: undefined, code: 404, garageId: s.garage.id }],
    ]);
  });

  it('answers a garage that does not exist with 404', async () => {
    const s = await setting();

    const res = await get(
      '/garages/00000000-0000-4000-8000-000000000000/time-blocks/options',
      bearer(s.owner, 'garage'),
    );

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('mechanics');
  });

  it('refuses a garage id that is not a uuid, as the other time-block routes do', async () => {
    const s = await setting();

    const res = await get(
      '/garages/not-a-uuid/time-blocks/options',
      bearer(s.owner, 'garage'),
    );

    expect(res.status).toBe(400);
  });

  it('asks a visitor to sign in', async () => {
    const s = await setting();

    const res = await get(s.path);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers the same twice and writes nothing', async () => {
    const s = await setting();
    const events = await prisma.outboxEvent.count();
    const activity = await prisma.activityLog.count();

    const first = await s.read();
    const second = await s.read(s.receptionist, 'receptionist');

    expect(second.body).toEqual(first.body);
    expect(await prisma.outboxEvent.count()).toBe(events);
    expect(await prisma.activityLog.count()).toBe(activity);
    expect(await prisma.timeBlock.count()).toBe(0);
  });
});
