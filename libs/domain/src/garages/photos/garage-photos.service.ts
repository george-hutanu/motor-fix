import { Injectable } from '@nestjs/common';

import type { PhotoSize } from './listing-photos/listing-photos.service';
import type { Prisma } from '../../generated/prisma/client';

// The gallery of a garage, written by the sending story inside its own
// transaction from the draft's photos (sizes from ListingPhotosService).
@Injectable()
export class GaragePhotosService {
  async saveRows(
    tx: Prisma.TransactionClient,
    garageId: string,
    photos: PhotoSize[],
  ): Promise<void> {
    await tx.garagePhoto.createMany({
      data: photos.map(({ height, key, width }, position) => ({
        fileKey: key,
        garageId,
        height,
        position,
        width,
      })),
    });
  }
}
