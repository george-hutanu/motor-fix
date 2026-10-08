import {
  isFinalFailure,
  observeWorker,
  queueTelemetry,
} from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { LISTING_PHOTOS_QUEUE } from './listing-photos.service';
import { processPhoto } from './photo-processing';
import { inJob } from '../../logging';
import { StorageService } from '../../storage/storage.service';

const PHOTOS_WORKER = Symbol('PHOTOS_WORKER');

// Keys are `garage_photo/<draft id>/<id>`; the log names the draft, never
// whose it is.
const draftOf = (key: string) => key.split('/')[1] ?? 'unknown';

// Makes the copies of each confirmed listing photo. StorageModule is global
// in the worker app.
@Module({})
export class ListingPhotosWorkerModule implements OnApplicationShutdown {
  constructor(@Inject(PHOTOS_WORKER) private readonly worker: Worker) {}

  static register(options: { redisUrl: string }): DynamicModule {
    const logger = new Logger('ListingPhotos');
    return {
      module: ListingPhotosWorkerModule,
      providers: [
        {
          inject: [StorageService],
          provide: PHOTOS_WORKER,
          useFactory: (storage: StorageService) => {
            const worker = new Worker<{ key: string }>(
              LISTING_PHOTOS_QUEUE,
              (job) => inJob(job, () => processPhoto(storage, job.data.key)),
              {
                connection: {
                  maxRetriesPerRequest: null,
                  url: options.redisUrl,
                },
                telemetry: queueTelemetry(),
              },
            );
            worker.on('failed', (job: Job | undefined, error: Error) => {
              if (!job || !isFinalFailure(job, error)) return;
              inJob(job, () =>
                logger.error(
                  `photo processing failed for draft ${draftOf(job.data.key)}: ${job.data.key}: ${error.message}`,
                ),
              );
            });
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  async onApplicationShutdown() {
    await this.worker.close();
  }
}
