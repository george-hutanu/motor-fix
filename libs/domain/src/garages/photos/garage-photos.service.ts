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

  // Replaces the gallery with `photos` in their order, the first the cover. A
  // photo kept keeps its row; the history records each photo removed, added
  // or moved, as the garage's own edit.
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
    const wanted = new Map(photos.map(({ key }, position) => [key, position]));
    const removed = before.filter((row) => !wanted.has(row.fileKey));
    const moved = before.filter(
      (row) =>
        wanted.has(row.fileKey) && wanted.get(row.fileKey) !== row.position,
    );
    const kept = new Set(before.map((row) => row.fileKey));
    await tx.garagePhoto.deleteMany({
      where: { id: { in: removed.map((row) => row.id) } },
    });
    // Out of the way first, past every position in use before or after, so
    // one photo per position holds at every step.
    const spare = Math.max(photos.length, ...before.map((r) => r.position + 1));
    for (const [at, row] of moved.entries()) {
      await tx.garagePhoto.update({
        data: { position: spare + at },
        where: { id: row.id },
      });
    }
    for (const row of moved) {
      await tx.garagePhoto.update({
        data: { position: wanted.get(row.fileKey) },
        where: { id: row.id },
      });
    }
    const added = await tx.garagePhoto.createManyAndReturn({
      data: photos
        .map(({ height, key, width }, position) => ({
          fileKey: key,
          garageId,
          height,
          position,
          width,
        }))
        .filter((row) => !kept.has(row.fileKey)),
      select: { fileKey: true, id: true, position: true },
    });

    const change = {
      actorId,
      actorRole: 'garage' as const,
      garageId,
      subjectType: 'garage_photo',
    };
    const entries: AuditEntry[] = [
      ...removed.map(({ fileKey, id, position }) => ({
        ...change,
        action: 'delete' as const,
        oldValue: { fileKey, position },
        subjectId: id,
      })),
      ...moved.map(({ fileKey, id, position }) => ({
        ...change,
        action: 'update' as const,
        field: 'position',
        newValue: wanted.get(fileKey),
        oldValue: position,
        subjectId: id,
      })),
      ...added.map(({ fileKey, id, position }) => ({
        ...change,
        action: 'create' as const,
        newValue: { fileKey, position },
        subjectId: id,
      })),
    ];
    await this.audit.recordMany(tx, entries);
  }
}
