import { writeSnapshot } from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, quotesWorld } from '../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

// Tuesday 10 November 2026, 01:00 in Bucharest: the night of Monday the 9th.
const NIGHT = new Date('2026-11-09T23:00:00Z');
const DAY = new Date('2026-11-09');
// Noon of the 9th, and 23:30 of the 8th, in Bucharest.
const ON_DAY = new Date('2026-11-09T10:00:00Z');
const DAY_BEFORE = new Date('2026-11-08T21:30:00Z');

let driverId: string;

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE platform_daily');
  driverId = await world.account('Andrei Ion Marin');
});

afterAll(() => prisma.$disconnect());

const row = (city = 'all', day = DAY) =>
  prisma.platformDaily.findUnique({ where: { day_city: { city, day } } });

async function quoted(garageId: string, sentAt: Date) {
  const request = await world.request(driverId, { createdAt: sentAt });
  return requote(request.id, garageId, sentAt);
}

async function requote(requestId: string, garageId: string, sentAt: Date) {
  const quote = await world.quote(requestId, garageId);
  return prisma.quote.update({ data: { sentAt }, where: { id: quote.id } });
}

const accepted = (quoteId: string, acceptedAt: Date) =>
  prisma.quote.update({
    data: { acceptedAt, status: 'accepted' },
    where: { id: quoteId },
  });

async function confirmed(quoteId: string, confirmedAt: Date) {
  const booking = await world.booking(quoteId, 'confirmed');
  return prisma.booking.update({
    data: { confirmedAt },
    where: { id: booking.id },
  });
}

async function done(bookingId: string, finishedAt: Date) {
  const job = await world.job(bookingId);
  return prisma.job.update({
    data: { finishedAt, startedAt: finishedAt, status: 'done' },
    where: { id: job.id },
  });
}

const funnel = {
  bookingsConfirmed: true,
  jobsDone: true,
  requestsAccepted: true,
  requestsQuoted: true,
  reviewsPosted: true,
} as const;

// @traces 250-FR-007
describe("the night's funnel counts", () => {
  it("writes the day's requests quoted and accepted, bookings confirmed and jobs done on its whole-country row", async () => {
    const a = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 2; i++) await world.request(driverId);
    const first = await quoted(a.id, ON_DAY);
    const second = await quoted(a.id, ON_DAY);
    await quoted(a.id, ON_DAY);
    await accepted(first.id, ON_DAY);
    await accepted(second.id, ON_DAY);
    const booking = await confirmed(first.id, ON_DAY);
    await confirmed(second.id, ON_DAY);
    await done(booking.id, ON_DAY);

    await writeSnapshot(prisma, NIGHT);

    await expect(
      prisma.platformDaily.findUnique({
        select: funnel,
        where: { day_city: { city: 'all', day: DAY } },
      }),
    ).resolves.toEqual({
      bookingsConfirmed: 2,
      jobsDone: 1,
      requestsAccepted: 2,
      requestsQuoted: 3,
      reviewsPosted: 0,
    });
  });

  it('counts a request quoted by three garages once', async () => {
    const garages = await Promise.all(
      ['Atelier Dinamo', 'Service Titan', 'Auto Pipera'].map(world.garage),
    );
    const first = await quoted(garages[0].id, ON_DAY);
    for (const g of garages.slice(1)) {
      await requote(first.requestId, g.id, ON_DAY);
    }

    await writeSnapshot(prisma, NIGHT);

    expect(await row()).toMatchObject({ requestsQuoted: 1 });
  });

  it('leaves out what happened at 23:30 of the day before, and a request first quoted then', async () => {
    const [a, b] = await Promise.all(
      ['Atelier Dinamo', 'Service Titan'].map(world.garage),
    );
    const early = await quoted(a.id, DAY_BEFORE);
    await requote(early.requestId, b.id, ON_DAY);
    await accepted(early.id, DAY_BEFORE);
    const booking = await confirmed(early.id, DAY_BEFORE);
    await done(booking.id, DAY_BEFORE);

    await writeSnapshot(prisma, NIGHT);

    expect(await row()).toMatchObject({
      bookingsConfirmed: 0,
      jobsDone: 0,
      requestsAccepted: 0,
      requestsQuoted: 0,
    });
  });

  it('replaces the counts on a rerun instead of adding to them', async () => {
    const a = await world.garage('Atelier Dinamo');
    const first = await quoted(a.id, ON_DAY);

    await writeSnapshot(prisma, NIGHT);
    await confirmed(first.id, ON_DAY);
    const rerun = new Date(NIGHT.getTime() + 3_600_000);
    await writeSnapshot(prisma, rerun);

    expect(await row()).toMatchObject({
      bookingsConfirmed: 1,
      requestsQuoted: 1,
      writtenAt: rerun,
    });
  });

  it('creates a missing row from the live garage figures, without the active drivers', async () => {
    await world.garage('Atelier Dinamo');
    await world.garage('Service Titan');

    await writeSnapshot(prisma, NIGHT);

    expect(await row()).toMatchObject({
      activeDrivers: null,
      garagesApprovedThisMonth: 0,
      garagesListed: 2,
      writtenAt: NIGHT,
    });
  });

  it('keeps the other figures of a row the night before wrote', async () => {
    await prisma.platformDaily.create({
      data: {
        activeDrivers: 40,
        city: 'all',
        day: DAY,
        garagesApprovedThisMonth: 3,
        garagesListed: 7,
        writtenAt: new Date('2026-11-08T23:00:00Z'),
      },
    });

    await writeSnapshot(prisma, NIGHT);

    expect(await row()).toMatchObject({
      activeDrivers: 40,
      garagesApprovedThisMonth: 3,
      garagesListed: 7,
      requestsQuoted: 0,
      writtenAt: NIGHT,
    });
  });

  it('holds no funnel counts on a city row', async () => {
    const a = await world.garage('Atelier Dinamo');
    await prisma.garage.update({
      data: { cityKey: 'cluj-napoca', cityName: 'Cluj-Napoca' },
      where: { id: a.id },
    });
    await quoted(a.id, ON_DAY);

    await writeSnapshot(prisma, NIGHT);

    const cities = await prisma.platformDaily.findMany({
      select: funnel,
      where: { city: { not: 'all' } },
    });
    expect(cities).not.toHaveLength(0);
    for (const city of cities) {
      expect(Object.values(city).every((count) => count === null)).toBe(true);
    }
    expect(
      await prisma.platformDaily.findUnique({
        select: funnel,
        where: { day_city: { city: 'all', day: new Date('2026-11-10') } },
      }),
    ).toEqual({
      bookingsConfirmed: null,
      jobsDone: null,
      requestsAccepted: null,
      requestsQuoted: null,
      reviewsPosted: null,
    });
  });
});
