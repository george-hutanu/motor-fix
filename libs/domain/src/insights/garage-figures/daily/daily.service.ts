import type { NextFreeSlotsDto, TodayFiguresDto } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  dailyPeriods,
  estimatedWork,
  freeSlotsKey,
  nextFreeSlots,
} from './daily';
import { recordTodayFiguresFallback } from './daily.metrics';
import {
  type Actor,
  assertGarage,
  requireCapability,
} from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import type { PrismaClient } from '../../../generated/prisma/client';
import { FreeSlotsService } from '../../../workshop/free-slots/free-slots.service';
import { refuseMechanic, wonQuotes } from '../garage-figures.service';

type Window = { gte: Date; lt: Date };

// The garage's four numbers of the day. Reads only.
@Injectable()
export class DailyFiguresService {
  private readonly logger = new Logger('DailyFigures');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly freeSlots: FreeSlotsService,
  ) {}

  // The counts never wait on the free starts: when those fail, the answer
  // says so and the rest still comes back.
  async today(
    actor: Actor,
    garageId: string,
    now = new Date(),
  ): Promise<TodayFiguresDto> {
    assertGarage(actor, garageId);
    refuseMechanic(actor);
    requireCapability(actor, 'garage.requests');
    const p = dailyPeriods(now);
    const [
      requestsToday,
      requestsYesterday,
      bookingsThisWeek,
      bookingsToday,
      garage,
      won,
      free,
    ] = await Promise.all([
      this.reached(garageId, p.today),
      this.reached(garageId, p.yesterday),
      this.booked(garageId, p.week),
      this.booked(garageId, p.today),
      this.prisma.garage.findUnique({
        select: { rating: true, reviewCount: true },
        where: { id: garageId },
      }),
      wonQuotes(this.prisma, garageId, p.month),
      this.nextFree(garageId, now, p.sunday),
    ]);
    return {
      bookingsThisWeek,
      bookingsToday,
      estimatedWorkBani: estimatedWork(won),
      freeSlotsUnavailable: free === 'unavailable',
      month: p.monthDay,
      nextFreeSlots: free === 'unavailable' ? null : free,
      rating: garage?.rating == null ? null : Number(garage.rating),
      requestsToday,
      requestsYesterday,
      reviewCount: garage?.reviewCount ?? 0,
    };
  }

  private reached(garageId: string, createdAt: Window) {
    return this.prisma.requestRecipient.count({
      where: { createdAt, garageId },
    });
  }

  private booked(garageId: string, startsAt: Window) {
    return this.prisma.booking.count({
      where: { garageId, startsAt, status: { in: ['confirmed', 'completed'] } },
    });
  }

  private async nextFree(
    garageId: string,
    now: Date,
    sunday: string,
  ): Promise<NextFreeSlotsDto | null | 'unavailable'> {
    const key = freeSlotsKey(garageId, now, sunday);
    if (!key) return null;
    try {
      return nextFreeSlots((await this.freeSlots.answer(key)).slots, sunday);
    } catch {
      this.logger.warn({ code: 'free_slots_unavailable', garageId });
      recordTodayFiguresFallback();
      return 'unavailable';
    }
  }
}
