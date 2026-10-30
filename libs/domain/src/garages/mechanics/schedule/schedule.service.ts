import {
  DAY_OFF_DAYS_AHEAD,
  DAY_OFF_NOTE_MAX,
  type Interval,
  isDay,
  isRecord,
  isTime,
  type MechanicScheduleDto,
  storedWeek,
  stretchOf,
  todayInBucharest,
  WEEKDAYS,
  type Weekday,
  type WeeklyHours,
} from '@motor-fix/contracts';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { canonical } from '../../../audit/audit.service';
import { refusal } from '../../../auth/http-refusal';
import type { Actor } from '../../../auth/policy';
import { addDays, atLocal } from '../../../bucharest';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { effectiveHours } from '../../mechanic-hours';
import {
  cardAudience,
  GarageMechanicsService,
} from '../garage-mechanics.service';

type FieldProblem = { code: string; field: string };
type Db = PrismaClient | Prisma.TransactionClient;

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const letters = (text: string) => [...text].length;
const same = (a: unknown, b: unknown) =>
  canonical(a ?? null) === canonical(b ?? null);

const invalid = (errors: FieldProblem[], message: string) =>
  refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_failed',
    message,
    errors,
  );

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such mechanic');

const SCHEDULE_SELECT = {
  garage: { select: { hours: true } },
  id: true,
  onProfile: true,
  workingHours: true,
  worksSaturdays: true,
} as const;

// The garage's span of a weekday, or null when it is closed that day. A
// garage that set no hours bounds nothing.
const boundOf = (garageHours: unknown, day: Weekday): Interval | null =>
  stretchOf(storedWeek(garageHours)[day] ?? []);

const unset = (hours: unknown) => Object.keys(storedWeek(hours)).length === 0;

const isIntervalList = (list: unknown): list is Interval[] =>
  Array.isArray(list) &&
  list.every(
    (item) =>
      Array.isArray(item) &&
      item.length === 2 &&
      item.every((time) => typeof time === 'string'),
  );

// What is wrong with one day of the week, or null.
function dayProblem(
  list: unknown,
  garageHours: unknown,
  day: Weekday,
): string | null {
  if (!isIntervalList(list)) return 'invalid';
  if (list.length === 0) return null;
  if (list.length > 1) return 'count';
  const [[from, to]] = list;
  if (!isTime(from) || !isTime(to)) return 'grid';
  if (to <= from) return 'order';
  if (unset(garageHours)) return null;
  const bound = boundOf(garageHours, day);
  return !bound || from < bound[0] || to > bound[1] ? 'outside_opening' : null;
}

// A week the owner sends: all seven days, each empty or one stretch on the
// 15-minute grid inside the garage's span of that day.
function judgeWeek(
  value: unknown,
  garageHours: unknown,
  errors: FieldProblem[],
): WeeklyHours | null {
  const days: readonly string[] = WEEKDAYS;
  if (!isRecord(value) || Object.keys(value).some((k) => !days.includes(k))) {
    errors.push({ code: 'invalid', field: 'workingHours' });
    return null;
  }
  const found = WEEKDAYS.flatMap((day) => {
    const code = dayProblem(value[day], garageHours, day);
    return code ? [{ code, field: `workingHours.${day}` }] : [];
  });
  errors.push(...found);
  return found.length > 0
    ? null
    : (Object.fromEntries(
        WEEKDAYS.map((day) => [day, value[day]]),
      ) as WeeklyHours);
}

// The week and Saturday switch the owner sends, or a 422 naming each field.
function judgeSchedule(
  body: unknown,
  garageHours: unknown,
): { workingHours: WeeklyHours; worksSaturdays: boolean } {
  const fields = isRecord(body) ? body : {};
  const errors: FieldProblem[] = [];
  const week = judgeWeek(fields['workingHours'], garageHours, errors);
  const saturdays = fields['worksSaturdays'];
  if (typeof saturdays !== 'boolean') {
    errors.push({ code: 'invalid', field: 'worksSaturdays' });
  } else if (saturdays && !unset(garageHours) && !boundOf(garageHours, 'sat')) {
    errors.push({ code: 'garage_closed_saturday', field: 'worksSaturdays' });
  }
  if (errors.length > 0 || !week || typeof saturdays !== 'boolean') {
    throw invalid(errors, "The mechanic's hours cannot be saved");
  }
  return { workingHours: week, worksSaturdays: saturdays };
}

interface DayOffFields {
  firstDay: string;
  lastDay: string;
  note: string | null;
  acknowledgeBookings: boolean;
}

function rangeProblems(
  firstDay: unknown,
  lastDay: unknown,
  today: string,
): FieldProblem[] {
  if (!isDay(firstDay)) return [{ code: 'invalid', field: 'firstDay' }];
  const errors: FieldProblem[] =
    firstDay < today ? [{ code: 'past', field: 'firstDay' }] : [];
  if (!isDay(lastDay)) errors.push({ code: 'invalid', field: 'lastDay' });
  else if (lastDay < firstDay) errors.push({ code: 'order', field: 'lastDay' });
  else if (lastDay > addDays(today, DAY_OFF_DAYS_AHEAD)) {
    errors.push({ code: 'too_far', field: 'lastDay' });
  }
  return errors;
}

function noteProblem(note: unknown): FieldProblem[] {
  if (note === undefined || note === null) return [];
  if (typeof note !== 'string') return [{ code: 'invalid', field: 'note' }];
  return letters(note.trim()) > DAY_OFF_NOTE_MAX
    ? [{ code: 'too_long', field: 'note' }]
    : [];
}

function judgeDayOff(body: unknown, today: string): DayOffFields {
  const fields = isRecord(body) ? body : {};
  const { acknowledgeBookings, firstDay, note } = fields;
  const lastDay = fields['lastDay'] ?? firstDay;
  const errors = [
    ...rangeProblems(firstDay, lastDay, today),
    ...noteProblem(note),
  ];
  if (![undefined, true, false].includes(acknowledgeBookings as boolean)) {
    errors.push({ code: 'invalid', field: 'acknowledgeBookings' });
  }
  if (errors.length > 0) throw invalid(errors, 'The day off cannot be saved');
  return {
    acknowledgeBookings: acknowledgeBookings === true,
    firstDay: firstDay as string,
    lastDay: lastDay as string,
    note: (typeof note === 'string' && note.trim()) || null,
  };
}

const shownDayOff = (d: {
  firstDay: Date;
  lastDay: Date;
  note: string | null;
}) => ({
  firstDay: dayOf(d.firstDay),
  lastDay: dayOf(d.lastDay),
  note: d.note,
});

// A mechanic's working week and days off, set by the garage's owner.
@Injectable()
export class MechanicScheduleService {
  constructor(
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly mechanics: GarageMechanicsService,
  ) {}

  async read(
    db: PrismaClient,
    actor: Actor,
    garageId: string,
    mechanicId: string,
  ): Promise<MechanicScheduleDto> {
    await this.mechanics.access(db, actor, garageId);
    return this.scheduleOf(db, garageId, mechanicId);
  }

  async write(
    db: PrismaClient,
    actor: Actor,
    garageId: string,
    mechanicId: string,
    body: unknown,
  ): Promise<MechanicScheduleDto> {
    await this.mechanics.access(db, actor, garageId);
    await db.$transaction(async (tx) => {
      // The garage's row first, as a save of its hours takes it before it
      // clips the cards: the week is judged against hours no save is changing.
      await tx.$queryRaw`SELECT id FROM garage WHERE id = ${garageId}::uuid FOR SHARE`;
      await lockCard(tx, garageId, mechanicId);
      const card = await cardOf(tx, garageId, mechanicId);
      const after = judgeSchedule(body, card.garage.hours);
      const before = {
        workingHours: card.workingHours,
        worksSaturdays: card.worksSaturdays,
      };
      const changed = (['workingHours', 'worksSaturdays'] as const).filter(
        (key) => !same(before[key], after[key]),
      );
      if (changed.length === 0) return;
      await tx.mechanic.update({ data: after, where: { id: card.id } });
      await this.audit.recordChanges(
        tx,
        {
          actorId: actor.accountId,
          actorRole: actor.role,
          garageId,
          subjectId: card.id,
          subjectType: 'mechanic',
        },
        before,
        after,
      );
      await this.events.record(tx, {
        audience: cardAudience(garageId, card),
        kind: 'mechanic.updated',
        payload: {
          fields: changed.map((key) =>
            key === 'workingHours' ? 'working_hours' : 'works_saturdays',
          ),
          garageId,
          mechanicId: card.id,
        },
        subjectId: card.id,
      });
    });
    return this.scheduleOf(db, garageId, mechanicId);
  }

  // A day or a range off. Over confirmed bookings of the mechanic it is
  // refused once, naming them, until the owner sends it again acknowledged;
  // the bookings stay, flagged to reassign.
  async addDayOff(
    db: PrismaClient,
    actor: Actor,
    garageId: string,
    mechanicId: string,
    body: unknown,
  ): Promise<MechanicScheduleDto> {
    await this.mechanics.access(db, actor, garageId);
    const card = await cardOf(db, garageId, mechanicId);
    const today = todayInBucharest();
    const off = judgeDayOff(body, today);
    await db.$transaction(async (tx) => {
      // Serialises the adds of one mechanic, so two at once cannot overlap.
      await lockCard(tx, garageId, card.id);
      const overlap = await tx.mechanicDayOff.findFirst({
        select: { id: true },
        where: {
          firstDay: { lte: asDate(off.lastDay) },
          lastDay: { gte: asDate(off.firstDay) },
          mechanicId: card.id,
        },
      });
      if (overlap) {
        throw refusal(
          HttpStatus.CONFLICT,
          'day_off_overlap',
          'The mechanic already has a day off on one of those days',
        );
      }
      if (!off.acknowledgeBookings) {
        const booked = await tx.booking.findMany({
          orderBy: { startsAt: 'asc' },
          select: { id: true, startsAt: true },
          where: {
            mechanicId: card.id,
            startsAt: {
              gte: atLocal(off.firstDay, 0),
              lt: atLocal(addDays(off.lastDay, 1), 0),
            },
            status: 'confirmed',
          },
        });
        if (booked.length > 0) {
          throw new HttpException(
            {
              bookings: booked.map((b) => ({
                id: b.id,
                startsAt: b.startsAt.toISOString(),
              })),
              code: 'bookings_on_days_off',
              message: 'The mechanic has confirmed bookings on those days',
            },
            HttpStatus.CONFLICT,
          );
        }
      }
      const row = await tx.mechanicDayOff.create({
        data: {
          createdBy: actor.accountId,
          firstDay: asDate(off.firstDay),
          lastDay: asDate(off.lastDay),
          mechanicId: card.id,
          note: off.note,
        },
      });
      await this.audit.record(tx, {
        action: 'create',
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId,
        newValue: shownDayOff(row),
        subjectId: row.id,
        subjectType: 'mechanic_day_off',
      });
      await this.daysOffChanged(tx, garageId, card);
    });
    return this.scheduleOf(db, garageId, mechanicId);
  }

  // A day off still ahead goes; one already running ends yesterday, keeping
  // the days that passed; one that ended stays.
  async removeDayOff(
    db: PrismaClient,
    actor: Actor,
    garageId: string,
    mechanicId: string,
    dayOffId: string,
  ): Promise<void> {
    await this.mechanics.access(db, actor, garageId);
    const card = await cardOf(db, garageId, mechanicId);
    const today = todayInBucharest();
    await db.$transaction(async (tx) => {
      // Two removes of one day at once: the second finds it gone, a 404.
      await lockCard(tx, garageId, card.id);
      const row = await tx.mechanicDayOff.findFirst({
        where: { id: dayOffId, mechanicId: card.id },
      });
      if (!row) {
        throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such day off');
      }
      const shown = shownDayOff(row);
      if (shown.lastDay < today) {
        throw refusal(
          HttpStatus.CONFLICT,
          'past_day_off',
          'A day off that already ended stays in the record',
        );
      }
      const change = {
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId,
        subjectId: row.id,
        subjectType: 'mechanic_day_off',
      };
      if (shown.firstDay >= today) {
        await tx.mechanicDayOff.delete({ where: { id: row.id } });
        await this.audit.record(tx, {
          ...change,
          action: 'delete',
          oldValue: shown,
        });
      } else {
        const yesterday = addDays(today, -1);
        await tx.mechanicDayOff.update({
          data: { lastDay: asDate(yesterday) },
          where: { id: row.id },
        });
        await this.audit.recordChanges(
          tx,
          change,
          { lastDay: shown.lastDay },
          { lastDay: yesterday },
        );
      }
      await this.daysOffChanged(tx, garageId, card);
    });
  }

  private daysOffChanged(
    tx: Prisma.TransactionClient,
    garageId: string,
    card: { id: string; onProfile: boolean },
  ) {
    return this.events.record(tx, {
      audience: cardAudience(garageId, card),
      kind: 'mechanic.updated',
      payload: { fields: ['days_off'], garageId, mechanicId: card.id },
      subjectId: card.id,
    });
  }

  private async scheduleOf(
    db: Db,
    garageId: string,
    mechanicId: string,
  ): Promise<MechanicScheduleDto> {
    const card = await cardOf(db, garageId, mechanicId);
    const daysOff = await db.mechanicDayOff.findMany({
      orderBy: { firstDay: 'asc' },
      select: { firstDay: true, id: true, lastDay: true, note: true },
      where: {
        lastDay: { gte: asDate(todayInBucharest()) },
        mechanicId: card.id,
      },
    });
    const garageHours = storedWeek(card.garage.hours) as WeeklyHours;
    return {
      daysOff: daysOff.map((d) => ({ id: d.id, ...shownDayOff(d) })),
      garageHours,
      isDefault: card.workingHours === null,
      workingHours: effectiveHours(card.workingHours, garageHours),
      worksSaturdays: card.worksSaturdays,
    };
  }
}

// Holds the card's row to the end of the transaction, or 404 once it left
// the team.
async function lockCard(
  tx: Prisma.TransactionClient,
  garageId: string,
  mechanicId: string,
) {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM mechanic
    WHERE id = ${mechanicId}::uuid AND garage_id = ${garageId}::uuid
      AND removed_at IS NULL
    FOR UPDATE`;
  if (locked.length === 0) throw notFound();
}

// A card of the garage still on its team, with its garage's hours, or 404.
async function cardOf(db: Db, garageId: string, mechanicId: string) {
  const card = await db.mechanic.findFirst({
    select: SCHEDULE_SELECT,
    where: { garageId, id: mechanicId, removedAt: null },
  });
  if (!card) throw notFound();
  return card;
}
