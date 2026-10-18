import { Inject, Injectable } from '@nestjs/common';

import type { PhotoSize } from './listing-photos/listing-photos.service';
import {
  AUDIT_PORT,
  type AuditEntry,
  type AuditPort,
} from '../../audit/audit.port';
import type { Prisma } from '../../generated/prisma/client';

// The gallery of a garage, written by the sending story inside its own
// transaction from the draft's photos (sizes from ListingPhotosService).
@Injectable()
export class GaragePhotosService {
  constructor(@Inject(AUDIT_PORT) private readonly audit: AuditPort) {}

  // Replaces the gallery with `photos` in their order, the first the cover;
  // the history records each photo removed or added, as the garage's own edit.
  async saveRows(
    tx: Prisma.TransactionClient,
    garageId: string,
    photos: PhotoSize[],
    actorId: string,
  ): Promise<void> {
    const before = await tx.garagePhoto.findMany({
      select: { fileKey: true, id: true, position: true },
      where: { garageId },
    });
    await tx.garagePhoto.deleteMany({ where: { garageId } });
    const rows = await tx.garagePhoto.createManyAndReturn({
      data: photos.map(({ height, key, width }, position) => ({
        fileKey: key,
        garageId,
        height,
        position,
        width,
      })),
      select: { fileKey: true, id: true, position: true },
    });

    const wanted = new Set(photos.map(({ key }) => key));
    const had = new Set(before.map(({ fileKey }) => fileKey));
    const change = {
      actorId,
      actorRole: 'garage' as const,
      garageId,
      subjectType: 'garage_photo',
    };
    const entries: AuditEntry[] = [
      ...before
        .filter(({ fileKey }) => !wanted.has(fileKey))
        .map(({ fileKey, id, position }) => ({
          ...change,
          action: 'delete' as const,
          oldValue: { fileKey, position },
          subjectId: id,
        })),
      ...rows
        .filter(({ fileKey }) => !had.has(fileKey))
        .map(({ fileKey, id, position }) => ({
          ...change,
          action: 'create' as const,
          newValue: { fileKey, position },
          subjectId: id,
        })),
    ];
    await this.audit.recordMany(tx, entries);
  }
}
