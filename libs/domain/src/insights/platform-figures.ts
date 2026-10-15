import { CITY_ALL, type Period } from '@motor-fix/contracts';

import { monthsBack, periodRange } from './periods';
import { addDays, atLocal, localDay, monthStart } from '../bucharest';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

const ACTIVE_WINDOW = 30 * 86_400_000;
const ANSWER_PERIOD_DAYS = 30;
const ANSWER_WINDOW_HOURS = 24;

// A garage with no known city counts for the whole country only.
const inCity = (city: string): Prisma.GarageWhereInput =>
  city === CITY_ALL ? {} : { cityKey: city };

export async function countPlatformFigures(
  db: PrismaClient,
  now: Date,
  {
    city = CITY_ALL,
    period = 'default',
  }: { city?: string; period?: Period } = {},
) {
  const where = inCity(city);
  const since = atLocal(monthStart(localDay(now)), 0);
  const range = periodRange(period, now);
  const from = range?.since ?? since;
  const [
    garagesListed,
    garagesApprovedThisMonth,
    garagesApprovedInPeriod,
    activeDrivers,
    requestsSent,
    bookings,
    answerRate,
  ] = await Promise.all([
    db.garage.count({ where: { status: 'approved', ...where } }),
    firstApprovedSince(db, since, where),
    range && firstApprovedSince(db, range.since, where),
    // A driver belongs to a city by the quote requests they send there, and
    // there are none yet.
    city === CITY_ALL
      ? db.account.count({
          where: {
            lastActiveAt: { gte: new Date(now.getTime() - ACTIVE_WINDOW) },
            roles: { some: { role: 'driver' } },
            status: 'active',
          },
        })
      : 0,
    db.quoteRequest.count({
      where: {
        createdAt: { gte: from },
        ...(city !== CITY_ALL && { recipients: { some: { garage: where } } }),
      },
    }),
    db.booking.count({ where: { confirmedAt: { gte: from }, garage: where } }),
    platformAnswerRate(db, now, city),
  ]);
  return {
    activeDrivers,
    garagesApprovedThisMonth,
    garagesListed,
    ...(garagesApprovedInPeriod !== null && { garagesApprovedInPeriod }),
    ...(answerRate !== null && { answerRate }),
    bookings,
    requestsSent,
  };
}

// The rule of each garage's response figures, over every garage's
// recipients: a closed one never counts, nor one still waiting under a day.
async function platformAnswerRate(db: PrismaClient, now: Date, city: string) {
  const since = new Date(now.getTime() - ANSWER_PERIOD_DAYS * 86_400_000);
  const settled = new Date(now.getTime() - ANSWER_WINDOW_HOURS * 3_600_000);
  const window = `${ANSWER_WINDOW_HOURS} hours`;
  const [{ counted, answered }] = await db.$queryRaw<
    { counted: number; answered: number }[]
  >`
    SELECT count(*)::int AS counted,
      count(*) FILTER (
        WHERE r.status IN ('quoted', 'declined')
          AND r.answered_at <= r.created_at + ${window}::interval
      )::int AS answered
    FROM request_recipient r
    JOIN garage g ON g.id = r.garage_id
    WHERE r.status <> 'closed' AND r.created_at > ${since}
      AND NOT (r.status = 'waiting' AND r.created_at > ${settled})
      AND (${city} = ${CITY_ALL} OR g.city_key = ${city})`;
  return counted === 0 ? null : Math.floor((answered * 100) / counted);
}

// `approvedAt` moves when a reopened file is approved again, so a garage
// whose audit history shows it published before `since` is left out.
async function firstApprovedSince(
  db: PrismaClient,
  since: Date,
  where: Prisma.GarageWhereInput,
) {
  const garages = await db.garage.findMany({
    select: { id: true },
    where: { approvedAt: { gte: since }, status: 'approved', ...where },
  });
  if (garages.length === 0) return 0;
  const earlier = await db.activityLog.findMany({
    distinct: ['garageId'],
    select: { garageId: true },
    where: {
      at: { lt: since },
      field: 'status',
      garageId: { in: garages.map(({ id }) => id) },
      newValue: { equals: 'approved' },
      subjectType: 'garage',
    },
  });
  return garages.length - earlier.length;
}

// The whole country first, then each city with a listed garage, most first.
export async function cities(db: PrismaClient) {
  const [listed, groups] = await Promise.all([
    db.garage.count({ where: { status: 'approved' } }),
    db.garage.groupBy({
      _count: { _all: true },
      _max: { cityName: true },
      by: ['cityKey'],
      where: { cityKey: { not: null }, status: 'approved' },
    }),
  ]);
  const found = groups
    .map(({ _count, _max, cityKey }) => ({
      garages: _count._all,
      key: cityKey as string,
      name: _max.cityName as string,
    }))
    .sort((a, b) => b.garages - a.garages || a.name.localeCompare(b.name));
  return [{ garages: listed, key: CITY_ALL, name: 'România' }, ...found];
}

// The whole country's active drivers on that day's row, when it was written.
export async function snapshotActiveDrivers(db: PrismaClient, day: string) {
  const row = await db.platformDaily.findUnique({
    select: { activeDrivers: true },
    where: { day_city: { city: CITY_ALL, day: new Date(day) } },
  });
  return row?.activeDrivers ?? undefined;
}

export const monthStartSnapshot = (db: PrismaClient, now: Date) =>
  snapshotActiveDrivers(db, monthStart(localDay(now)));

// Each count dates a row by its own moment on the Bucharest day; a request
// quoted or accepted by several garages counts once, on its earliest quote.
export async function countFunnel(db: PrismaClient, day: string) {
  const since = atLocal(day, 0);
  const until = atLocal(addDays(day, 1), 0);
  const [[requests], bookingsConfirmed, jobsDone] = await Promise.all([
    db.$queryRaw<{ requestsQuoted: number; requestsAccepted: number }[]>`
      SELECT
        count(*) FILTER (WHERE first_sent >= ${since} AND first_sent < ${until})::int AS "requestsQuoted",
        count(*) FILTER (WHERE accepted)::int AS "requestsAccepted"
      FROM (
        SELECT min(sent_at) AS first_sent,
          bool_or(accepted_at >= ${since} AND accepted_at < ${until}) AS accepted
        FROM quote
        GROUP BY request_id
      ) q`,
    db.booking.count({ where: { confirmedAt: { gte: since, lt: until } } }),
    db.job.count({ where: { finishedAt: { gte: since, lt: until } } }),
  ]);
  return { ...requests, bookingsConfirmed, jobsDone, reviewsPosted: 0 };
}

export async function writeSnapshot(db: PrismaClient, now: Date) {
  const today = localDay(now);
  const day = new Date(today);
  let live = { garagesApprovedThisMonth: 0, garagesListed: 0 };
  for (const { key: city } of await cities(db)) {
    const { activeDrivers, garagesApprovedThisMonth, garagesListed } =
      await countPlatformFigures(db, now, { city });
    if (city === CITY_ALL) live = { garagesApprovedThisMonth, garagesListed };
    const figures = {
      activeDrivers: city === CITY_ALL ? activeDrivers : null,
      garagesApprovedThisMonth,
      garagesListed,
      writtenAt: now,
    };
    await db.platformDaily.upsert({
      create: { city, day, ...figures },
      update: figures,
      where: { day_city: { city, day } },
    });
  }
  const yesterday = addDays(today, -1);
  const funnel = await countFunnel(db, yesterday);
  const counts = { ...funnel, writtenAt: now };
  await db.platformDaily.upsert({
    create: { city: CITY_ALL, day: new Date(yesterday), ...live, ...counts },
    update: counts,
    where: { day_city: { city: CITY_ALL, day: new Date(yesterday) } },
  });
  return { day: yesterday, ...funnel };
}

type Figures = { activeDrivers: number | null; garagesListed: number };

// A month closes on the next month's first-day row, written at 01:00 from the
// figures as the month ended; its own last day stands in when that night was
// missed, and with neither the month has no figures rather than zero. A
// city's rows hold no active drivers, so its months show none.
export async function readGrowth(
  db: PrismaClient,
  now: Date,
  city: string = CITY_ALL,
) {
  const current = monthStart(localDay(now));
  const starts = [...Array(12).keys()].map((i) => monthsBack(current, 11 - i));
  const closing = starts.slice(1);
  const [rows, live] = await Promise.all([
    db.platformDaily.findMany({
      select: { activeDrivers: true, day: true, garagesListed: true },
      where: {
        city,
        day: {
          in: closing
            .flatMap((first) => [first, addDays(first, -1)])
            .map((day) => new Date(day)),
        },
      },
    }),
    countPlatformFigures(db, now, { city }),
  ]);
  const byDay = new Map<string, Figures>(
    rows.map(({ day, ...figures }) => [
      day.toISOString().slice(0, 10),
      figures,
    ]),
  );
  const whole = city === CITY_ALL;
  return {
    months: starts.map((start, i) => {
      const figures: Figures | undefined =
        i === 11
          ? live
          : (byDay.get(closing[i]) ?? byDay.get(addDays(closing[i], -1)));
      return {
        month: start.slice(0, 7),
        ...(figures && {
          ...(whole &&
            figures.activeDrivers !== null && {
              activeDrivers: figures.activeDrivers,
            }),
          garagesListed: figures.garagesListed,
        }),
      };
    }),
  };
}
