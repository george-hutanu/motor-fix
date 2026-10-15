import { countPlatformFigures, writeSnapshot } from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import type { RecipientStatus } from '../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const NOW = new Date('2026-11-20T10:00:00Z');
const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

let driverId: string;

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE platform_daily');
  driverId = await world.account('Andrei Ion Marin');
});

afterAll(() => prisma.$disconnect());

const row = (day: string) =>
  prisma.platformDaily.findUnique({
    where: { day_city: { city: 'all', day: new Date(day) } },
  });

// The row the night before wrote for the day, which its counts land on.
const writtenTheNightBefore = (day: string) =>
  prisma.platformDaily.create({
    data: {
      city: 'all',
      day: new Date(day),
      garagesApprovedThisMonth: 0,
      garagesListed: 0,
      writtenAt: new Date(`${day}T00:00:00Z`),
    },
  });

async function quotedAt(garageId: string, sentAt: Date) {
  const request = await world.request(driverId, { createdAt: sentAt });
  const quote = await world.quote(request.id, garageId);
  return prisma.quote.update({ data: { sentAt }, where: { id: quote.id } });
}

async function recipientAnswered(
  garageId: string,
  createdAt: Date,
  status: RecipientStatus,
  answeredAt: Date | null,
) {
  const request = await world.request(driverId, { createdAt });
  const { id } = await world.recipient(request.id, garageId, status);
  await prisma.requestRecipient.update({
    data: { answeredAt, createdAt },
    where: { id },
  });
}

// @traces 250-FR-007
describe('the night funnel on days that are not 24 hours long', () => {
  it('counts the whole 25-hour day when the clocks go back', async () => {
    await writtenTheNightBefore('2026-10-25');
    const { id } = await world.garage('Atelier Dinamo');
    await quotedAt(id, new Date('2026-10-24T21:00:00Z'));
    await quotedAt(id, new Date('2026-10-25T21:59:59Z'));
    await quotedAt(id, new Date('2026-10-24T20:59:59Z'));
    await quotedAt(id, new Date('2026-10-25T22:00:00Z'));

    await writeSnapshot(prisma, new Date('2026-10-25T23:00:00Z'));

    expect(await row('2026-10-25')).toMatchObject({ requestsQuoted: 2 });
  });

  it('counts the whole 23-hour day when the clocks go forward', async () => {
    await writtenTheNightBefore('2026-03-29');
    const { id } = await world.garage('Atelier Dinamo');
    await quotedAt(id, new Date('2026-03-28T22:00:00Z'));
    await quotedAt(id, new Date('2026-03-29T20:59:59Z'));
    await quotedAt(id, new Date('2026-03-29T21:00:00Z'));
    await quotedAt(id, new Date('2026-03-28T21:59:59Z'));

    await writeSnapshot(prisma, new Date('2026-03-29T22:00:00Z'));

    expect(await row('2026-03-29')).toMatchObject({ requestsQuoted: 2 });
  });
});

// @traces 250-FR-007
describe('the night funnel with nothing to count', () => {
  it('writes zeros, not a missing row, on an empty database', async () => {
    await writtenTheNightBefore('2026-11-09');
    await writeSnapshot(prisma, new Date('2026-11-09T23:00:00Z'));

    expect(await row('2026-11-09')).toMatchObject({
      bookingsConfirmed: 0,
      jobsDone: 0,
      requestsAccepted: 0,
      requestsQuoted: 0,
      reviewsPosted: 0,
    });
  });

  it('gives the same row when the job runs twice at the same moment', async () => {
    await writtenTheNightBefore('2026-11-09');
    const { id } = await world.garage('Atelier Dinamo');
    await quotedAt(id, new Date('2026-11-09T10:00:00Z'));
    const night = new Date('2026-11-09T23:00:00Z');

    await writeSnapshot(prisma, night);
    const first = await row('2026-11-09');
    await writeSnapshot(prisma, night);

    expect(await row('2026-11-09')).toEqual(first);
    expect(await prisma.platformDaily.count({ where: { city: 'all' } })).toBe(
      2,
    );
  });

  it('counts a booking confirmed on the day even when it was cancelled after', async () => {
    await writtenTheNightBefore('2026-11-09');
    const { id } = await world.garage('Atelier Dinamo');
    const quote = await quotedAt(id, new Date('2026-11-09T08:00:00Z'));
    const booking = await world.booking(quote.id, 'confirmed');
    await prisma.booking.update({
      data: {
        cancelledAt: new Date('2026-11-09T11:00:00Z'),
        cancelledBySide: 'driver',
        cancelReason: 'plans_changed',
        confirmedAt: new Date('2026-11-09T10:00:00Z'),
        status: 'cancelled',
      },
      where: { id: booking.id },
    });

    await writeSnapshot(prisma, new Date('2026-11-09T23:00:00Z'));

    expect(await row('2026-11-09')).toMatchObject({ bookingsConfirmed: 1 });
  });
});

// @traces 250-FR-008
describe('the answer rate at its edges', () => {
  it('counts an answer exactly 24 hours after arrival and leaves out one a millisecond later', async () => {
    const { id } = await world.garage('Atelier Dinamo');
    const at = hoursAgo(48);
    await recipientAnswered(
      id,
      at,
      'quoted',
      new Date(at.getTime() + 24 * HOUR),
    );
    await recipientAnswered(
      id,
      at,
      'quoted',
      new Date(at.getTime() + 24 * HOUR + 1),
    );

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      answerRate: 50,
    });
  });

  it('rounds one answered of three down to 33', async () => {
    const { id } = await world.garage('Atelier Dinamo');
    const at = hoursAgo(72);
    await recipientAnswered(id, at, 'quoted', new Date(at.getTime() + HOUR));
    await recipientAnswered(id, at, 'waiting', null);
    await recipientAnswered(id, at, 'waiting', null);

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      answerRate: 33,
    });
  });

  it('is 0 and not absent when recipients exist and none answered in time', async () => {
    const { id } = await world.garage('Atelier Dinamo');
    await recipientAnswered(id, hoursAgo(72), 'waiting', null);

    const figures = await countPlatformFigures(prisma, NOW);
    expect(figures.answerRate).toBe(0);
  });

  it('keeps a recipient from 29 days and 23 hours ago and drops one from 30 days and an hour ago', async () => {
    const { id } = await world.garage('Atelier Dinamo');
    await recipientAnswered(id, hoursAgo(29 * 24 + 23), 'waiting', null);
    await recipientAnswered(
      id,
      hoursAgo(30 * 24 + 1),
      'quoted',
      hoursAgo(30 * 24),
    );

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      answerRate: 0,
    });
  });
});

// @traces 250-FR-008
describe('the overview counts on an empty or odd database', () => {
  it('gives zero requests and bookings and no answer rate on an empty database', async () => {
    const figures = await countPlatformFigures(prisma, NOW);

    expect(figures).toMatchObject({ bookings: 0, requestsSent: 0 });
    expect(figures).not.toHaveProperty('answerRate');
  });

  it('counts a request nobody has received yet for the whole country', async () => {
    await world.request(driverId, { createdAt: hoursAgo(1) });

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      requestsSent: 1,
    });
  });

  it('gives zeros for a city that does not exist', async () => {
    const { id } = await world.garage('Atelier Dinamo');
    await recipientAnswered(id, hoursAgo(5), 'quoted', hoursAgo(4));

    const figures = await countPlatformFigures(prisma, NOW, {
      city: 'nowhere',
    });
    expect(figures).toMatchObject({ bookings: 0, requestsSent: 0 });
    expect(figures).not.toHaveProperty('answerRate');
  });

  it('counts a booking confirmed the instant the month began, and not one a millisecond before', async () => {
    const { id } = await world.garage('Atelier Dinamo');
    for (const confirmedAt of [
      new Date('2026-10-31T22:00:00Z'),
      new Date('2026-10-31T21:59:59.999Z'),
    ]) {
      const quote = await quotedAt(id, hoursAgo(500));
      const booking = await world.booking(quote.id, 'confirmed');
      await prisma.booking.update({
        data: { confirmedAt },
        where: { id: booking.id },
      });
    }

    await expect(countPlatformFigures(prisma, NOW)).resolves.toMatchObject({
      bookings: 1,
    });
  });
});
