import { Inject, Injectable } from '@nestjs/common';

import { dueStage, type ReminderStage, seasonOf } from './reminders';
import { addDays, localDay } from '../bucharest';
import type {
  Prisma,
  PrismaClient,
  Reminder,
} from '../generated/prisma/client';
import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications/notifications.service';

type DueKind = 'itp' | 'service' | 'rca' | 'rovinieta';
const DUE_KINDS: DueKind[] = ['itp', 'service', 'rca', 'rovinieta'];

const date = (day: string) => new Date(`${day}T00:00:00Z`);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

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
  ) {}

  // A new date resets what was sent for the old one.
  async setCarDue(input: {
    accountId: string;
    carId: string;
    kind: DueKind;
    dueOn: string;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO reminder (id, account_id, car_id, kind, due_on)
      VALUES (gen_random_uuid(), ${input.accountId}::uuid, ${input.carId}::uuid,
              ${input.kind}::reminder_kind, ${input.dueOn}::date)
      ON CONFLICT (car_id, kind) DO UPDATE SET
        account_id = EXCLUDED.account_id,
        due_on = EXCLUDED.due_on,
        sent_30 = reminder.sent_30 AND reminder.due_on = EXCLUDED.due_on,
        sent_7 = reminder.sent_7 AND reminder.due_on = EXCLUDED.due_on`;
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
      where: {
        OR: [
          {
            dueOn: { gte: date(today), lte: date(addDays(today, 30)) },
            kind: { in: DUE_KINDS },
            OR: [{ sent30: false }, { sent7: false }],
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
  private async send(reminder: Reminder, today: string): Promise<boolean> {
    const dueOn = day(reminder.dueOn);
    const due = dueStage({ ...reminder, dueOn }, today);
    if (!due) return false;
    await this.notifications.notify({
      eventId: `reminder:${reminder.id}:${due.stage}:${dueOn ?? today.slice(0, 4)}`,
      kind: due.type,
      params: { dueOn },
      recipients: [reminder.accountId],
      subjectId: reminder.carId ?? reminder.bookingId,
    });
    // Only for the date it was sent for: a date changed meanwhile keeps its reset.
    await this.prisma.reminder.updateMany({
      data: sentFlags(due.stage, today, this.notifications.now()),
      where: { dueOn: reminder.dueOn, id: reminder.id },
    });
    return true;
  }
}
