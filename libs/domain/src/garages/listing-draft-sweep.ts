import { Logger, type Provider } from '@nestjs/common';

import {
  continueLink,
  DELETE_AFTER_DAYS,
  REMIND_AFTER_DAYS,
} from './listing-drafts/listing-drafts';
import { newToken } from '../auth/email-confirmation/email-confirmation';
import type { PrismaClient } from '../generated/prisma/client';
import {
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications/notifications.service';
import { DAILY_TASKS, type DailyTask } from '../scheduler/daily';
import { StorageService } from '../storage/storage.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY_MS);

const filesOf = (data: unknown): string[] => {
  const files = (data as { files?: unknown } | null)?.files;
  return Array.isArray(files)
    ? files.filter((key): key is string => typeof key === 'string')
    : [];
};

// Once a day: drafts untouched for 90 days go, photos included, and the
// open ones untouched for 3 days get their one reminder. A draft that fails
// is logged by its id alone and left for the next day.
export class ListingDraftSweep implements DailyTask {
  private readonly logger = new Logger('ListingDraftSweep');

  constructor(
    private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly webUrl: string | undefined,
  ) {}

  async run(now: Date): Promise<void> {
    await this.cleanUp(now);
    await this.remind(now);
  }

  async remind(now: Date): Promise<void> {
    const due = await this.prisma.listingDraft.findMany({
      select: { id: true, language: true },
      where: {
        remindedAt: null,
        status: 'open',
        updatedAt: { lte: daysBefore(now, REMIND_AFTER_DAYS) },
      },
    });
    for (const draft of due) {
      await this.remindOne(draft, now).catch((error: unknown) =>
        this.failed('reminder', draft.id, error),
      );
    }
  }

  async cleanUp(now: Date): Promise<void> {
    const cutoff = daysBefore(now, DELETE_AFTER_DAYS);
    const expired = await this.prisma.listingDraft.findMany({
      select: { id: true },
      where: { status: 'open', updatedAt: { lte: cutoff } },
    });
    for (const draft of expired) {
      await this.deleteOne(draft, cutoff).catch((error: unknown) =>
        this.failed('clean-up', draft.id, error),
      );
    }
  }

  // The claim keeps a second worker from sending the same reminder; a send
  // that fails gives the claim back, so tomorrow's run tries again.
  private async remindOne(draft: { id: string; language: string }, now: Date) {
    if (!this.webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    const issued = newToken();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.listingDraft.updateMany({
        data: { remindedAt: now },
        where: { id: draft.id, remindedAt: null, status: 'open' },
      });
      if (count === 0) return false;
      await tx.listingDraftToken.create({
        data: {
          draftId: draft.id,
          hash: issued.hash,
          kind: 'reminder',
          sentAt: now,
        },
      });
      return true;
    });
    if (!claimed) return;
    const language = draft.language === 'en' ? 'en' : 'ro';
    try {
      await this.notifications.sendToDraft(
        'LISTING_REMINDER',
        draft.id,
        continueLink(this.webUrl, language, issued.token),
      );
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.listingDraftToken.deleteMany({
          where: { hash: issued.hash },
        }),
        this.prisma.listingDraft.updateMany({
          data: { remindedAt: null },
          where: { id: draft.id },
        }),
      ]);
      throw error;
    }
  }

  // The files first: a draft whose files stay is kept for the next run.
  private async deleteOne(draft: { id: string }, cutoff: Date) {
    const row = await this.prisma.listingDraft.findUnique({
      select: { data: true },
      where: { id: draft.id },
    });
    for (const key of filesOf(row?.data)) {
      await this.storage.deleteWithCopies(key);
    }
    await this.prisma.listingDraft.deleteMany({
      where: { id: draft.id, status: 'open', updatedAt: { lte: cutoff } },
    });
  }

  private failed(what: string, id: string, error: unknown) {
    const reason = error instanceof Error ? error.name : 'unknown';
    this.logger.error(`listing draft ${what} failed for ${id}: ${reason}`);
  }
}

// The worker's daily tasks: this sweep, on the notifications module's pool.
export const listingDraftDaily = (webUrl: string | undefined): Provider => ({
  inject: [NOTIFICATIONS_PRISMA, NotificationsService, StorageService],
  provide: DAILY_TASKS,
  useFactory: (
    prisma: PrismaClient,
    notifications: NotificationsService,
    storage: StorageService,
  ) => [new ListingDraftSweep(prisma, notifications, storage, webUrl)],
});
