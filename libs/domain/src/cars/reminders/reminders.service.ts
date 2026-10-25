import { Inject, Injectable } from '@nestjs/common';

import { dueStage, type ReminderStage, seasonOf } from './reminders';
import { addDays, daysBetween, localDay } from '../../bucharest';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../../notifications/notifications.service';
import { serviceDueOn } from '../odometer/odometer';

type DueKind = 'itp' | 'service' | 'rca' | 'rovinieta';
const DUE_KINDS: DueKind[] = ['itp', 'service', 'rca', 'rovinieta'];

type CarDate = 'itpUntil' | 'rcaUntil' | 'rovinietaUntil';
const CAR_DATES: [CarDate, DueKind][] = [
  ['itpUntil', 'itp'],
  ['rcaUntil', 'rca'],
  ['rovinietaUntil', 'rovinieta'],
];

// The public web address, for the link a reminder's e-mail and push open.
export const REMINDERS_WEB_URL = Symbol('REMINDERS_WEB_URL');

interface CarUpdated {
  carId: string;
  ownerId: string;
  // Absent on `car.added`: every date the car has is new.
  changed?: string[];
}

// A car event as the outbox relay queues it.
export interface CarEvent {
  id: string;
  kind: string;
  payload: { carId: string; ownerId: string } | CarUpdated;
  subjectId: string;
}

const date = (day: string) => new Date(`${day}T00:00:00Z`);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// The car a reminder is about, by name, so its message can say which one.
const WITH_CAR = {
  car: { select: { brand: { select: { name: true } }, model: true } },
} as const;
type Due = Prisma.ReminderGetPayload<{ include: typeof WITH_CAR }>;

// What a sent stage records on its reminder.
function sentFlags(
  stage: ReminderStage,
  today: string,
  at: Date,
): Prisma.ReminderUpdateManyMutationInput {
  if (stage === '30') return { sent30: true };
  if (stage === '7') return { sent7: true, sent30: true };
  if (stage === 'season') {
    return { seasonYear: Number(today.slice(0, 4)), sentAt: at };
  }
  return { sentAt: at };
}

// The reminders of cars and bookings: the hooks their stories call, and the
// daily run that sends each stage once.
@Injectable()
export class RemindersService {
  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(REMINDERS_WEB_URL) private readonly webUrl: string = '',
  ) {}

  // A new date resets what was sent for the old one and takes a new id, since
  // a sent stage is keyed by the reminder's id and date: a date moved away and
  // back is reminded again. A stage whose day
  // passed before `today` (Europe/Bucharest) counts as sent: a date set late
  // never sends a stage that is already behind it. Today's stage still goes.
  async setCarDue(input: {
    accountId: string;
    carId: string;
    kind: DueKind;
    dueOn: string;
    today: string;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO reminder (id, account_id, car_id, kind, due_on, sent_30, sent_7)
      VALUES (gen_random_uuid(), ${input.accountId}::uuid, ${input.carId}::uuid,
              ${input.kind}::reminder_kind, ${input.dueOn}::date,
              ${input.dueOn}::date - 30 < ${input.today}::date,
              ${input.dueOn}::date - 7 < ${input.today}::date)
      ON CONFLICT (car_id, kind) DO UPDATE SET
        id = CASE WHEN reminder.due_on = EXCLUDED.due_on THEN reminder.id
                  ELSE EXCLUDED.id END,
        account_id = EXCLUDED.account_id,
        due_on = EXCLUDED.due_on,
        sent_30 = (reminder.sent_30 AND reminder.due_on = EXCLUDED.due_on)
                  OR EXCLUDED.sent_30,
        sent_7 = (reminder.sent_7 AND reminder.due_on = EXCLUDED.due_on)
                 OR EXCLUDED.sent_7`;
  }

  // The oil service is keyed by the kilometres it is due at, not its day: the
  // day is an estimate that moves with every reading, and a moved estimate
  // keeps the reminder's id and what it sent. A new value takes a new id and
  // starts again. A stage behind `today` counts as sent, as for a date.
  async setServiceDue(input: {
    accountId: string;
    carId: string;
    dueKm: number;
    dueOn: string;
    today: string;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO reminder (id, account_id, car_id, kind, due_on, due_km, sent_30, sent_7)
      VALUES (gen_random_uuid(), ${input.accountId}::uuid, ${input.carId}::uuid,
              'service', ${input.dueOn}::date, ${input.dueKm},
              ${input.dueOn}::date - 30 < ${input.today}::date,
              ${input.dueOn}::date - 7 < ${input.today}::date)
      ON CONFLICT (car_id, kind) DO UPDATE SET
        id = CASE WHEN reminder.due_km = EXCLUDED.due_km THEN reminder.id
                  ELSE EXCLUDED.id END,
        account_id = EXCLUDED.account_id,
        due_on = EXCLUDED.due_on,
        due_km = EXCLUDED.due_km,
        sent_30 = (reminder.sent_30 AND reminder.due_km = EXCLUDED.due_km)
                  OR EXCLUDED.sent_30,
        sent_7 = (reminder.sent_7 AND reminder.due_km = EXCLUDED.due_km)
                 OR EXCLUDED.sent_7`;
  }

  // A relayed car event: an added car's dates set their reminders, an edit's
  // changed dates move, set or cancel theirs; a removal deletes them all. The dates are read from the car,
  // not the event, so a retried older edit cannot move a reminder back or
  // recreate one cleared since; delivered twice, it writes the same rows. An
  // edit that reaches a car removed since changes nothing.
  async onCarEvent(event: CarEvent): Promise<void> {
    const { carId } = event.payload;
    if (event.kind === 'car.removed') return this.removeCar(carId);
    const car = await this.prisma.car.findUnique({
      select: {
        itpUntil: true,
        nextServiceKm: true,
        odometerKm: true,
        rcaUntil: true,
        readings: { select: { createdAt: true, km: true, readOn: true } },
        removedAt: true,
        rovinietaUntil: true,
      },
      where: { id: carId },
    });
    if (!car || car.removedAt) return;
    const today = localDay(this.notifications.now());
    const payload = event.payload as CarUpdated;
    // A field an added car has, or an edit changed.
    const touched = (...fields: string[]) =>
      event.kind === 'car.added' ||
      fields.some((f) => payload.changed?.includes(f));
    for (const [field, kind] of CAR_DATES) {
      if (!touched(field)) continue;
      const dueOn = day(car[field]);
      if (dueOn === null) {
        await this.prisma.reminder.deleteMany({ where: { carId, kind } });
      } else {
        await this.setCarDue({
          accountId: payload.ownerId,
          carId,
          dueOn,
          kind,
          today,
        });
      }
    }
    if (touched('nextServiceKm', 'odometerKm')) {
      await this.onServiceChange(carId, payload.ownerId, car, today);
    }
  }

  // The estimate is read from the car's readings as they stand; past its
  // value, or with none, the car has no service reminder.
  private async onServiceChange(
    carId: string,
    accountId: string,
    car: {
      nextServiceKm: number | null;
      odometerKm: number;
      readings: { createdAt: Date; km: number; readOn: Date }[];
    },
    today: string,
  ): Promise<void> {
    const readings = car.readings.map((r) => ({
      ...r,
      readOn: day(r.readOn) as string,
    }));
    const dueOn = serviceDueOn(car, readings, today);
    if (dueOn === null || car.nextServiceKm === null) {
      await this.prisma.reminder.deleteMany({
        where: { carId, kind: 'service' },
      });
      return;
    }
    await this.setServiceDue({
      accountId,
      carId,
      dueKm: car.nextServiceKm,
      dueOn,
      today,
    });
  }

  async setTyres(input: { accountId: string; carId: string }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO reminder (id, account_id, car_id, kind)
      VALUES (gen_random_uuid(), ${input.accountId}::uuid, ${input.carId}::uuid, 'tyres_winter'),
             (gen_random_uuid(), ${input.accountId}::uuid, ${input.carId}::uuid, 'tyres_summer')
      ON CONFLICT (car_id, kind) DO UPDATE SET account_id = EXCLUDED.account_id`;
  }

  async removeCar(carId: string): Promise<void> {
    await this.prisma.reminder.deleteMany({ where: { carId } });
  }

  // A booking moved to another day is reminded the day before the new one.
  async setBooking(input: {
    accountId: string;
    bookingId: string;
    startsAt: Date;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO reminder (id, account_id, booking_id, kind, due_on)
      VALUES (gen_random_uuid(), ${input.accountId}::uuid, ${input.bookingId}::uuid,
              'booking', ${localDay(input.startsAt)}::date)
      ON CONFLICT (booking_id) DO UPDATE SET
        account_id = EXCLUDED.account_id,
        due_on = EXCLUDED.due_on,
        sent_at = CASE WHEN reminder.due_on = EXCLUDED.due_on THEN reminder.sent_at END`;
  }

  async cancelBooking(bookingId: string): Promise<void> {
    await this.prisma.reminder.deleteMany({ where: { bookingId } });
  }

  // The run of `today` (Europe/Bucharest). Answers how many reminders it sent.
  async run(today: string): Promise<number> {
    const season = seasonOf(today);
    const candidates = await this.prisma.reminder.findMany({
      include: WITH_CAR,
      where: {
        OR: [
          {
            AND: [
              { OR: [{ sent30: false }, { sent7: false }] },
              { OR: [{ carId: null }, { car: { removedAt: null } }] },
            ],
            dueOn: { gte: date(today), lte: date(addDays(today, 30)) },
            kind: { in: DUE_KINDS },
          },
          { dueOn: date(addDays(today, 1)), kind: 'booking', sentAt: null },
          ...(season
            ? [
                {
                  kind: season,
                  OR: [
                    { seasonYear: null },
                    { seasonYear: { not: Number(today.slice(0, 4)) } },
                  ],
                },
              ]
            : []),
        ],
      },
    });
    let sent = 0;
    for (const reminder of candidates) {
      if (await this.send(reminder, today)) sent += 1;
    }
    return sent;
  }

  // The pipeline writes one message per event and person, so a run repeated
  // before the flag is set sends nothing twice.
  private async send(reminder: Due, today: string): Promise<boolean> {
    const dueOn = day(reminder.dueOn);
    const due = dueStage({ ...reminder, dueOn }, today);
    if (!due) return false;
    // A car removed since the run read its reminders is told nothing.
    if (reminder.carId && (await this.removed(reminder.carId))) return false;
    await this.notifications.notify({
      eventId: `reminder:${reminder.id}:${due.stage}:${reminder.dueKm ?? dueOn ?? today.slice(0, 4)}`,
      kind: due.type,
      params: this.params(reminder, dueOn, today),
      recipients: [reminder.accountId],
      subjectId: reminder.carId ?? reminder.bookingId,
    });
    // Only for the date it was sent for: a date changed meanwhile keeps its
    // reset. A service reminder's day moves with the odometer under the same
    // id, and a new value takes a new id, so its id alone is the value.
    await this.prisma.reminder.updateMany({
      data: sentFlags(due.stage, today, this.notifications.now()),
      where:
        reminder.kind === 'service'
          ? { id: reminder.id }
          : { dueOn: reminder.dueOn, id: reminder.id },
    });
    return true;
  }

  // The car by name, its date, the true days left and, with a web address,
  // the link to the driver's cars.
  private params(reminder: Due, dueOn: string | null, today: string) {
    if (!reminder.car) return { dueOn };
    return {
      car: `${reminder.car.brand.name} ${reminder.car.model}`,
      ...(this.webUrl ? { cars: `${this.webUrl}/app/driver/cars` } : {}),
      dueOn,
      ...(dueOn ? { left: daysBetween(today, dueOn) } : {}),
    };
  }

  private async removed(carId: string): Promise<boolean> {
    const car = await this.prisma.car.findUnique({
      select: { removedAt: true },
      where: { id: carId },
    });
    return !car || car.removedAt !== null;
  }
}
