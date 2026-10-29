import { observeWorker, queueTelemetry } from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import {
  LIVE_RECORDINGS_QUEUE,
  LiveRecordings,
  type LiveStoppedJob,
} from './recordings';
import { createPrisma } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';
import { type LiveVideoConfig, providerFor } from '../live-video.module';

const LIVE_RECORDINGS_WORKER = Symbol('LIVE_RECORDINGS_WORKER');
const LIVE_RECORDINGS_PRISMA = Symbol('LIVE_RECORDINGS_PRISMA');

interface LiveRecordingsOptions {
  databaseUrl: string;
  redisUrl: string;
  liveVideo: LiveVideoConfig;
}

@Module({})
export class LiveRecordingsModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Inject(LIVE_RECORDINGS_WORKER) private readonly worker: Worker,
    @Inject(LIVE_RECORDINGS_PRISMA) private readonly prisma: PrismaClient,
  ) {}

  static registerWorker(options: LiveRecordingsOptions): DynamicModule {
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    return {
      module: LiveRecordingsModule,
      providers: [
        {
          provide: LIVE_RECORDINGS_PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        {
          inject: [LIVE_RECORDINGS_PRISMA],
          provide: LIVE_RECORDINGS_WORKER,
          useFactory: (prisma: PrismaClient) => {
            const logger = new Logger('LiveRecordings');
            const recordings = new LiveRecordings(
              prisma,
              providerFor(options.liveVideo),
              logger,
            );
            const worker = new Worker(
              LIVE_RECORDINGS_QUEUE,
              (job: Job) =>
                inJob(job, () => recordings.onEvent(job as LiveStoppedJob)),
              { autorun: false, connection, telemetry: queueTelemetry() },
            );
            logFinalFailure(worker, logger);
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  // Started with the application, not when compiled, so a test can hand the
  // handler its events itself.
  onApplicationBootstrap() {
    void this.worker.run();
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.prisma.$disconnect();
  }
}
