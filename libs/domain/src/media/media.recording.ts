import { type MediaAddedPayload, mediaConfig } from '@motor-fix/contracts';

import { countMediaItem } from './media.metrics';
import { purgeAfter } from './media.state';
import type { AuditPort } from '../audit/audit.port';
import type { EventPort } from '../events/event.port';
import type { Prisma } from '../generated/prisma/client';

type Item = Prisma.MediaItemGetPayload<object>;

export interface AnnounceDeps {
  audit: AuditPort;
  events: EventPort;
}

// The role a sender acted in: the job's garage's mechanic, else its owner.
async function senderRole(
  tx: Prisma.TransactionClient,
  item: Pick<Item, 'garageId' | 'senderId'>,
) {
  if (!item.senderId) return 'system' as const;
  const mechanic = await tx.mechanic.findFirst({
    select: { id: true },
    where: { accountId: item.senderId, garageId: item.garageId },
  });
  return mechanic ? ('mechanic' as const) : ('garage' as const);
}

export async function announce(
  deps: AnnounceDeps,
  tx: Prisma.TransactionClient,
  item: Item,
) {
  const job = await tx.job.findUniqueOrThrow({
    select: { driverId: true, mechanicId: true },
    where: { id: item.jobId },
  });
  const payload: MediaAddedPayload = {
    jobId: item.jobId,
    kind: item.kind,
    mediaId: item.id,
  };
  await deps.events.record(tx, {
    audience: {
      driverAccountId: job.driverId,
      garageId: item.garageId,
      mechanicId: job.mechanicId,
      type: 'job',
    },
    kind: 'media.added',
    payload,
    subjectId: item.jobId,
  });
  await deps.audit.record(tx, {
    action: 'create',
    actorId: item.senderId,
    actorRole: await senderRole(tx, item),
    garageId: item.garageId,
    jobId: item.jobId,
    kind: 'media.added',
    newValue: item.kind,
    subjectId: item.id,
    subjectType: 'media_item',
  });
}

// A kept live recording joins the job's media inside the caller's
// transaction, visible at once: the provider holds and plays it.
export async function registerLiveRecording(
  tx: Prisma.TransactionClient,
  deps: AnnounceDeps,
  input: {
    jobId: string;
    garageId: string;
    providerRef: string;
    seconds: number;
    sentAt: Date;
  },
): Promise<Item> {
  const item = await tx.mediaItem.create({
    data: {
      contentType: 'video/mp4',
      garageId: input.garageId,
      jobId: input.jobId,
      kind: 'live',
      providerRef: input.providerRef,
      purgeAfter: purgeAfter(input.sentAt, mediaConfig().retentionDays),
      seconds: input.seconds,
      sentAt: input.sentAt,
      // The recording's size is the provider's to know; the item does not
      // need it.
      sizeBytes: 0n,
      status: 'visible',
      uploadedAt: input.sentAt,
    },
  });
  await announce(deps, tx, item);
  countMediaItem('live', 'visible');
  return item;
}
