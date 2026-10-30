import { Logger } from '@nestjs/common';

import {
  continueLink,
  DELETE_AFTER_DAYS,
  REMIND_AFTER_DAYS,
} from './listing-drafts/listing-drafts';
import { newToken } from '../auth/email-confirmation/email-confirmation';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import type { NotificationsService } from '../notifications/notifications.service';
import type { DailyTask } from '../scheduler/daily';
import type { StorageService } from '../storage/storage.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY_MS);

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((key): key is string => typeof key === 'string')
    : [];

// Every storage key a draft holds: its photos and its document pages.
const keysOf = (data: unknown): string[] => {
  const draft = data as { files?: unknown; documents?: unknown } | null;
  const documents =
    typeof draft?.documents === 'object' && draft.documents !== null
      ? Object.values(draft.documents)
      : [];
  return [
    ...strings(draft?.files),
    ...documents.flatMap((document) =>
      strings((document as { pages?: unknown } | null)?.pages),
    ),
  ];
};

// The open drafts the sweep deletes: a first listing untouched for 90 days,
// and a copy of a live garage once its file no longer asks for more, nor is
// the garage's newest file and rejected.
const expiredWhere = (cutoff: Date): Prisma.ListingDraftWhereInput => ({
  OR: [
    { updatedAt: { lte: cutoff }, verificationFileId: null },
    {
      verificationFile: {
        OR: [
          { status: { notIn: ['more_requested', 'rejected'] } },
          { nextFile: { isNot: null }, status: 'rejected' },
        ],
      },
    },
  ],
  status: 'open',
});

// Once a day: drafts untouched for 90 days go, photos and documents included, and the
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
        verificationFileId: null,
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
      where: expiredWhere(cutoff),
    });
    for (const draft of expired) {
      await this.deleteOne(draft, cutoff).catch((error: unknown) =>
        this.failed('clean-up', draft.id, error),
      );
    }
  }

  // The claim, its key and the e-mail row are written together, so a second
  // worker or a second run never writes the same reminder again. The job goes
  // after the commit; one the queue refuses gives the claim back and keeps
  // its row unsent, so tomorrow's run queues that same row again.
  private async remindOne(draft: { id: string; language: string }, now: Date) {
    if (!this.webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    const issued = newToken();
    const job = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.listingDraft.updateMany({
        data: { remindedAt: now },
        where: { id: draft.id, remindedAt: null, status: 'open' },
      });
      if (count === 0) return null;
      await tx.listingDraftToken.create({
        data: {
          draftId: draft.id,
          hash: issued.hash,
          kind: 'reminder',
          sentAt: now,
        },
      });
      return this.notifications.writeToDraft(tx, 'LISTING_REMINDER', draft.id);
    });
    if (!job) return;
    const language = draft.language === 'en' ? 'en' : 'ro';
    try {
      await this.notifications.queueToDraft(
        job,
        continueLink(this.webUrl, language, issued.token),
        'keep',
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

  // The files first: a draft whose files stay is kept for the next run. A
  // copy shares keys with its garage's photos and documents; those stay.
  private async deleteOne(draft: { id: string }, cutoff: Date) {
    const row = await this.prisma.listingDraft.findUnique({
      select: { data: true },
      where: { id: draft.id },
    });
    const keys = keysOf(row?.data);
    const [photos, documents] = await Promise.all([
      this.prisma.garagePhoto.findMany({
        select: { fileKey: true },
        where: { fileKey: { in: keys } },
      }),
      this.prisma.legalDocument.findMany({
        select: { pages: true },
        where: { pages: { hasSome: keys } },
      }),
    ]);
    const held = new Set([
      ...photos.map((photo) => photo.fileKey),
      ...documents.flatMap((document) => document.pages),
    ]);
    for (const key of keys.filter((each) => !held.has(each))) {
      await this.storage.deleteWithCopies(key);
    }
    await this.prisma.listingDraft.deleteMany({
      where: { ...expiredWhere(cutoff), id: draft.id },
    });
  }

  private failed(what: string, id: string, error: unknown) {
    const reason = error instanceof Error ? error.name : 'unknown';
    this.logger.error(`listing draft ${what} failed for ${id}: ${reason}`);
  }
}
