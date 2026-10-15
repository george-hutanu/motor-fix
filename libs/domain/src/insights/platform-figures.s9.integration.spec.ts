import { countPlatformFigures } from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import type { RecipientStatus } from '../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

// Friday 20 November 2026, 12:00 in Bucharest.
const NOW = new Date('2026-11-20T10:00:00Z');
const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const CLUJ = { cityKey: 'cluj-napoca', cityName: 'Cluj-Napoca' };

let driverId: string;

beforeEach(async () => {
  await world.reset();
  driverId = await world.account('Andrei Ion Marin');
});

afterAll(() => prisma.$disconnect());

async function garage(
  status: 'draft' | 'approved' | 'suspended' = 'approved',
  city?: typeof CLUJ,
) {
  const { id } = await world.garage('Atelier Dinamo');
  return prisma.garage.update({ data: { status, ...city }, where: { id } });
}

async function sent(createdAt: Date, garageIds: string[]) {
  const request = await world.request(driverId, { createdAt });
  for (const id of garageIds) await world.recipient(request.id, id);
  return request;
}

// A request reaching the garage at `at`, left in `status`, answered
// `answeredAfter` hours later when given.
async function arrived(
  garageId: string,
  at: Date,
  status: RecipientStatus = 'waiting',
  answeredAfter?: number,
) {
  const request = await world.request(driverId, {
    createdAt: at,
    status: status === 'closed' ? 'closed' : 'sent',
  });
  const { id } = await world.recipient(request.id, garageId, status);
  await prisma.requestRecipient.update({
    data: {
      answeredAt:
        answeredAfter === undefined
          ? null
          : new Date(at.getTime() + answeredAfter * HOUR),
      createdAt: at,
    },
    where: { id },
  });
}

async function confirmedAt(garageId: string, at: Date | null) {
  const { booking } = await world.chain(driverId, garageId, {
    booking: at ? 'confirmed' : 'awaiting_confirmation',
  });
  await prisma.booking.update({
    data: { confirmedAt: at },
    where: { id: booking.id },
  });
}

// @traces 250-FR-008
describe('the launch figures of the overview', () => {
  it('lists approved garages only, leaving drafts and suspended ones out', async () => {
    await garage();
    await garage();
    await garage('draft');
    await garage('suspended');

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      garagesListed: 2,
    });
  });

  it('counts the requests sent this month by default, a request to three garages once', async () => {
    const garages = await Promise.all([garage(), garage(), garage()]);
    const ids = garages.map(({ id }) => id);
    await sent(new Date('2026-11-01T08:00:00Z'), ids);
    await sent(hoursAgo(2), ids.slice(0, 1));
    await sent(new Date('2026-10-31T21:30:00Z'), ids);

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      requestsSent: 2,
    });
  });

  it('counts the requests sent in the chosen period', async () => {
    const { id } = await garage();
    await sent(hoursAgo(24), [id]);
    await sent(new Date('2026-11-13T22:30:00Z'), [id]);
    await sent(new Date('2026-11-13T21:30:00Z'), [id]);
    await sent(new Date('2026-10-22T08:00:00Z'), [id]);
    await sent(new Date('2026-10-21T08:00:00Z'), [id]);

    await expect(
      countPlatformFigures(prisma, NOW, { period: '7d' }),
    ).resolves.toMatchObject({ requestsSent: 2 });
    await expect(
      countPlatformFigures(prisma, NOW, { period: '30d' }),
    ).resolves.toMatchObject({ requestsSent: 4 });
  });

  it('counts in a city the requests with at least one recipient garage there', async () => {
    const cluj = await garage('approved', CLUJ);
    const elsewhere = await garage();
    await sent(hoursAgo(2), [elsewhere.id, cluj.id]);
    await sent(hoursAgo(3), [elsewhere.id]);

    await expect(
      countPlatformFigures(prisma, NOW, { city: CLUJ.cityKey }),
    ).resolves.toMatchObject({ requestsSent: 1 });
  });

  it('gives the share of recipients of the last 30 days answered within a day, rounded down', async () => {
    const { id } = await garage();
    await arrived(id, hoursAgo(72), 'quoted', 2);
    await arrived(id, hoursAgo(96), 'declined', 3);
    await arrived(id, hoursAgo(20 * 24));
    await arrived(id, hoursAgo(5));
    await arrived(id, hoursAgo(48), 'closed');
    await arrived(id, hoursAgo(31 * 24), 'quoted', 1);

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      answerRate: 66,
    });
  });

  it('keeps the answer rate on the last 30 days whatever the period', async () => {
    const { id } = await garage();
    await arrived(id, hoursAgo(20 * 24), 'quoted', 2);
    await arrived(id, hoursAgo(25 * 24), 'quoted', 30);

    for (const period of ['today', '7d', '30d', 'default'] as const) {
      await expect(
        countPlatformFigures(prisma, NOW, { period }),
      ).resolves.toMatchObject({ answerRate: 50 });
    }
  });

  it('has no answer rate when no recipient counted', async () => {
    const { id } = await garage();
    await arrived(id, hoursAgo(5));

    const figures = await countPlatformFigures(prisma, NOW);
    expect(figures).not.toHaveProperty('answerRate');
  });

  it("gives a city's answer rate from its garages' recipients only", async () => {
    const cluj = await garage('approved', CLUJ);
    const elsewhere = await garage();
    await arrived(cluj.id, hoursAgo(48), 'quoted', 2);
    await arrived(elsewhere.id, hoursAgo(48));

    await expect(
      countPlatformFigures(prisma, NOW, { city: CLUJ.cityKey }),
    ).resolves.toMatchObject({ answerRate: 100 });
    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      answerRate: 50,
    });
  });

  it('counts the bookings confirmed in the period, none waiting for confirmation', async () => {
    const { id } = await garage();
    await confirmedAt(id, hoursAgo(2));
    await confirmedAt(id, new Date('2026-11-01T08:00:00Z'));
    await confirmedAt(id, new Date('2026-10-31T21:30:00Z'));
    await confirmedAt(id, null);

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      bookings: 2,
    });
    await expect(
      countPlatformFigures(prisma, NOW, { period: '7d' }),
    ).resolves.toMatchObject({ bookings: 1 });
  });

  it("counts a city's bookings by the booking's garage", async () => {
    const cluj = await garage('approved', CLUJ);
    const elsewhere = await garage();
    await confirmedAt(cluj.id, hoursAgo(2));
    await confirmedAt(elsewhere.id, hoursAgo(2));

    await expect(
      countPlatformFigures(prisma, NOW, { city: CLUJ.cityKey }),
    ).resolves.toMatchObject({ bookings: 1 });
  });
});
