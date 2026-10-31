import {
  type GaragePhotosDto,
  type GaragePhotoUploadDto,
  PHOTOS_MAX,
  type PhotoUploadAddressDto,
  type PhotoUploadRequestDto,
  PUBLIC_IMAGE_URL_MINUTES,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { notFound, refusal } from '../../../auth/http-refusal';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import type { PrismaClient } from '../../../generated/prisma/client';
import { RateLimits } from '../../../rate-limit/rate-limit.service';
import { StorageService } from '../../../storage/storage.service';
import {
  assertGarageOwner,
  noGarage,
} from '../../garage-brands/garage-brands.service';
import { ListingPhotosService } from '../listing-photos/listing-photos.service';

const PURPOSE = 'garage_photo';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A garage drivers cannot see is not edited: gone when suspended, unknown
// until approved.
export function assertListed(status: string) {
  if (status === 'suspended') {
    throw refusal(HttpStatus.GONE, 'gone', 'This garage is no longer listed');
  }
  if (status !== 'approved') throw noGarage();
}

// The owner's gallery: its read, and the uploads a save will add. Every
// file is the garage's own: kept under `garage_photo/{garageId}/`.
@Injectable()
export class OwnerPhotosService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
    private readonly photos: ListingPhotosService,
    private readonly limits: RateLimits,
  ) {}

  async list(actor: Actor, garageId: string): Promise<GaragePhotosDto> {
    await this.assertReadable(actor, garageId);
    return this.answer(garageId);
  }

  async uploadAddress(
    actor: Actor,
    garageId: string,
    file: PhotoUploadRequestDto,
  ): Promise<PhotoUploadAddressDto> {
    await this.assertWritable(actor, garageId);
    await this.limits.take('uploadUrl', garageId);
    const rows = await this.prisma.garagePhoto.count({ where: { garageId } });
    if (rows >= PHOTOS_MAX) {
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'photos_full',
        `A gallery holds at most ${PHOTOS_MAX} photos`,
      );
    }
    return this.storage.createUpload(
      PURPOSE,
      garageId,
      file.contentType,
      file.size,
      file.checksum,
    );
  }

  // Keeps an upload under the garage and queues its copies. A key confirmed
  // before answers the same photo, so a retried confirm costs nothing.
  async confirm(
    actor: Actor,
    garageId: string,
    key: string,
  ): Promise<GaragePhotoUploadDto> {
    await this.assertWritable(actor, garageId);
    const prefix = `incoming/${PURPOSE}/${garageId}/`;
    const id = key.startsWith(prefix) ? key.slice(prefix.length) : '';
    if (!UUID.test(id)) throw notFound('No such upload');
    const final = this.keyOf(garageId, id);
    if (await this.storage.metadataOf(final)) {
      const [size] = await this.photos.describe([final]);
      return { key: final, processed: size?.width !== undefined };
    }
    const kept = await this.storage.confirmUpload(key, PURPOSE, garageId);
    await this.photos.queue(kept);
    return { key: kept, processed: false };
  }

  async upload(
    actor: Actor,
    garageId: string,
    id: string,
  ): Promise<GaragePhotoUploadDto> {
    await this.assertReadable(actor, garageId);
    const key = this.keyOf(garageId, id);
    if (!(await this.storage.metadataOf(key))) {
      throw notFound('No such upload');
    }
    const [size] = await this.photos.describe([key]);
    if (size?.width === undefined || size.height === undefined) {
      return { key, processed: false };
    }
    return {
      height: size.height,
      key,
      processed: true,
      thumbnailUrl: await this.thumbnailOf(key),
      width: size.width,
    };
  }

  // An upload the owner dropped before saving; a gallery photo goes only
  // through the save, which records it.
  async removeUpload(actor: Actor, garageId: string, id: string) {
    await this.assertWritable(actor, garageId);
    const key = this.keyOf(garageId, id);
    const held = await this.prisma.garagePhoto.findUnique({
      select: { id: true },
      where: { fileKey: key },
    });
    if (held) {
      throw refusal(
        HttpStatus.CONFLICT,
        'photo_in_gallery',
        'The photo is in the gallery; remove it by saving the gallery',
      );
    }
    if (!(await this.storage.metadataOf(key))) {
      throw notFound('No such upload');
    }
    await this.storage.deleteWithCopies(key);
  }

  // The gallery in order with its stamp; never a key.
  async answer(garageId: string): Promise<GaragePhotosDto> {
    const [garage, rows] = await Promise.all([
      this.prisma.garage.findUnique({
        select: { profileVersion: true },
        where: { id: garageId },
      }),
      this.prisma.garagePhoto.findMany({
        orderBy: { position: 'asc' },
        select: {
          caption: true,
          fileKey: true,
          height: true,
          id: true,
          position: true,
          width: true,
        },
        where: { garageId },
      }),
    ]);
    if (!garage) throw noGarage();
    const photos = await Promise.all(
      rows.map(async (row) => ({
        caption: row.caption ?? null,
        height: row.height ?? undefined,
        id: row.id,
        position: row.position,
        processed: true,
        thumbnailUrl: await this.thumbnailOf(row.fileKey),
        width: row.width ?? undefined,
      })),
    );
    return { photos, version: String(garage.profileVersion) };
  }

  keyOf(garageId: string, id: string) {
    return `${PURPOSE}/${garageId}/${id}`;
  }

  private thumbnailOf(key: string) {
    return this.storage.createDownloadUrl(
      this.storage.derivedKey(key, 'thumb'),
      undefined,
      'inline',
      PUBLIC_IMAGE_URL_MINUTES,
    );
  }

  // A suspended garage's owner still reads; only the writes answer 410.
  private async assertReadable(actor: Actor, garageId: string) {
    assertGarageOwner(actor, garageId);
    const status = await this.statusOf(garageId);
    if (status !== 'suspended') assertListed(status);
  }

  private async assertWritable(actor: Actor, garageId: string) {
    assertGarageOwner(actor, garageId);
    assertListed(await this.statusOf(garageId));
  }

  private async statusOf(garageId: string): Promise<string> {
    const garage = await this.prisma.garage.findUnique({
      select: { status: true },
      where: { id: garageId },
    });
    if (!garage) throw noGarage();
    return garage.status;
  }
}
