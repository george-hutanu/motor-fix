import type { ResponseRateDto } from '@motor-fix/contracts';

import { outbox } from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';

export const RESPONSE_RATE_PERIOD_DAYS = 30;
export const RESPONSE_RATE_WINDOW_HOURS = 24;
export const RESPONSE_RATE_MIN_REQUESTS = 10;

const HOUR = 3_600_000;

interface ResponseFigures {
  requests30d: number;
  answeredWithinDay30d: number;
  lifetimeRequests: number;
  rate: number | null;
}

// A closed recipient (the driver cancelled, or a suspension closed it) was
// never the garage's to answer, and one still waiting under a day may yet be
// answered in time: neither counts. Every request ever sent counts toward
// the lifetime figure.
async function countResponseStats(db: PrismaClient, now: Date) {
  const since = new Date(now.getTime() - RESPONSE_RATE_PERIOD_DAYS * 24 * HOUR);
  const settled = new Date(now.getTime() - RESPONSE_RATE_WINDOW_HOURS * HOUR);
  const window = `${RESPONSE_RATE_WINDOW_HOURS} hours`;
  const rows = await db.$queryRaw<
    (Omit<ResponseFigures, 'rate'> & { garageId: string })[]
  >`
    SELECT g.id AS "garageId",
      count(r.id) FILTER (WHERE counted)::int AS "requests30d",
      count(r.id) FILTER (
        WHERE counted AND r.answered_at <= r.created_at + ${window}::interval
      )::int AS "answeredWithinDay30d",
      count(r.id)::int AS "lifetimeRequests"
    FROM garage g
    LEFT JOIN LATERAL (
      SELECT r.*, r.status <> 'closed' AND r.created_at > ${since}
        AND (r.answered_at IS NOT NULL OR r.created_at <= ${settled}) AS counted
      FROM request_recipient r
      WHERE r.garage_id = g.id
    ) r ON true
    WHERE g.status = 'approved'
    GROUP BY g.id`;
  return rows.map((row) => ({
    ...row,
    rate:
      row.requests30d === 0
        ? null
        : Math.floor((row.answeredWithinDay30d * 100) / row.requests30d),
  }));
}

export function responseRateOf(
  row: Pick<ResponseFigures, 'lifetimeRequests' | 'rate'> | null,
): ResponseRateDto {
  if (!row || row.lifetimeRequests < RESPONSE_RATE_MIN_REQUESTS) {
    return { state: 'new' };
  }
  return row.rate === null
    ? { state: 'none' }
    : { rate: row.rate, state: 'rate' };
}

const same = (a: ResponseFigures, b: ResponseFigures) =>
  a.requests30d === b.requests30d &&
  a.answeredWithinDay30d === b.answeredWithinDay30d &&
  a.lifetimeRequests === b.lifetimeRequests &&
  a.rate === b.rate;

// One transaction per garage, so a failed night keeps every garage it wrote
// whole and the retry writes only what still differs. The advisory lock
// makes a second run at the same moment read the first one's row.
export async function writeResponseStats(db: PrismaClient, now: Date) {
  const figures = await countResponseStats(db, now);
  let written = 0;
  for (const { garageId, ...next } of figures) {
    const wrote = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('garage_response_stats'), hashtext(${garageId}))`;
      const before = await tx.garageResponseStats.findUnique({
        where: { garageId },
      });
      if (before && same(before, next)) return false;
      const row = { ...next, computedAt: now };
      await tx.garageResponseStats.upsert({
        create: { garageId, ...row },
        update: row,
        where: { garageId },
      });
      const shown = responseRateOf(next);
      const was = responseRateOf(before);
      if (shown.state !== was.state || shown.rate !== was.rate) {
        await outbox.record(tx, {
          audience: { garageId, results: false, type: 'public_garage' },
          kind: 'response_stats.updated',
          payload: {},
          subjectId: garageId,
        });
      }
      return true;
    });
    if (wrote) written++;
  }
  return { computed: figures.length, written };
}
