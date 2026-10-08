import {
  isFinalFailure,
  observeQueue,
  observeWorker,
  queueTelemetry,
  telemetryStarted,
} from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';

import { LISTING_PHOTOS_QUEUE } from './listing-photos.service';
import { inJob } from '../../../logging';
import { StorageService } from '../../../storage/storage.service';
import { processPhoto } from '../photo-processing';

const PHOTOS_WORKER = Symbol('PHOTOS_WORKER');
const PHOTOS_QUEUE = Symbol('PHOTOS_QUEUE');

// Keys are `garage_photo/<draft id>/<id>`; the log names the draft, never
// whose it is.
const draftOf = (key: string) => key.split('/')[1] ?? 'unknown';

// Makes the copies of each confirmed listing photo. StorageModule is global
// in the worker app. The queue is held only for its gauges, so the worker
// reports this queue as it reports the others; with telemetry off there is
// none.
@Module({})
export class ListingPhotosWorkerModule implements OnApplicationShutdown {
  constructor(
    @Inject(PHOTOS_WORKER) private readonly worker: Worker,
    @Inject(PHOTOS_QUEUE) private readonly queue: Queue | undefined,
  ) {}

  static register(options: { redisUrl: string }): DynamicModule {
    const logger = new Logger('ListingPhotos');
    return {
      module: ListingPhotosWorkerModule,
      providers: [
        {
          provide: PHOTOS_QUEUE,
          useFactory: () => {
            if (!telemetryStarted()) return undefined;
            const queue = new Queue(LISTING_PHOTOS_QUEUE, {
              connection: { url: options.redisUrl },
            });
            observeQueue(queue);
            return queue;
          },
        },
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
    await this.queue?.close();
  }
}
