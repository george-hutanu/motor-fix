import { observeQueue, queueTelemetry } from '@motor-fix/observability';
import { type DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { GaragePhotosService } from './garage-photos.service';
import { ListingPhotosController } from './listing-photos.controller';
import {
  LISTING_PHOTOS_JOBS,
  LISTING_PHOTOS_QUEUE,
  ListingPhotosService,
} from './listing-photos.service';

// Apart from GaragesModule, whose specs run without storage: `garages` is
// the application's GaragesModule, for the drafts' token rule.
@Module({})
export class ListingPhotosModule {
  static register(
    options: { redisUrl: string },
    garages: DynamicModule,
  ): DynamicModule {
    return {
      controllers: [ListingPhotosController],
      exports: [GaragePhotosService, ListingPhotosService],
      imports: [garages],
      module: ListingPhotosModule,
      providers: [
        GaragePhotosService,
        ListingPhotosService,
        {
          provide: LISTING_PHOTOS_JOBS,
          useFactory: () => {
            const queue = new Queue(LISTING_PHOTOS_QUEUE, {
              connection: { url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
      ],
    };
  }
}
