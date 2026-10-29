import { type MediaKind, mediaConfig } from '@motor-fix/contracts';

import type { MediaRetentionDeps } from './retention';
import { MEDIA_RETENTION } from './retention.config';
import type { AuditEntry } from '../../audit/audit.port';
import type { MediaItem } from '../../generated/prisma/client';
import { countMediaPurged } from '../media.metrics';
import { deleteFiles } from '../media.service';

const HOUR_MS = 3_600_000;
const PURGEABLE = ['visible', 'failed', 'removed'] as const;

// Romanian puts "de" between a number and its noun from twenty on.
const de = (n: number) => (n % 100 === 0 || n % 100 >= 20 ? ' de' : '');

export const purgedText = (count: number, days: number) =>
  `${count === 1 ? '1 fișier șters' : `${count}${de(count)} fișiere șterse`} după ${days}${de(days)} ${days === 1 ? 'zi' : 'zile'}`;

// An item whose upload never came within a day is failed, and so is one
// uploaded a day ago and still not converted (its queue job lost, or its
// worker killed past both tries): a conversion takes minutes. The purge
// then takes it when it is due, so no original is kept for ever.
async function failAbandoned({ prisma }: MediaRetentionDeps, now: Date) {
  const dayAgo = new Date(
    now.getTime() - MEDIA_RETENTION.stuckAfterHours * HOUR_MS,
  );
  const { count } = await prisma.mediaItem.updateMany({
    data: { status: 'failed' },
    where: {
      OR: [
        { sentAt: { lt: dayAgo }, uploadedAt: null },
        { uploadedAt: { lt: dayAgo } },
      ],
      status: 'processing',
    },
  });
  return count;
}

// One item in its own transaction: locked unless another run holds it,
// its files deleted, then marked purged. A delete that fails rolls the
// item back, and the next night tries again.
async function purgeOne(
  deps: MediaRetentionDeps,
  id: string,
  now: Date,
): Promise<MediaItem | null> {
  return deps.prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM media_item
        WHERE id = ${id}::uuid
          AND status IN ('visible', 'failed', 'removed')
          AND purge_after <= ${now}
        FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return null;
      const item = await tx.mediaItem.findUniqueOrThrow({ where: { id } });
      await deleteFiles(deps.storage, deps.provider, item);
      await tx.mediaItem.update({
        data: { purgedAt: now, status: 'purged' },
        where: { id },
      });
      return item;
    },
    { timeout: MEDIA_RETENTION.transactionMs },
  );
}

async function dueAfter(deps: MediaRetentionDeps, now: Date, after?: string) {
  return deps.prisma.mediaItem.findMany({
    orderBy: { id: 'asc' },
    select: { id: true },
    take: MEDIA_RETENTION.batch,
    where: {
      purgeAfter: { lte: now },
      status: { in: [...PURGEABLE] },
      ...(after && { id: { gt: after } }),
    },
  });
}

type Tally = Map<string, { garageId: string; count: number }>;

function tallied(tally: Tally, item: MediaItem) {
  const job = tally.get(item.jobId) ?? { count: 0, garageId: item.garageId };
  job.count += 1;
  tally.set(item.jobId, job);
  countMediaPurged(item.kind as MediaKind);
}

// Deletes every shown, failed or removed item past its purge date, and
// writes one audit entry per job for the night.
export async function purgeMedia(
  deps: MediaRetentionDeps,
  now: Date,
): Promise<number> {
  await failAbandoned(deps, now);
  const tally: Tally = new Map();
  // Pages by id; each page starts past the last, so it ends at an empty one.
  let due = await dueAfter(deps, now, undefined);
  while (due.length > 0) {
    for (const { id } of due) {
      const item = await purgeOne(deps, id, now).catch((error: unknown) => {
        deps.logger.error(
          `media ${id} not purged: ${error instanceof Error ? error.name : typeof error}`,
        );
        return null;
      });
      if (item) tallied(tally, item);
    }
    due = await dueAfter(deps, now, due.at(-1)?.id);
  }
  const days = mediaConfig().retentionDays;
  const entries: AuditEntry[] = [...tally].map(([jobId, job]) => ({
    action: 'delete',
    actorId: null,
    actorRole: 'system',
    garageId: job.garageId,
    jobId,
    kind: 'media.purged',
    subjectId: jobId,
    subjectType: 'job',
    text: purgedText(job.count, days),
  }));
  if (entries.length) {
    await deps.prisma.$transaction((tx) => deps.audit.recordMany(tx, entries));
  }
  const total = [...tally.values()].reduce((sum, job) => sum + job.count, 0);
  deps.logger.log(`media retention purged ${total}`);
  return total;
}
