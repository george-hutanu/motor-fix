import { mediaConfig } from '@motor-fix/contracts';
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

import { MEDIA_PROCESSING, MEDIA_QUEUE } from './processing.config';
import { processMedia } from './processing.worker';
import { AuditService } from '../../audit/audit.service';
import { createPrisma } from '../../auth/prisma';
import { outbox } from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';
import { writeJobFailed } from '../../job-failures';
import { inJob } from '../../logging';
import { StorageService } from '../../storage/storage.service';
import { markFailed } from '../media.service';

const MEDIA_WORKER = Symbol('MEDIA_WORKER');
const MEDIA_GAUGES = Symbol('MEDIA_GAUGES');
const MEDIA_PRISMA = Symbol('MEDIA_PRISMA');

type Data = { mediaId: string };

// Converts the job photos and clips sent through the API, and the kept live
// recordings. StorageModule is global in the worker app. A conversion that
// failed on its last try marks the item failed; its original stays for the
// purge.
@Module({})
export class MediaProcessingModule implements OnApplicationShutdown {
  constructor(
    @Inject(MEDIA_WORKER) private readonly worker: Worker,
    @Inject(MEDIA_GAUGES) private readonly queue: Queue | undefined,
    @Inject(MEDIA_PRISMA) private readonly prisma: PrismaClient,
  ) {}

  static register(options: {
    databaseUrl: string;
    redisUrl: string;
  }): DynamicModule {
    const logger = new Logger('MediaProcessing');
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    return {
      module: MediaProcessingModule,
      providers: [
        {
          provide: MEDIA_PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        {
          provide: MEDIA_GAUGES,
          useFactory: () => {
            if (!telemetryStarted()) return undefined;
            const queue = new Queue(MEDIA_QUEUE, { connection });
            observeQueue(queue);
            return queue;
          },
        },
        {
          inject: [StorageService, MEDIA_PRISMA],
          provide: MEDIA_WORKER,
          useFactory: (storage: StorageService, prisma: PrismaClient) => {
            const deps = {
              audit: new AuditService(),
              events: outbox,
              prisma,
              storage,
            };
            const worker = new Worker<Data>(
              MEDIA_QUEUE,
              (job) => inJob(job, () => processMedia(deps, job.data.mediaId)),
              {
                concurrency: mediaConfig().workerConcurrency,
                connection,
                lockDuration: MEDIA_PROCESSING.lockDurationMs,
                telemetry: queueTelemetry(),
              },
            );
            worker.on('failed', (job: Job<Data> | undefined, error: Error) => {
              if (!job || !isFinalFailure(job, error)) return;
              inJob(job, () =>
                logger.error(
                  `media ${job.data.mediaId} failed to convert: ${error.message}`,
                ),
              );
              writeJobFailed(MEDIA_QUEUE, job, error);
              void markFailed(prisma, job.data.mediaId).catch(
                (cause: unknown) =>
                  logger.error(
                    `media ${job.data.mediaId} not marked failed: ${cause instanceof Error ? cause.message : 'error'}`,
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
    await this.prisma.$disconnect();
  }
}
