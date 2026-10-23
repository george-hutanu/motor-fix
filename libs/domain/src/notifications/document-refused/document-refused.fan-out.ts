import { DOCUMENT_KINDS, type EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import type { PrismaClient } from '../../generated/prisma/client';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';
import { documentLabel } from '../templates/document-refused';

export const DOCUMENT_REFUSED_QUEUE = 'document-refused';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const DOCUMENT_REFUSED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const DOCUMENT_REFUSED_CONSUMER = {
  jobs: DOCUMENT_REFUSED_RUN,
  kinds: ['document.refused'] as readonly EventKind[],
  queue: DOCUMENT_REFUSED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface DocumentRefusedEvent {
  id: string;
  // Unchecked: the relay passes the payload through as recorded.
  payload: { documentId?: unknown; garageId?: unknown };
}

const isKind = (kind: string): kind is (typeof DOCUMENT_KINDS)[number] =>
  (DOCUMENT_KINDS as readonly string[]).includes(kind);

// Tells a garage's owners which yearly document an admin refused and why,
// each in their own language. The kind and the note are read from the
// document, so one no longer refused tells nobody; the event id keeps a
// retry from building anything twice.
@Injectable()
export class DocumentRefusedFanOut {
  private readonly logger = new Logger('DocumentRefused');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(job: Pick<Job<DocumentRefusedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const { documentId, garageId } = payload;
    if (typeof documentId !== 'string' || typeof garageId !== 'string') {
      this.untold(documentId);
      return;
    }
    const document = await this.prisma.legalDocument.findFirst({
      select: { kind: true, refusalNote: true },
      where: {
        id: documentId,
        status: 'refused',
        verificationFile: { garageId },
      },
    });
    if (!document || !isKind(document.kind)) {
      this.untold(documentId);
      return;
    }
    const owners = await this.prisma.account.findMany({
      select: { id: true, language: true },
      where: {
        memberships: { some: { garageId, role: 'owner' } },
        status: { not: 'deleted' },
      },
    });
    for (const language of ['ro', 'en'] as const) {
      const recipients = owners
        .filter((owner) => (owner.language === 'en') === (language === 'en'))
        .map(({ id }) => id);
      if (recipients.length === 0) continue;
      await this.notifications.notify({
        eventId,
        garageId,
        kind: 'DOCUMENT_REFUSED',
        params: {
          dashboard: `${this.config.webUrl}/app/garage`,
          document: documentLabel(document.kind, language),
          note: document.refusalNote ?? '',
        },
        recipients,
        subjectId: documentId,
      });
    }
    this.logger.log(
      `document ${documentId} of garage ${garageId} refused, told to ${owners.length} owners`,
    );
  }

  private untold(documentId: unknown): void {
    this.logger.log(
      `document ${typeof documentId === 'string' ? documentId : '?'} refused: nobody told`,
    );
  }
}
