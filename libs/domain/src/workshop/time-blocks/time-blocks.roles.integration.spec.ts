import { todayInBucharest } from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';

import { addDays, atLocal } from '../../bucharest';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, post, send, team, world } = quotesApp();
const { prisma } = world;

const DAY = addDays(todayInBucharest(), 7);
const at = (hour: number) => atLocal(DAY, hour).toISOString();
const body = { endsAt: at(11), lift: 1, startsAt: at(10) };

// Atelier Dinamo with one block, a second garage, a driver and an admin.
async function setting() {
  const t = await team('Atelier Dinamo');
  await prisma.garage.update({
    data: { liftCount: 2 },
    where: { id: t.garage.id },
  });
  const other = await team('Service Militari');
  const driver = await world.account('Andrei Marin', ['driver']);
  const admin = await world.account('Ana Admin', ['admin']);
  await prisma.mechanic.update({
    data: { canMoveBookings: true },
    where: { id: t.plainMechanic.id },
  });
  const path = `/garages/${t.garage.id}/time-blocks`;
  const created = await send('post', path, bearer(t.owner, 'garage'), body);
  return { admin, block: created.body.id as string, driver, other, path, t };
}
type Setting = Awaited<ReturnType<typeof setting>>;

const ROUTES = ['list', 'create', 'change', 'remove'] as const;
type Route = (typeof ROUTES)[number];

function call(s: Setting, route: Route, auth: string, path = s.path) {
  const one = `${path}/${s.block}`;
  const later = { ...body, endsAt: at(13), startsAt: at(12) };
  if (route === 'list') return get(`${path}?from=${DAY}`, auth);
  if (route === 'create') return send('post', path, auth, later);
  if (route === 'change') return send('patch', one, auth, { note: 'x' });
  return send('delete', one, auth);
}

// @traces 427-FR-003
describe('who may block time', () => {
  it.each(ROUTES)('lets the owner and a receptionist %s', async (route) => {
    const s = await setting();
    const desk = bearer(s.t.receptionist, 'receptionist');

    const res = await call(s, route, desk);

    expect(res.status).toBeLessThan(300);
  });

  it.each(ROUTES)(
    'refuses a mechanic who may move bookings to %s, 403',
    async (route) => {
      const s = await setting();

      const res = await call(s, route, bearer(s.t.plain, 'mechanic'));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    },
  );

  it.each(
    ROUTES.flatMap((route) =>
      (['other owner', 'driver', 'admin', 'unknown garage'] as const).map(
        (who) => [route, who] as const,
      ),
    ),
  )('answers %s by the %s with 404', async (route, who) => {
    const s = await setting();
    const actors: Record<string, [string, Role]> = {
      admin: [s.admin, 'admin'],
      driver: [s.driver, 'driver'],
      'other owner': [s.other.owner, 'garage'],
      'unknown garage': [s.t.owner, 'garage'],
    };
    const [id, role] = actors[who];
    const path =
      who === 'unknown garage'
        ? '/garages/00000000-0000-4000-8000-000000000000/time-blocks'
        : s.path;

    const res = await call(s, route, bearer(id, role), path);

    expect(res.status).toBe(404);
    expect(await prisma.timeBlock.count()).toBe(1);
  });

  it('asks a visitor to sign in', async () => {
    const s = await setting();

    for (const res of [
      await get(`${s.path}?from=${DAY}`),
      await post(s.path, body),
    ]) {
      expect(res.status).toBe(401);
    }
  });
});

// @traces 427-FR-009
// @traces 427-FR-014
describe("a block in the garage's history only", () => {
  it("leaves a block out of a driver's history and shows it to the owner", async () => {
    const s = await setting();
    await world.chain(s.driver, s.t.garage.id);

    const driver = await get('/audit-history', bearer(s.driver, 'driver'));
    const owner = await get(
      `/audit-history?garageId=${s.t.garage.id}`,
      bearer(s.t.owner, 'garage'),
    );

    expect(JSON.stringify(driver.body)).not.toContain('time_block');
    expect(owner.status).toBe(200);
    expect(JSON.stringify(owner.body)).toContain('time_block');
  });
});
