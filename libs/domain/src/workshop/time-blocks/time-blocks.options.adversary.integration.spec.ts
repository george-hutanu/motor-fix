import type { Role } from '@motor-fix/contracts/capabilities';

import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, post, team, world } = quotesApp();
const { prisma } = world;

async function setting(name = 'Atelier Dinamo') {
  const t = await team(name);
  await prisma.garage.update({
    data: { liftCount: 2 },
    where: { id: t.garage.id },
  });
  const path = `/garages/${t.garage.id}/time-blocks/options`;
  const read = (id = t.owner, role: Role = 'garage') =>
    get(path, bearer(id, role));
  return { ...t, path, read };
}

// @traces 1395-FR-001
// @traces 1395-FR-002
describe('the options path, attacked', () => {
  it('reads an upper-case garage id as the same garage', async () => {
    const s = await setting();

    const res = await get(
      `/garages/${s.garage.id.toUpperCase()}/time-blocks/options`,
      bearer(s.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body.liftCount).toBe(2);
  });

  it('answers a receptionist of another garage 404', async () => {
    const s = await setting();
    const other = await team('Service Militari');

    const res = await s.read(other.receptionist, 'receptionist');

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('mechanics');
  });

  it('answers a mechanic of another garage 404, not 403', async () => {
    const s = await setting();
    const other = await team('Service Militari');

    const res = await s.read(other.plain, 'mechanic');

    expect(res.status).toBe(404);
  });

  it('lists nothing of another garage on the answer', async () => {
    const s = await setting();
    const other = await team('Service Militari');
    await prisma.mechanic.create({
      data: { garageId: other.garage.id, name: 'Foreign Card' },
    });

    const res = await s.read();

    expect(res.body.mechanics.map((m: { name: string }) => m.name)).toEqual([
      'Fixer',
      'Hand',
    ]);
  });

  it('carries exactly liftCount and mechanics, each card only id and name', async () => {
    const s = await setting();

    const res = await s.read();

    expect(Object.keys(res.body).sort()).toEqual(['liftCount', 'mechanics']);
    for (const card of res.body.mechanics) {
      expect(Object.keys(card).sort()).toEqual(['id', 'name']);
    }
  });

  it('ignores a query string on the read', async () => {
    const s = await setting();

    const plain = await s.read();
    const noisy = await get(
      `${s.path}?from=2026-01-01&liftCount=99&mechanics=x`,
      bearer(s.owner, 'garage'),
    );

    expect(noisy.status).toBe(200);
    expect(noisy.body).toEqual(plain.body);
  });

  it('does not take options for a block id on a write', async () => {
    const s = await setting();

    const res = await post(s.path, {}, bearer(s.owner, 'garage'));

    expect(res.status).toBe(404);
  });

  it('answers a trailing-slash path like the plain path', async () => {
    const s = await setting();

    const res = await get(`${s.path}/`, bearer(s.owner, 'garage'));

    expect(res.status).toBe(200);
  });

  it('answers a sql-looking garage id 400', async () => {
    const s = await setting();

    const res = await get(
      `/garages/${encodeURIComponent("' OR 1=1 --")}/time-blocks/options`,
      bearer(s.owner, 'garage'),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });
});

// @traces 1395-FR-003
describe('the cards, attacked', () => {
  it('lists a team of many cards whole, in name then id order', async () => {
    const s = await setting();
    await prisma.mechanic.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        garageId: s.garage.id,
        name: `Card ${String(i % 20).padStart(2, '0')}`,
      })),
    });
    const expected = await prisma.mechanic.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
      where: { garageId: s.garage.id, removedAt: null },
    });

    const res = await s.read();

    expect(res.body.mechanics).toHaveLength(202);
    expect(res.body.mechanics).toEqual(expected);
  });

  it('lists two cards of the same name, ordered by id', async () => {
    const s = await setting();
    const [a, b] = await Promise.all([
      prisma.mechanic.create({
        data: { garageId: s.garage.id, name: 'Twin' },
      }),
      prisma.mechanic.create({
        data: { garageId: s.garage.id, name: 'Twin' },
      }),
    ]);

    const res = await s.read();

    const twins = res.body.mechanics.filter(
      (m: { name: string }) => m.name === 'Twin',
    );
    expect(twins.map((m: { id: string }) => m.id)).toEqual([a.id, b.id].sort());
  });

  it('keeps a card name with markup and emoji as stored', async () => {
    const s = await setting();
    const name = '<b>Zoë</b> "O\'Neil" 🔧';
    await prisma.mechanic.create({ data: { garageId: s.garage.id, name } });

    const res = await s.read();

    expect(res.body.mechanics.map((m: { name: string }) => m.name)).toContain(
      name,
    );
  });

  it('lists no card when every card is removed', async () => {
    const s = await setting();
    await prisma.mechanic.updateMany({
      data: { removedAt: new Date() },
      where: { garageId: s.garage.id },
    });

    const res = await s.read();

    expect(res.body).toEqual({ liftCount: 2, mechanics: [] });
  });

  it('answers liftCount 0 with the lifts on and lift_count 0', async () => {
    const s = await setting();
    await prisma.garage.update({
      data: { liftCount: 0 },
      where: { id: s.garage.id },
    });

    const res = await s.read();

    expect(res.body.liftCount).toBe(0);
  });

  it('answers the switch just turned back on at once', async () => {
    const s = await setting();
    const key = 'team_mechanics';
    const where = { garageId_key: { garageId: s.garage.id, key } };
    await prisma.garageFeature.upsert({
      create: { enabled: false, garageId: s.garage.id, key },
      update: { enabled: false },
      where,
    });
    const off = await s.read();
    await prisma.garageFeature.update({ data: { enabled: true }, where });
    const on = await s.read();

    expect(off.body.mechanics).toEqual([]);
    expect(on.body.mechanics).toHaveLength(2);
  });
});
