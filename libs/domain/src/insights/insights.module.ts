import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';

import { writeSnapshot } from './platform-figures';
import { createPrisma } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';

export const INSIGHTS_QUEUE = 'insights';
const INSIGHTS_PRISMA = Symbol('INSIGHTS_PRISMA');
const INSIGHTS_JOBS = Symbol('INSIGHTS_JOBS');
const INSIGHTS_WORKER = Symbol('INSIGHTS_WORKER');

const SNAPSHOT = 'platform-daily';

interface InsightsOptions {
  databaseUrl: string;
  redisUrl: string;
}

// One scheduler under a fixed id, so every worker that starts upserts the
// same one. A missed or failed night is not run again: the deltas then show
// no line until the next month's first row.
@Module({})
export class InsightsModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Inject(INSIGHTS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(INSIGHTS_JOBS) private readonly jobs: Queue,
    @Inject(INSIGHTS_WORKER) private readonly worker: Worker,
  ) {}

  static registerWorker(options: InsightsOptions): DynamicModule {
    const logger = new Logger('Insights');
    return {
      module: InsightsModule,
      providers: [
        {
          provide: INSIGHTS_PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        {
          provide: INSIGHTS_JOBS,
          useFactory: () =>
            new Queue(INSIGHTS_QUEUE, {
              connection: { url: options.redisUrl },
            }),
        },
        {
          inject: [INSIGHTS_PRISMA],
          provide: INSIGHTS_WORKER,
          useFactory: (prisma: PrismaClient) => {
            const worker = new Worker(
              INSIGHTS_QUEUE,
              () => writeSnapshot(prisma, new Date()),
              {
                connection: {
                  maxRetriesPerRequest: null,
                  url: options.redisUrl,
                },
              },
            );
            worker.on('failed', (_, error) =>
              logger.error(`${SNAPSHOT} run failed: ${error.message}`),
            );
            return worker;
          },
        },
      ],
    };
  }

  async onApplicationBootstrap() {
    await this.jobs.upsertJobScheduler(
      SNAPSHOT,
      { pattern: '0 1 * * *', tz: 'Europe/Bucharest' },
      { name: SNAPSHOT, opts: { attempts: 1, removeOnComplete: true } },
    );
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
    await this.prisma.$disconnect();
  }
}
