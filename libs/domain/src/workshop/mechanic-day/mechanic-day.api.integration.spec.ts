import { addDays, localDay } from '../../bucharest';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const day = (auth: string, query = '') => get(`/me/day${query}`, auth);

// What a read must leave as it found: no audit entry, event or stage entry.
const writes = async () => [
  await prisma.activityLog.count(),
  await prisma.outboxEvent.count(),
  await prisma.jobStageEntry.count(),
];

// @traces 122-FR-005 122-FR-006
describe('GET /me/day', () => {
  it('answers the signed-in mechanic’s day, today in Bucharest by default', async () => {
    const t = await team('Atelier Dinamo');
    const today = localDay(new Date());
    const booking = await world.booked(
      t.garage.id,
      `${today}T09:00:00Z`,
      'confirmed',
      { mechanicId: t.plainMechanic.id },
    );
    await world.job(booking.id, 'to_do');
    const before = await writes();

    const res = await day(bearer(t.plain, 'mechanic'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: today,
      inWork: 0,
      jobs: 1,
      rows: [expect.objectContaining({ bookingId: booking.id })],
    });
    expect(await writes()).toEqual(before);
  });

  it.each([
    ['owner', 'owner', 'garage'],
    ['receptionist', 'receptionist', 'receptionist'],
    ['driver', 'driver', 'driver'],
    ['admin', 'admin', 'admin'],
  ] as const)('answers not found to the %s', async (_, who, role) => {
    const t = await team('Atelier Dinamo');
    const ids = {
      admin: await world.account('Ana Admin', ['admin']),
      driver: await world.account('Andrei Marin', ['driver']),
      owner: t.owner,
      receptionist: t.receptionist,
    };

    const res = await day(bearer(ids[who], role));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'not_found' });
  });

  it('answers not found while the garage works without a team', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: t.garage.id, key: 'team_mechanics' },
    });

    const res = await day(bearer(t.plain, 'mechanic'));

    expect(res.status).toBe(404);
  });

  it('answers not found to a mechanic whose card is removed or missing', async () => {
    const t = await team('Atelier Dinamo');
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: t.plainMechanic.id },
    });
    const cardless = await world.account('Vasile Fără Card', ['mechanic']);

    const removed = await day(bearer(t.plain, 'mechanic'));
    const missing = await day(bearer(cardless, 'mechanic'));

    expect(removed.status).toBe(404);
    expect(missing.status).toBe(404);
  });

  it.each(['2027-13-01', '2027-02-30', '06.12.2027', 'today', '2027-12-6'])(
    'refuses the malformed date %s',
    async (date) => {
      const t = await team('Atelier Dinamo');

      const res = await day(bearer(t.plain, 'mechanic'), `?date=${date}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'validation_failed',
        errors: [expect.objectContaining({ field: 'date' })],
      });
    },
  );

  it('reads up to thirty days either way and refuses one more', async () => {
    const t = await team('Atelier Dinamo');
    const today = localDay(new Date());
    const auth = bearer(t.plain, 'mechanic');

    const answers = await Promise.all(
      [-31, -30, 30, 31].map((n) => day(auth, `?date=${addDays(today, n)}`)),
    );

    expect(answers.map((res) => res.status)).toEqual([422, 200, 200, 422]);
    expect(answers[3].body).toMatchObject({
      errors: [expect.objectContaining({ field: 'date' })],
    });
  });

  it('asks for a session', async () => {
    const res = await get('/me/day');

    expect(res.status).toBe(401);
  });
});
