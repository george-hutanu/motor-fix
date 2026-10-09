import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { addDays, atLocal, localDay } from '../../bucharest';
import type { PrismaClient } from '../../generated/prisma/client';
import { bookedInclude, bookedOf } from '../../quotes/reads';

interface DaySheetQuery {
  mechanic: string;
  day?: string;
}

// "Ștefan", "Ştefan" and "stefan" are one name: the comma and the cedilla
// forms both decompose to a base letter and a mark.
const plain = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One mechanic's confirmed and completed work on one Bucharest day, as the
// printed day sheet lists it.
@Injectable()
export class DaySheetService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async get(actor: Actor, query: DaySheetQuery, now = new Date()) {
    requireCapability(actor, 'garage.schedule');
    const garageId = actor.garageId as string;
    const mechanic = await this.mechanicOf(garageId, query.mechanic);
    const day = query.day ?? localDay(now);
    const rows = await this.prisma.booking.findMany({
      include: bookedInclude,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      where: {
        garageId,
        mechanicId: mechanic.id,
        startsAt: { gte: atLocal(day, 0), lt: atLocal(addDays(day, 1), 0) },
        status: { in: ['confirmed', 'completed'] },
      },
    });
    const minutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0);
    return {
      day,
      entries: rows.map((row) => ({
        ...bookedOf(row, actor.language),
        note: row.request.description,
      })),
      jobCount: rows.length,
      mechanic,
      // To the nearest quarter hour.
      totalHours: Math.round(minutes / 15) / 4,
    };
  }

  // By id, full name or first name. A name that matches no one or more than
  // one is answered with the garage's mechanics, so the caller can ask which.
  private async mechanicOf(garageId: string, asked: string) {
    const mechanics = await this.prisma.mechanic.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
      where: { garageId },
    });
    const wanted = plain(asked);
    const found = mechanics.filter(
      (m) =>
        m.id === asked ||
        plain(m.name) === wanted ||
        plain(m.name).split(' ')[0] === wanted,
    );
    if (found.length === 1) return found[0];
    if (UUID.test(asked)) throw new NotFoundException();
    throw new NotFoundException({
      code: 'mechanic_not_found',
      mechanics,
      message: 'No single mechanic of this garage has that name',
    });
  }
}
