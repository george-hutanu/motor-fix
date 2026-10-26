import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import { writeZip, type ZipEntry } from './data-export.zip';
import { auditEntryOf } from '../../audit/audit-history/audit-history.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';
import { countDataExport } from '../../metrics/product-counters';
import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../../notifications/notifications.service';
import { StorageService } from '../../storage/storage.service';

export const DATA_EXPORT_QUEUE = 'data-export';
export const DATA_EXPORT_URL = Symbol('DATA_EXPORT_URL');

const DAY = 24 * 60 * 60_000;
const KEPT_MS = 7 * DAY;
const NOTIFICATIONS_KEPT_MS = 365 * DAY;
const ATTEMPTS = 3;

// A failed build is tried twice more, 1 and 2 minutes later.
const DATA_EXPORT_RUN: JobsOptions = {
  attempts: ATTEMPTS,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

const KINDS: readonly EventKind[] = [
  'data_export.requested',
  'account.deleted',
];

export const DATA_EXPORT_CONSUMER = {
  jobs: DATA_EXPORT_RUN,
  kinds: KINDS,
  queue: DATA_EXPORT_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface DataExportEvent {
  id: string;
  kind: string;
  payload: { accountId?: string; exportId?: string } & Record<string, unknown>;
  subjectId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A log names an error by its class: its message may hold a value.
const classOf = (error: unknown) =>
  error instanceof Error ? error.constructor.name : typeof error;

// Another person, as the product shows them to the driver.
const firstName = (name: string | null | undefined) =>
  name ? (name.trim().split(/\s+/)[0] ?? null) : null;
const garageOf = (garage: { name: string; cityName: string | null }) => ({
  city: garage.cityName,
  name: garage.name,
});

const FILES: Record<string, { ro: string; en: string }> = {
  'account.json': {
    en: 'your account: details, roles, how you sign in, language',
    ro: 'contul tău: datele, rolurile, cum intri în cont, limba',
  },
  'audit.json': {
    en: 'the history of changes to your account and by you',
    ro: 'istoricul schimbărilor făcute contului tău și de tine',
  },
  'bookings-and-jobs.json': {
    en: 'your bookings, the jobs on your cars and their history',
    ro: 'programările tale, lucrările la mașinile tale și istoricul lor',
  },
  'cars.json': {
    en: 'your cars, with their dates, readings and reminders',
    ro: 'mașinile tale, cu termenele, kilometrajele citite și mementourile lor',
  },
  'consents.json': {
    en: 'the consents you gave',
    ro: 'acordurile date de tine',
  },
  'messages.json': {
    en: 'the messages you sent to support',
    ro: 'mesajele trimise de tine către suport',
  },
  'notifications-and-preferences.json': {
    en: 'your notifications of the last 12 months, your preferences and devices',
    ro: 'notificările tale din ultimele 12 luni, preferințele și dispozitivele',
  },
  'requests-and-quotes.json': {
    en: 'your quote requests and the quotes you received',
    ro: 'cererile tale de ofertă și ofertele primite',
  },
  'reviews.json': {
    en: 'the reviews you wrote',
    ro: 'recenziile scrise de tine',
  },
};

const readme = (language: 'ro' | 'en', requestedAt: Date) => {
  const day = requestedAt.toISOString().slice(0, 10);
  const head =
    language === 'en'
      ? [
          'MotorFix',
          `Your data, as asked for on ${day}.`,
          'Every file is UTF-8 JSON; times are ISO 8601, in UTC.',
          '',
        ]
      : [
          'MotorFix',
          `Datele tale, cerute pe ${day}.`,
          'Fiecare fișier e JSON în UTF-8; orele sunt ISO 8601, în UTC.',
          '',
        ];
  const lines = Object.entries(FILES).map(
    ([name, about]) => `${name}: ${about[language]}`,
  );
  return `${[...head, ...lines].join('\n')}\n`;
};

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

// The worker's half of the export: the build of a requested copy into a
// stored ZIP, its e-mail, and the expiry of the files.
@Injectable()
export class DataExportBuilder {
  private readonly logger = new Logger('DataExport');
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    @Inject(DATA_EXPORT_URL) private readonly webUrl: string,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  async onEvent(
    job: Pick<Job<DataExportEvent>, 'data' | 'attemptsMade'>,
  ): Promise<void> {
    const { kind, payload, subjectId } = job.data;
    if (kind === 'account.deleted') {
      const accountId = payload.accountId ?? subjectId;
      if (accountId && UUID.test(accountId)) await this.expireAll(accountId);
      return;
    }
    if (kind !== 'data_export.requested') return;
    const exportId = payload.exportId ?? subjectId;
    if (exportId && UUID.test(exportId)) {
      await this.build(exportId, job.attemptsMade + 1);
    }
  }

  // Answers how many files it expired. One that fails does not hold back
  // the others; the sweep then fails naming it, and the next one retries.
  async sweep(now = this.now()): Promise<number> {
    const rows = await this.prisma.dataExport.findMany({
      orderBy: { expiresAt: 'asc' },
      select: { id: true, zipKey: true },
      where: { expiresAt: { lte: now }, status: 'ready' },
    });
    await this.failStale(now);
    const expired = await this.expireEach(rows, 'sweep');
    this.logger.log(`data export sweep: expired ${expired}`);
    return expired;
  }

  // A build's tries span minutes, so an export still queued a day after it
  // was asked for has none left: its last try could not even mark it failed.
  // It fails now, so the driver may ask again, and a file its last try may
  // have stored goes with it (the key is the export's own).
  private async failStale(now: Date) {
    const stale = await this.prisma.dataExport.findMany({
      select: { accountId: true, id: true },
      where: {
        requestedAt: { lte: new Date(now.getTime() - DAY) },
        status: 'queued',
      },
    });
    for (const { accountId, id } of stale) {
      try {
        await this.storage.deleteObject(`data-exports/${accountId}/${id}.zip`);
        const { count } = await this.prisma.dataExport.updateMany({
          data: { status: 'failed' },
          where: { id, status: 'queued' },
        });
        if (count > 0) {
          countDataExport('failed');
          this.logger.warn(`data export ${id}: stuck in the queue, failed`);
        }
      } catch (error) {
        this.logger.warn(`data export ${id}: not failed: ${classOf(error)}`);
      }
    }
  }

  private async build(id: string, attempts: number) {
    const row = await this.prisma.dataExport.findUnique({
      select: {
        account: { select: { email: true, language: true, status: true } },
        accountId: true,
        requestedAt: true,
        status: true,
      },
      where: { id },
    });
    // Ready already: an earlier try stored it and then failed to tell the
    // driver. The e-mail is one row per export, so asking again is safe.
    if (row?.status === 'ready') {
      if (row.account.status !== 'deleted') {
        await this.tell(id, row.accountId, row.account);
      }
      return;
    }
    if (row?.status !== 'queued') return;
    const { account, accountId, requestedAt } = row;
    if (account.status === 'deleted') {
      await this.expireEach([{ id, zipKey: null }], 'deleted');
      this.logger.log(`data export ${id}: account deleted, expired`);
      return;
    }
    const zipKey = `data-exports/${accountId}/${id}.zip`;
    let stored = false;
    try {
      await this.prisma.dataExport.update({
        data: { attempts },
        where: { id },
      });
      const files = await this.collect(
        accountId,
        account.language,
        requestedAt,
      );
      const zip = writeZip(files);
      await this.storage.putObject(zipKey, zip, 'application/zip');
      stored = true;
      const readyAt = this.now();
      const ready = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.dataExport.updateMany({
          data: {
            expiresAt: new Date(readyAt.getTime() + KEPT_MS),
            readyAt,
            status: 'ready',
            zipKey,
          },
          where: { id, status: 'queued' },
        });
        if (count === 0) return false;
        await this.events.record(tx, {
          audience: { accountId, type: 'account' },
          kind: 'data_export.ready',
          payload: { accountId, exportId: id },
          subjectId: id,
        });
        return true;
      });
      // Expired meanwhile, by a deletion: the file goes with it.
      if (!ready) {
        await this.storage.deleteObject(zipKey);
        return;
      }
      countDataExport('ready');
      this.logger.log(
        `data export ${id}: built ${files.length} files, ${zip.length} bytes`,
      );
      await this.tell(id, accountId, account);
    } catch (error) {
      if (attempts >= ATTEMPTS) await this.fail(id, zipKey, stored, error);
      throw error;
    }
  }

  // The last try failed. Only an export still queued counts as failed: one
  // that went ready and then failed to send its e-mail stays ready. A file
  // stored for a failed export is deleted, since no sweep would find it.
  private async fail(
    id: string,
    zipKey: string,
    stored: boolean,
    error: unknown,
  ) {
    const { count } = await this.prisma.dataExport.updateMany({
      data: { status: 'failed' },
      where: { id, status: 'queued' },
    });
    if (count === 0) {
      this.logger.warn(
        `data export ${id}: ready e-mail failed: ${classOf(error)}`,
      );
      return;
    }
    if (stored) {
      await this.storage.deleteObject(zipKey).catch((cause: unknown) => {
        this.logger.warn(
          `data export ${id}: stored file not deleted: ${classOf(cause)}`,
        );
      });
    }
    countDataExport('failed');
    this.logger.error(
      `data export ${id}: failed after ${ATTEMPTS} attempts: ${classOf(error)}`,
    );
  }

  private async tell(
    id: string,
    accountId: string,
    account: { email: string | null; language: 'ro' | 'en' },
  ) {
    if (!account.email) {
      this.logger.log(
        `data export ${id}: no e-mail address, ready e-mail skipped`,
      );
      return;
    }
    // One row per export: a job that comes again sends no second e-mail.
    await this.notifications.notify({
      eventId: id,
      kind: 'DATA_EXPORT_READY',
      params: {
        link: `${this.webUrl}/app/driver/settings`,
      },
      recipients: [accountId],
      subjectId: id,
    });
  }

  private async expireAll(accountId: string) {
    const rows = await this.prisma.dataExport.findMany({
      select: { id: true, zipKey: true },
      where: { accountId, status: { in: ['queued', 'ready'] } },
    });
    await this.expireEach(rows, 'deleted');
    for (const { id } of rows) {
      this.logger.log(`data export ${id}: account deleted, expired`);
    }
  }

  // The stored file first, then the row: a file is never left behind an
  // expired export. A file the store no longer holds is already gone.
  private async expireEach(
    rows: { id: string; zipKey: string | null }[],
    why: 'sweep' | 'deleted',
  ) {
    let expired = 0;
    const failed: string[] = [];
    for (const { id, zipKey } of rows) {
      try {
        if (zipKey) await this.storage.deleteObject(zipKey);
        const { count } = await this.prisma.dataExport.updateMany({
          data: { status: 'expired' },
          where: { id, status: { in: ['queued', 'ready'] } },
        });
        expired += count;
      } catch (error) {
        failed.push(id);
        this.logger.warn(`data export ${id}: not expired: ${classOf(error)}`);
      }
    }
    if (expired > 0) countDataExport('expired', expired);
    if (failed.length > 0) {
      throw new Error(`data export ${why} failed for ${failed.join(', ')}`);
    }
    return expired;
  }

  private async collect(
    accountId: string,
    language: 'ro' | 'en',
    requestedAt: Date,
  ): Promise<ZipEntry[]> {
    const [
      account,
      cars,
      requests,
      bookings,
      reviews,
      messages,
      notes,
      consents,
      audit,
    ] = await Promise.all([
      this.account(accountId),
      this.cars(accountId),
      this.requests(accountId),
      this.bookingsAndJobs(accountId),
      this.reviews(accountId),
      this.messages(accountId),
      this.notificationsOf(accountId, requestedAt),
      this.consents(accountId),
      this.audit(accountId),
    ]);
    return [
      { data: json(account), name: 'account.json' },
      { data: json(cars), name: 'cars.json' },
      { data: json(requests), name: 'requests-and-quotes.json' },
      { data: json(bookings), name: 'bookings-and-jobs.json' },
      { data: json(reviews), name: 'reviews.json' },
      { data: json(messages), name: 'messages.json' },
      { data: json(notes), name: 'notifications-and-preferences.json' },
      { data: json(consents), name: 'consents.json' },
      { data: json(audit), name: 'audit.json' },
      { data: readme(language, requestedAt), name: 'README.txt' },
    ];
  }

  private async account(accountId: string) {
    const account = await this.prisma.account.findUniqueOrThrow({
      select: {
        city: true,
        createdAt: true,
        email: true,
        emailVerifiedAt: true,
        id: true,
        identities: { select: { method: true, passwordHash: true } },
        language: true,
        lastActiveAt: true,
        name: true,
        phone: true,
        phoneVerifiedAt: true,
        roles: { orderBy: { role: 'asc' }, select: { role: true } },
        status: true,
      },
      where: { id: accountId },
    });
    const { identities, roles, ...details } = account;
    return {
      ...details,
      hasPassword: identities.some(
        (identity) => identity.passwordHash !== null,
      ),
      roles: roles.map((each) => each.role),
      signInMethods: [...new Set(identities.map((each) => each.method))].sort(),
    };
  }

  private async cars(accountId: string) {
    const cars = await this.prisma.car.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        brand: { select: { name: true } },
        createdAt: true,
        engine: true,
        fuel: true,
        id: true,
        itpUntil: true,
        model: true,
        nextServiceKm: true,
        odometerKm: true,
        plate: true,
        rcaUntil: true,
        // Every reading the car kept, oldest first.
        readings: {
          orderBy: [{ readOn: 'asc' }, { createdAt: 'asc' }],
          select: { km: true, readOn: true, source: true },
        },
        reminders: {
          orderBy: { dueOn: 'asc' },
          select: {
            dueOn: true,
            kind: true,
            seasonYear: true,
            sent7: true,
            sent30: true,
          },
          where: { accountId },
        },
        removedAt: true,
        rovinietaUntil: true,
        year: true,
      },
      where: { ownerId: accountId },
    });
    return cars.map(({ brand, ...car }) => ({ ...car, brand: brand.name }));
  }

  private async requests(accountId: string) {
    const jobName = { select: { nameEn: true, nameRo: true } };
    const requests = await this.prisma.quoteRequest.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        carBrand: true,
        carId: true,
        carModel: true,
        carYear: true,
        closedAt: true,
        closedReason: true,
        createdAt: true,
        description: true,
        expiresAt: true,
        id: true,
        jobs: {
          orderBy: { position: 'asc' },
          select: { jobType: jobName },
        },
        quotes: {
          orderBy: { sentAt: 'asc' },
          select: {
            durationMinutes: true,
            expiresAt: true,
            fromBani: true,
            garage: { select: { cityName: true, name: true } },
            id: true,
            jobs: {
              select: {
                included: true,
                requestJob: { select: { jobType: jobName } },
              },
            },
            note: true,
            sentAt: true,
            slot: true,
            status: true,
            toBani: true,
          },
        },
        status: true,
      },
      where: { driverId: accountId },
    });
    return requests.map(({ jobs, quotes, ...request }) => ({
      ...request,
      jobs: jobs.map((job) => job.jobType),
      quotes: quotes.map(({ garage, jobs: quoteJobs, ...quote }) => ({
        ...quote,
        garage: garageOf(garage),
        jobs: quoteJobs.map((job) => ({
          ...job.requestJob.jobType,
          included: job.included,
        })),
      })),
    }));
  }

  private async bookingsAndJobs(accountId: string) {
    const garage = { select: { cityName: true, name: true } };
    const [bookings, jobs] = await Promise.all([
      this.prisma.booking.findMany({
        orderBy: { startsAt: 'asc' },
        select: {
          cancelledAt: true,
          cancelledBySide: true,
          cancelReason: true,
          completedAt: true,
          createdAt: true,
          durationMinutes: true,
          garage,
          id: true,
          lateCancellation: true,
          noShowAt: true,
          requestId: true,
          startsAt: true,
          status: true,
        },
        where: { driverId: accountId },
      }),
      this.prisma.job.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          bookingId: true,
          carId: true,
          createdAt: true,
          finalPriceBani: true,
          finishedAt: true,
          garage,
          handedOverAt: true,
          id: true,
          mechanic: { select: { name: true } },
          stages: {
            orderBy: { at: 'asc' },
            select: {
              actorRole: true,
              at: true,
              fromStatus: true,
              text: true,
              toStatus: true,
            },
          },
          startedAt: true,
          status: true,
        },
        where: { driverId: accountId },
      }),
    ]);
    return {
      bookings: bookings.map(({ garage: at, ...booking }) => ({
        ...booking,
        garage: garageOf(at),
      })),
      jobs: jobs.map(({ garage: at, mechanic, ...job }) => ({
        ...job,
        garage: garageOf(at),
        mechanic: firstName(mechanic?.name),
      })),
    };
  }

  private async reviews(accountId: string) {
    const reviews = await this.prisma.review.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        garage: { select: { name: true } },
        id: true,
        jobId: true,
        mechanic: { select: { name: true } },
        postedAt: true,
        rating: true,
        source: true,
        status: true,
        text: true,
      },
      where: { driverId: accountId },
    });
    return reviews.map(({ garage, mechanic, ...review }) => ({
      ...review,
      garage: garage.name,
      mechanic: firstName(mechanic?.name),
    }));
  }

  private messages(accountId: string) {
    return this.prisma.supportMessage.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        acknowledgementStatus: true,
        createdAt: true,
        language: true,
        message: true,
        reference: true,
        subjectRef: true,
        topic: true,
      },
      where: { accountId },
    });
  }

  private async notificationsOf(accountId: string, requestedAt: Date) {
    const since = new Date(requestedAt.getTime() - NOTIFICATIONS_KEPT_MS);
    const [notifications, preferences, devices] = await Promise.all([
      this.prisma.notification.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          channel: true,
          createdAt: true,
          kind: true,
          params: true,
          readAt: true,
          sentAt: true,
          status: true,
        },
        where: { accountId, createdAt: { gte: since } },
      }),
      this.prisma.notificationPreference.findMany({
        orderBy: [{ type: 'asc' }, { channel: 'asc' }],
        select: {
          channel: true,
          consentGivenAt: true,
          enabled: true,
          type: true,
          withdrawnAt: true,
        },
        where: { accountId },
      }),
      this.prisma.pushSubscription.findMany({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, label: true, lastSuccessAt: true },
        where: { accountId },
      }),
    ]);
    return { devices, notifications, preferences };
  }

  private async consents(accountId: string) {
    const [given, choices] = await Promise.all([
      this.prisma.accountConsent.findMany({
        orderBy: { acceptedAt: 'asc' },
        select: {
          acceptedAt: true,
          kind: true,
          language: true,
          method: true,
          textVersion: true,
        },
        where: { accountId },
      }),
      this.prisma.consentRecord.findMany({
        orderBy: { at: 'asc' },
        select: {
          at: true,
          decision: true,
          kind: true,
          language: true,
          textVersion: true,
        },
        where: { accountId },
      }),
    ]);
    return { choices, given };
  }

  // As the person's own history shows it: another actor by the name shown,
  // another subject by its type alone, and no garage id.
  private async audit(accountId: string) {
    const rows = await this.prisma.activityLog.findMany({
      orderBy: [{ at: 'asc' }, { id: 'asc' }],
      where: { OR: [{ subjectId: accountId }, { actorId: accountId }] },
    });
    return rows.map((row) => {
      const {
        actor,
        garageId: _garage,
        subjectId,
        ...entry
      } = auditEntryOf(row, false);
      const own = entry.subjectType === 'account' && subjectId === accountId;
      return {
        ...entry,
        actor: {
          ...actor,
          id: actor.id === accountId ? actor.id : null,
        },
        ...(own && { subjectId }),
      };
    });
  }
}
