import { countPlatformFigures, writeSnapshot } from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, quotesWorld } from '../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const NOW = new Date('2026-11-20T10:00:00Z');
const HOUR = 3_600_000;
const DAY = new Date('2026-11-09');
const ON_DAY = new Date('2026-11-09T10:00:00Z');
const NIGHT = new Date('2026-11-09T23:00:00Z');

let driverId: string;

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE platform_daily');
  driverId = await world.account('Andrei Ion Marin');
  // The row the night before wrote for the day, which its counts land on.
  await prisma.platformDaily.create({
    data: {
      city: 'all',
      day: DAY,
      garagesApprovedThisMonth: 0,
      garagesListed: 0,
      writtenAt: new Date('2026-11-08T23:00:00Z'),
    },
  });
});

afterAll(() => prisma.$disconnect());

const row = () =>
  prisma.platformDaily.findUnique({
    where: { day_city: { city: 'all', day: DAY } },
  });

async function quoteFrom(requestId: string, garageId: string, sentAt: Date) {
  const quote = await world.quote(requestId, garageId);
  return prisma.quote.update({ data: { sentAt }, where: { id: quote.id } });
}

// @traces 250-FR-007
describe('the night funnel for a request sent to several garages', () => {
  it('counts a request once when three garages quoted it on the day', async () => {
    const request = await world.request(driverId, { createdAt: ON_DAY });
    for (const name of ['Atelier A', 'Atelier B', 'Atelier C']) {
      const { id } = await world.garage(name);
      await quoteFrom(request.id, id, ON_DAY);
    }

    await writeSnapshot(prisma, NIGHT);

    expect(await row()).toMatchObject({ requestsQuoted: 1 });
  });

  it('counts a request on the day of its first quote only, not on the day of a later one', async () => {
    const request = await world.request(driverId, {
      createdAt: new Date('2026-11-08T10:00:00Z'),
    });
    const a = await world.garage('Atelier A');
    const b = await world.garage('Atelier B');
    await quoteFrom(request.id, a.id, new Date('2026-11-08T10:00:00Z'));
    await quoteFrom(request.id, b.id, ON_DAY);

    await writeSnapshot(prisma, NIGHT);

    expect(await row()).toMatchObject({ requestsQuoted: 0 });
  });

  it('counts a request once when it was accepted on the day', async () => {
    const request = await world.request(driverId, { createdAt: ON_DAY });
    for (const name of ['Atelier A', 'Atelier B']) {
      const { id } = await world.garage(name);
      await quoteFrom(request.id, id, ON_DAY);
    }
    const winner = await prisma.quote.findFirstOrThrow({});
    await prisma.quote.update({
      data: { acceptedAt: ON_DAY, status: 'accepted' },
      where: { id: winner.id },
    });

    await writeSnapshot(prisma, NIGHT);

    expect(await row()).toMatchObject({
      requestsAccepted: 1,
      requestsQuoted: 1,
    });
  });
});

// @traces 250-FR-007
describe('the night funnel when the job runs again', () => {
  it('replaces the day counts instead of adding to them', async () => {
    const { id } = await world.garage('Atelier A');
    const first = await world.request(driverId, { createdAt: ON_DAY });
    await quoteFrom(first.id, id, ON_DAY);
    await writeSnapshot(prisma, NIGHT);
    const second = await world.request(driverId, { createdAt: ON_DAY });
    await quoteFrom(second.id, id, ON_DAY);

    await writeSnapshot(prisma, NIGHT);

    expect(await row()).toMatchObject({ requestsQuoted: 2 });
  });

  it('lowers a stale count back to zero when the day no longer holds the data', async () => {
    const { id } = await world.garage('Atelier A');
    const request = await world.request(driverId, { createdAt: ON_DAY });
    await quoteFrom(request.id, id, ON_DAY);
    await writeSnapshot(prisma, NIGHT);
    await prisma.quote.deleteMany({});

    await writeSnapshot(prisma, NIGHT);

    expect(await row()).toMatchObject({ requestsQuoted: 0 });
  });
});

// @traces 250-FR-008
describe('the overview figures for a request sent to several garages', () => {
  it('counts one request sent to three garages once for the country and once for a city', async () => {
    const request = await world.request(driverId, {
      createdAt: new Date(NOW.getTime() - HOUR),
    });
    for (const name of ['Atelier A', 'Atelier B', 'Atelier C']) {
      const { id } = await world.garage(name);
      await prisma.garage.update({
        data: { cityKey: 'cluj', cityName: 'Cluj' },
        where: { id },
      });
      await world.recipient(request.id, id);
    }

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      requestsSent: 1,
    });
    await expect(
      countPlatformFigures(prisma, NOW, { city: 'cluj' }),
    ).resolves.toMatchObject({ requestsSent: 1 });
  });

  it('leaves a request out of a city where none of its garages is', async () => {
    const request = await world.request(driverId, {
      createdAt: new Date(NOW.getTime() - HOUR),
    });
    const { id } = await world.garage('Atelier A');
    await prisma.garage.update({
      data: { cityKey: 'cluj', cityName: 'Cluj' },
      where: { id },
    });
    await world.recipient(request.id, id);

    await expect(
      countPlatformFigures(prisma, NOW, { city: 'iasi' }),
    ).resolves.toMatchObject({ requestsSent: 0 });
  });

  it('does not count a suspended garage as live', async () => {
    await world.garage('Atelier A');
    const { id } = await world.garage('Atelier B');
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id },
    });

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      garagesListed: 1,
    });
  });

  it('gives no answer rate when the only recipient is 31 days old', async () => {
    const { id } = await world.garage('Atelier A');
    const createdAt = new Date(NOW.getTime() - 31 * 24 * HOUR);
    const request = await world.request(driverId, { createdAt });
    const recipient = await world.recipient(request.id, id, 'quoted');
    await prisma.requestRecipient.update({
      data: { answeredAt: new Date(createdAt.getTime() + HOUR), createdAt },
      where: { id: recipient.id },
    });

    const figures = await countPlatformFigures(prisma, NOW);

    expect(figures).not.toHaveProperty('answerRate');
  });
});
