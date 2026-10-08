import {
  DOWNLOAD_URL_MINUTES,
  isListingDraftData,
  type ListingPhotoDto,
  type ListingPhotosDto,
  PHOTOS_MAX,
  type PhotoUploadAddressDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Queue } from 'bullmq';

import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { StorageService } from '../../../storage/storage.service';
import { ListingDraftsService } from '../../listing-drafts/listing-drafts.service';

export const LISTING_PHOTOS_QUEUE = 'listing-photos';
export const LISTING_PHOTOS_JOBS = Symbol('LISTING_PHOTOS_JOBS');
const PURPOSE = 'garage_photo';

export interface PhotoSize {
  key: string;
  width?: number;
  height?: number;
}

const full = () =>
  refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'photos_full',
    `A draft holds at most ${PHOTOS_MAX} photos`,
  );
const submitted = () =>
  refusal(
    HttpStatus.CONFLICT,
    'draft_submitted',
    'This listing was already sent',
  );
const held = () =>
  refusal(HttpStatus.CONFLICT, 'file_missing', 'The draft holds this photo');
const filesOf = (data: unknown) =>
  isListingDraftData(data) ? (data.files ?? []) : [];

// The photos of a listing draft: the browser uploads straight to storage
// with an address issued here, and the draft keeps the confirmed keys in
// its data, in the owner's order. The worker makes the copies.
@Injectable()
export class ListingPhotosService implements OnApplicationShutdown {
  private readonly logger = new Logger('ListingPhotosService');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly drafts: ListingDraftsService,
    private readonly storage: StorageService,
    @Inject(LISTING_PHOTOS_JOBS) private readonly jobs: Queue,
  ) {}

  async uploadAddress(
    id: string,
    token: string | undefined,
    file: { contentType: string; size: number },
  ): Promise<PhotoUploadAddressDto> {
    const draft = await this.drafts.open(id, token);
    if (filesOf(draft.data).length >= PHOTOS_MAX) throw full();
    return this.storage.createUpload(PURPOSE, id, file.contentType, file.size);
  }

  // The cap is checked again, binding, under the row lock: two confirms at
  // once count one after the other. A refused upload is deleted.
  async confirm(
    id: string,
    token: string | undefined,
    incoming: string,
  ): Promise<ListingPhotoDto> {
    const ours = incoming.startsWith(`incoming/${PURPOSE}/${id}/`);
    const draft = await this.drafts.open(id, token).catch(async (error) => {
      if (ours && error instanceof HttpException && error.getStatus() === 409)
        await this.discard(incoming);
      throw error;
    });
    if (filesOf(draft.data).length >= PHOTOS_MAX) {
      if (ours) await this.discard(incoming);
      throw full();
    }
    const key = await this.storage.confirmUpload(incoming, PURPOSE, id);
    let kept = false;
    const position = await this.prisma
      .$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status === 'submitted') throw submitted();
        const files = filesOf(row.data);
        // A second confirm that passed storage alongside the first.
        if (files.includes(key)) {
          kept = true;
          throw held();
        }
        if (files.length >= PHOTOS_MAX) throw full();
        await tx.listingDraft.update({
          data: { data: { ...(row.data as object), files: [...files, key] } },
          where: { id },
        });
        return files.length;
      })
      .catch(async (error) => {
        if (!kept) {
          await this.storage.deleteWithCopies(key).catch(() => undefined);
        }
        throw error;
      });
    await this.queue(key);
    return { key, position, processed: false };
  }

  async list(id: string, token: string | undefined): Promise<ListingPhotosDto> {
    const draft = await this.drafts.open(id, token);
    const photos = await Promise.all(
      filesOf(draft.data).map(async (key, position) => {
        const size = await this.sizeOf(key);
        if (size.width === undefined) {
          if (!(await this.jobs.getJob(key))) await this.queue(key);
          return { key, position, processed: false };
        }
        const thumbnailUrl = await this.storage.createDownloadUrl(
          this.storage.derivedKey(key, 'thumb'),
          undefined,
          'inline',
          DOWNLOAD_URL_MINUTES,
        );
        return { ...size, position, processed: true, thumbnailUrl };
      }),
    );
    return { photos };
  }

  // The key leaves the draft even when storage cannot delete the file: the
  // orphan is logged rather than kept in the owner's photos.
  async remove(id: string, token: string | undefined, key: string) {
    await this.drafts.open(id, token);
    await this.prisma.$transaction(async (tx) => {
      const row = await locked(tx, id);
      if (row.status === 'submitted') throw submitted();
      const files = filesOf(row.data);
      if (!files.includes(key)) {
        throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such photo');
      }
      await tx.listingDraft.update({
        data: {
          data: {
            ...(row.data as object),
            files: files.filter((each) => each !== key),
          },
        },
        where: { id },
      });
    });
    await this.storage.deleteWithCopies(key).catch((error: unknown) => {
      this.logger.error(
        `photo of draft ${id} left in storage: ${key}: ${String(error)}`,
      );
    });
  }

  // For the sending story: the size of each processed photo, in order.
  describe(keys: string[]): Promise<PhotoSize[]> {
    return Promise.all(keys.map((key) => this.sizeOf(key)));
  }

  private async sizeOf(key: string): Promise<PhotoSize> {
    const meta = await this.storage.metadataOf(
      this.storage.derivedKey(key, 'thumb'),
    );
    if (!meta?.['width'] || !meta['height']) return { key };
    return {
      height: Number(meta['height']),
      key,
      width: Number(meta['width']),
    };
  }

  // A lost job is added again by the next read, so a failure here only logs.
  private async queue(key: string) {
    await this.jobs
      .add(
        'process',
        { key },
        {
          attempts: 3,
          backoff: { delay: 5000, type: 'exponential' },
          jobId: key,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      )
      .catch((error: unknown) => {
        this.logger.error(`photo job not queued for ${key}: ${String(error)}`);
      });
  }

  async onApplicationShutdown() {
    await this.jobs.close();
  }

  private discard(key: string) {
    return this.storage.deleteObject(key).catch((error: unknown) => {
      this.logger.warn(`could not delete ${key}: ${String(error)}`);
    });
  }
}

async function locked(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM listing_draft WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.listingDraft.findUniqueOrThrow({ where: { id } });
}
