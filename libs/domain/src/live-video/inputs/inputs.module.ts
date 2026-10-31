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

import { LIVE_INPUTS_QUEUE, LiveInputs } from './inputs';
import { createPrisma } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';
import { type LiveVideoConfig, providerFor } from '../live-video.module';
import type { LiveStoppedJob } from '../recordings/recordings';

const LIVE_INPUTS_WORKER = Symbol('LIVE_INPUTS_WORKER');
const LIVE_INPUTS_PRISMA = Symbol('LIVE_INPUTS_PRISMA');

interface LiveInputsOptions {
  databaseUrl: string;
  redisUrl: string;
  liveVideo: LiveVideoConfig;
}

@Module({})
export class LiveInputsModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Inject(LIVE_INPUTS_WORKER) private readonly worker: Worker,
    @Inject(LIVE_INPUTS_PRISMA) private readonly prisma: PrismaClient,
  ) {}

  static registerWorker(options: LiveInputsOptions): DynamicModule {
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    return {
      module: LiveInputsModule,
      providers: [
        {
          provide: LIVE_INPUTS_PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        {
          inject: [LIVE_INPUTS_PRISMA],
          provide: LIVE_INPUTS_WORKER,
          useFactory: (prisma: PrismaClient) => {
            const logger = new Logger('LiveInputs');
            const inputs = new LiveInputs(
              prisma,
              providerFor(options.liveVideo),
              logger,
            );
            const worker = new Worker(
              LIVE_INPUTS_QUEUE,
              (job: Job) =>
                inJob(job, () => inputs.onEvent(job as LiveStoppedJob)),
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
