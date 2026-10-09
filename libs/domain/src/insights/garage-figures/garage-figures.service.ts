import { Inject, Injectable } from '@nestjs/common';

import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import {
  addDays,
  atLocal,
  daysBetween,
  localDay,
  monthStart,
  weekStart,
} from '../../bucharest';
import type { PrismaClient } from '../../generated/prisma/client';
import { invalidInput } from '../../quotes/reads';

interface FiguresQuery {
  period?: 'week' | 'month';
  from?: string;
  to?: string;
  compareWithPrevious?: boolean;
}

interface Period {
  from: string;
  to: string;
}

interface Counts {
  bookings: number;
  estimatedWorkBani: number;
  quotesSent: number;
  quotesWon: number;
  requests: number;
  responseTimeMinutes: number | null;
}

export interface Figures {
  current: Counts;
  period: Period;
  previous?: Counts & { period: Period };
}

// A year, leap day included.
const MAX_SPAN_DAYS = 365;
const MINUTE = 60_000;

const lastOfMonth = (day: string) =>
  addDays(monthStart(addDays(monthStart(day), 31)), -1);

function rangeOf(from?: string, to?: string): [Period, Period] {
  if (from === undefined || to === undefined)
    throw invalidInput('from and to go together');
  const span = daysBetween(from, to);
  if (!(span >= 0 && span <= MAX_SPAN_DAYS))
    throw invalidInput(`from and to span 1 to ${MAX_SPAN_DAYS + 1} days`);
  const before = addDays(from, -1);
  return [
    { from, to },
    { from: addDays(before, -span), to: before },
  ];
}

function periodsOf(query: FiguresQuery, today: string): [Period, Period] {
  if (query.from === undefined && query.to === undefined)
    return calendar(query.period, today);
  if (query.period) throw invalidInput('give either a period or from and to');
  return rangeOf(query.from, query.to);
}

function calendar(
  period: FiguresQuery['period'],
  today: string,
): [Period, Period] {
  if (period === 'month') {
    const from = monthStart(today);
    const before = addDays(from, -1);
    return [
      { from, to: lastOfMonth(from) },
      { from: monthStart(before), to: before },
    ];
  }
  const from = weekStart(today);
  return [
    { from, to: addDays(from, 6) },
    { from: addDays(from, -7), to: addDays(from, -1) },
  ];
}

// Middle value, the mean of the two middle ones rounded half up.
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? Math.round(sorted[mid])
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// The garage's own numbers over whole Bucharest days: what reached it, what it
// quoted and won, what it worked on and how fast it answered.
@Injectable()
export class GarageFiguresService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async get(
    actor: Actor,
    query: FiguresQuery,
    now = new Date(),
  ): Promise<Figures> {
    requireCapability(actor, 'garage.requests');
    const garageId = actor.garageId as string;
    const [period, before] = periodsOf(query, localDay(now));
    const current = await this.count(garageId, period);
    if (!query.compareWithPrevious) return { current, period };
    return {
      current,
      period,
      previous: { ...(await this.count(garageId, before)), period: before },
    };
  }

  private async count(garageId: string, period: Period): Promise<Counts> {
    const within = {
      gte: atLocal(period.from, 0),
      lt: atLocal(addDays(period.to, 1), 0),
    };
    const [requests, quotesSent, won, bookings, answered] = await Promise.all([
      this.prisma.requestRecipient.count({
        where: { createdAt: within, garageId },
      }),
      this.prisma.quote.count({ where: { garageId, sentAt: within } }),
      this.prisma.quote.findMany({
        select: {
          booking: {
            select: { job: { select: { finalPriceBani: true } }, status: true },
          },
          fromBani: true,
          toBani: true,
        },
        where: { acceptedAt: within, garageId },
      }),
      this.prisma.booking.count({
        where: {
          garageId,
          startsAt: within,
          status: { in: ['confirmed', 'completed'] },
        },
      }),
      this.prisma.requestRecipient.findMany({
        select: { answeredAt: true, createdAt: true },
        where: { answeredAt: within, garageId },
      }),
    ]);
    const estimatedWorkBani = won
      .filter(
        (q) =>
          !q.booking ||
          !['lapsed', 'cancelled', 'no_show'].includes(q.booking.status),
      )
      .reduce(
        (sum, q) =>
          sum +
          (q.booking?.job?.finalPriceBani ??
            Math.round((q.fromBani + q.toBani) / 2)),
        0,
      );
    return {
      bookings,
      estimatedWorkBani,
      quotesSent,
      quotesWon: won.length,
      requests,
      responseTimeMinutes: median(
        answered.map(
          (r) =>
            ((r.answeredAt as Date).getTime() - r.createdAt.getTime()) / MINUTE,
        ),
      ),
    };
  }
}
