import {
  type FilePurpose,
  MEDIA_LIMITS,
  MEDIA_REFUSALS,
  type MediaFileAddressDto,
  type MediaFileVariant,
  type MediaItemDto,
  type MediaKind,
  type MediaListDto,
  type MediaRefusal,
  type MediaUploadAddressDto,
  type MediaUploadRequestDto,
  mediaConfig,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Queue } from 'bullmq';

import { countMediaItem } from './media.metrics';
import { mediaRefused } from './media.refusals';
import { purgeAfter } from './media.state';
import { MEDIA_PROCESSING } from './processing/processing.config';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import type { Actor } from '../auth/policy';
import { PRISMA } from '../auth/prisma';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import { featureOn } from '../garages/features/feature-on';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import type { JobStatus } from '../generated/prisma/enums';
import {
  LIVE_VIDEO_PROVIDER,
  type LiveVideoProvider,
} from '../live-video/providers/live-video.provider';
import { StorageService } from '../storage/storage.service';

export const MEDIA_JOBS = Symbol('MEDIA_JOBS');

const FEATURE = 'live_media';

const PURPOSE: Record<'photo' | 'clip', FilePurpose> = {
  clip: 'media_clip',
  photo: 'media_photo',
};

type Item = Prisma.MediaItemGetPayload<object>;

interface JobRow {
  id: string;
  garage_id: string;
  driver_id: string;
  mechanic_id: string | null;
  mechanic_account: string | null;
  status: JobStatus;
  handed_over: boolean;
}

// What a caller may do with a job's media: the owner and the job's mechanic
// send and see everything, the job's driver sees what is visible or
// removed, the rest of the garage is refused, and anyone else finds
// nothing there.
type Right = 'staff' | 'driver' | 'forbidden' | 'none';

export function rightOn(actor: Actor, job: JobRow): Right {
  if (actor.role === 'driver') {
    return job.driver_id === actor.accountId ? 'driver' : 'none';
  }
  if (!actor.garageId || actor.garageId !== job.garage_id) return 'none';
  if (actor.role === 'garage') return 'staff';
  if (actor.role === 'mechanic' && job.mechanic_account === actor.accountId) {
    return 'staff';
  }
  return actor.role === 'mechanic' || actor.role === 'receptionist'
    ? 'forbidden'
    : 'none';
}

export async function jobRow(
  db: Pick<PrismaClient, '$queryRaw'>,
  jobId: string,
): Promise<JobRow | undefined> {
  const [job] = await db.$queryRaw<JobRow[]>`
    SELECT j.id, j.garage_id, j.driver_id, j.mechanic_id,
           m.account_id AS mechanic_account, j.status,
           j.handed_over_at IS NOT NULL AS handed_over
    FROM job j LEFT JOIN mechanic m ON m.id = j.mechanic_id
    WHERE j.id = ${jobId}::uuid`;
  return job;
}

export const itemDto = (item: Item): MediaItemDto => ({
  caption: item.caption,
  hasThumbnail: item.thumbnailKey !== null,
  id: item.id,
  jobId: item.jobId,
  kind: item.kind,
  removedAt: item.removedAt?.toISOString() ?? null,
  seconds: item.seconds,
  senderId: item.senderId,
  sentAt: item.sentAt.toISOString(),
  status: item.status,
});

export interface MediaDeps {
  prisma: PrismaClient;
  audit: AuditPort;
  events: EventPort;
}

export interface Converted {
  fileKey: string | null;
  thumbnailKey: string | null;
  seconds?: number;
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

// Shows a converted item: it moves only from processing, so a second worker
// run or a late retry changes nothing; its event and audit entry are
// written with the move, once (FR-008).
export async function markVisible(
  deps: MediaDeps,
  mediaId: string,
  converted: Converted,
): Promise<boolean> {
  const shown = await deps.prisma.$transaction(async (tx) => {
    const moved = await tx.mediaItem.updateMany({
      data: {
        fileKey: converted.fileKey,
        status: 'visible',
        thumbnailKey: converted.thumbnailKey,
        ...(converted.seconds !== undefined && { seconds: converted.seconds }),
      },
      where: { id: mediaId, status: 'processing' },
    });
    if (moved.count === 0) return null;
    const item = await tx.mediaItem.findUniqueOrThrow({
      where: { id: mediaId },
    });
    await announce(deps, tx, item);
    return item;
  });
  if (shown) countMediaItem(shown.kind, 'visible');
  return shown !== null;
}

async function announce(
  deps: MediaDeps,
  tx: Prisma.TransactionClient,
  item: Item,
) {
  const job = await tx.job.findUniqueOrThrow({
    select: { driverId: true, mechanicId: true },
    where: { id: item.jobId },
  });
  await deps.events.record(tx, {
    audience: {
      driverAccountId: job.driverId,
      garageId: item.garageId,
      mechanicId: job.mechanicId,
      type: 'job',
    },
    kind: 'media.added',
    payload: { jobId: item.jobId, kind: item.kind, mediaId: item.id },
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

// A conversion that failed for good; the original stays for the purge.
export async function markFailed(
  prisma: PrismaClient,
  mediaId: string,
): Promise<boolean> {
  const item = await prisma.mediaItem.findUnique({
    select: { kind: true },
    where: { id: mediaId },
  });
  const moved = await prisma.mediaItem.updateMany({
    data: { status: 'failed' },
    where: { id: mediaId, status: 'processing' },
  });
  if (item && moved.count > 0) countMediaItem(item.kind, 'failed');
  return moved.count > 0;
}

const codeOf = (error: HttpException): string | undefined =>
  (error.getResponse() as { code?: string }).code;

const isMediaRefusal = (code: string | undefined): code is MediaRefusal =>
  MEDIA_REFUSALS.includes(code as MediaRefusal);

// A job's photos, clips and kept recordings: sending, completing, reading
// and the seams the live service and the account deletion call.
@Injectable()
export class MediaService implements OnModuleDestroy {
  private readonly logger = new Logger('Media');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    @Inject(LIVE_VIDEO_PROVIDER) private readonly provider: LiveVideoProvider,
    @Inject(MEDIA_JOBS) private readonly jobs: Queue,
    private readonly storage: StorageService,
  ) {}

  async onModuleDestroy() {
    await this.jobs.close();
  }

  // FR-003, FR-004: the right, then the switch, then the job's state, then
  // the file; the item exists only once its upload address does.
  async requestUpload(
    actor: Actor,
    jobId: string,
    body: MediaUploadRequestDto,
  ): Promise<MediaUploadAddressDto> {
    return this.refusing(body.kind, jobId, async () => {
      const job = await this.sendable(actor, jobId, body);
      const upload = await this.storageCall(actor, () =>
        this.storage.createUpload(
          PURPOSE[body.kind],
          jobId,
          body.contentType,
          body.sizeBytes,
          body.checksum,
        ),
      );
      const sentAt = new Date();
      const item = await this.prisma.mediaItem.create({
        data: {
          caption: body.caption ?? null,
          contentType: body.contentType,
          garageId: job.garage_id,
          jobId,
          kind: body.kind,
          originalKey: upload.key,
          purgeAfter: purgeAfter(sentAt, mediaConfig().retentionDays),
          seconds: body.kind === 'clip' ? (body.seconds ?? null) : null,
          senderId: actor.accountId,
          sentAt,
          sizeBytes: BigInt(body.sizeBytes),
        },
      });
      return { item: itemDto(item), upload };
    });
  }

  // FR-005: only the sender completes; a second call changes nothing.
  async complete(actor: Actor, mediaId: string): Promise<MediaItemDto> {
    const item = await this.prisma.mediaItem.findUnique({
      where: { id: mediaId },
    });
    if (!item || item.senderId !== actor.accountId || item.kind === 'live') {
      throw new NotFoundException();
    }
    if (item.uploadedAt) {
      if (item.status === 'processing') await this.enqueue(item.id);
      return itemDto(item);
    }
    if (item.status !== 'processing' || !item.originalKey) {
      throw mediaRefused(HttpStatus.CONFLICT, 'invalid_state', actor);
    }
    const kind = item.kind;
    const key = await this.storageCall(actor, () =>
      this.storage.confirmUpload(
        item.originalKey as string,
        PURPOSE[kind],
        item.jobId,
      ),
    ).catch(async (error: unknown) => {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.UNPROCESSABLE_ENTITY
      ) {
        await markFailed(this.prisma, item.id);
      }
      throw error;
    });
    const done = await this.prisma.mediaItem.update({
      data: { originalKey: key, uploadedAt: new Date() },
      where: { id: item.id },
    });
    await this.enqueue(done.id);
    return itemDto(done);
  }

  // FR-009: by role alone, whatever the switch says.
  async list(actor: Actor, jobId: string): Promise<MediaListDto> {
    const job = await jobRow(this.prisma, jobId);
    const right = job ? rightOn(actor, job) : 'none';
    if (right === 'none') throw new NotFoundException();
    if (right === 'forbidden') {
      throw mediaRefused(HttpStatus.FORBIDDEN, 'forbidden', actor);
    }
    const items = await this.prisma.mediaItem.findMany({
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
      where: {
        jobId,
        status:
          right === 'driver'
            ? { in: ['visible', 'removed'] }
            : { not: 'purged' },
      },
    });
    return { items: items.map(itemDto) };
  }

  // FR-010: a 5-minute address, signed without asking the store.
  async fileAddress(
    actor: Actor,
    mediaId: string,
    variant: MediaFileVariant = 'file',
  ): Promise<MediaFileAddressDto> {
    const item = await this.readable(actor, mediaId);
    const minutes = MEDIA_LIMITS.downloadUrlMinutes;
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    if (item.providerRef) {
      if (variant === 'thumbnail') throw new NotFoundException();
      const ref = item.providerRef;
      const url = await this.storageCall(actor, async () =>
        this.provider.viewUrl(ref, expiresAt),
      );
      return { expiresAt: expiresAt.toISOString(), url };
    }
    const key = variant === 'thumbnail' ? item.thumbnailKey : item.fileKey;
    if (!key) throw new NotFoundException();
    const url = await this.storageCall(actor, () =>
      this.storage.createDownloadUrl(key, undefined, 'inline', minutes),
    );
    return { expiresAt: expiresAt.toISOString(), url };
  }

  // FR-011: a kept live recording joins the job's media whatever the switch
  // or the job's state; one the provider holds is visible at once.
  async registerRecording(
    jobId: string,
    file: { key: string } | { providerRef: string },
    seconds: number,
  ): Promise<MediaItemDto> {
    const job = await jobRow(this.prisma, jobId);
    if (!job) throw new NotFoundException();
    const sentAt = new Date();
    const data = {
      contentType: 'video/mp4',
      garageId: job.garage_id,
      jobId,
      kind: 'live' as const,
      purgeAfter: purgeAfter(sentAt, mediaConfig().retentionDays),
      seconds,
      sentAt,
      // The recording's size is the provider's or the live service's to
      // know; the media item does not need it.
      sizeBytes: 0n,
    };
    if ('providerRef' in file) {
      const item = await this.prisma.$transaction(async (tx) => {
        const created = await tx.mediaItem.create({
          data: {
            ...data,
            providerRef: file.providerRef,
            status: 'visible',
            uploadedAt: sentAt,
          },
        });
        await announce(this.deps(), tx, created);
        return created;
      });
      countMediaItem('live', 'visible');
      return itemDto(item);
    }
    const item = await this.prisma.mediaItem.create({
      data: { ...data, originalKey: file.key, uploadedAt: sentAt },
    });
    await this.enqueue(item.id);
    return itemDto(item);
  }

  // FR-012: the files go first; a delete that fails leaves the item as it
  // was and says so.
  async removeItem(mediaId: string, actor: Actor): Promise<void> {
    const item = await this.prisma.mediaItem.findUnique({
      where: { id: mediaId },
    });
    if (!item) throw new NotFoundException();
    if (item.status !== 'visible') {
      throw mediaRefused(HttpStatus.CONFLICT, 'invalid_state', actor);
    }
    await deleteFiles(this.storage, this.provider, item);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.mediaItem.updateMany({
        data: { removedAt: new Date(), status: 'removed' },
        where: { id: mediaId, status: 'visible' },
      });
      if (moved.count === 0) {
        throw mediaRefused(HttpStatus.CONFLICT, 'invalid_state', actor);
      }
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'status',
        garageId: item.garageId,
        jobId: item.jobId,
        newValue: 'removed',
        oldValue: 'visible',
        subjectId: item.id,
        subjectType: 'media_item',
      });
    });
  }

  private deps(): MediaDeps {
    return { audit: this.audit, events: this.events, prisma: this.prisma };
  }

  // A job in work the caller may send this file to.
  private async sendable(
    actor: Actor,
    jobId: string,
    body: MediaUploadRequestDto,
  ): Promise<JobRow> {
    const job = await this.staffJob(actor, jobId);
    if (job.handed_over) {
      throw mediaRefused(HttpStatus.CONFLICT, 'job_handed_over', actor);
    }
    if (job.status === 'to_do' || job.status === 'cancelled') {
      throw mediaRefused(HttpStatus.CONFLICT, 'job_not_in_work', actor);
    }
    if (
      body.kind === 'clip' &&
      (body.seconds ?? 0) > MEDIA_LIMITS.clipSeconds
    ) {
      throw mediaRefused(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'clip_too_long',
        actor,
      );
    }
    return job;
  }

  // A visible item the caller may read.
  private async readable(actor: Actor, mediaId: string): Promise<Item> {
    const item = await this.prisma.mediaItem.findUnique({
      where: { id: mediaId },
    });
    const job = item && (await jobRow(this.prisma, item.jobId));
    const right = job ? rightOn(actor, job) : 'none';
    if (!item || right === 'none') throw new NotFoundException();
    if (right === 'forbidden') {
      throw mediaRefused(HttpStatus.FORBIDDEN, 'forbidden', actor);
    }
    if (item.status !== 'visible') throw new NotFoundException();
    return item;
  }

  // A job the caller may send media to, live media on.
  private async staffJob(actor: Actor, jobId: string): Promise<JobRow> {
    const job = await jobRow(this.prisma, jobId);
    const right = job ? rightOn(actor, job) : 'none';
    if (
      !job ||
      right === 'none' ||
      !(await featureOn(this.prisma, job.garage_id, FEATURE))
    ) {
      throw new NotFoundException();
    }
    if (right !== 'staff') {
      throw mediaRefused(HttpStatus.FORBIDDEN, 'forbidden', actor);
    }
    return job;
  }

  private async enqueue(mediaId: string) {
    await this.jobs.add(
      'convert',
      { mediaId },
      {
        attempts: MEDIA_PROCESSING.attempts,
        backoff: { delay: MEDIA_PROCESSING.backoffMs, type: 'exponential' },
        jobId: mediaId,
        removeOnComplete: true,
      },
    );
  }

  // A refusal the store gave, in the caller's language; anything else the
  // store or the signer threw means storage is unavailable.
  private async storageCall<T>(
    actor: Actor,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof HttpException) {
        const code = codeOf(error);
        throw isMediaRefusal(code)
          ? mediaRefused(error.getStatus(), code, actor)
          : error;
      }
      this.logger.warn(
        `media storage unavailable: ${error instanceof Error ? error.name : 'error'}`,
      );
      throw mediaRefused(
        HttpStatus.SERVICE_UNAVAILABLE,
        'storage_unavailable',
        actor,
      );
    }
  }

  // Counts and logs a refused request by its code and the job's id alone.
  private async refusing<T>(
    kind: MediaKind,
    jobId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) {
        countMediaItem(kind, 'refused');
        const code =
          error instanceof NotFoundException
            ? 'not_found'
            : (codeOf(error) ?? 'error');
        this.logger.warn(`media upload refused: ${code} job ${jobId}`);
      }
      throw error;
    }
  }
}

// Deletes an item's files wherever they are held: the original with its
// converted copy and thumbnail, or the provider's recording.
export async function deleteFiles(
  storage: Pick<StorageService, 'deleteObject' | 'deleteWithCopies'>,
  provider: Pick<LiveVideoProvider, 'deleteRecording'>,
  item: Pick<Item, 'originalKey' | 'fileKey' | 'thumbnailKey' | 'providerRef'>,
) {
  if (item.providerRef) await provider.deleteRecording(item.providerRef);
  if (item.originalKey) await storage.deleteWithCopies(item.originalKey);
  for (const key of [item.fileKey, item.thumbnailKey]) {
    if (key && !key.startsWith(`${item.originalKey}.`)) {
      await storage.deleteObject(key);
    }
  }
}
