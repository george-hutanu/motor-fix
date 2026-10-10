import {
  observeQueue,
  observeWorker,
  queueTelemetry,
} from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { writeDailyFigures } from './daily-figures/daily-figures';
import { placeGarages } from './place-garages';
import { writeSnapshot } from './platform-figures';
import { writeResponseStats } from './response-stats/response-stats';
import { createPrisma } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';
import { logFinalFailure } from '../job-failures';
import { inJob } from '../logging';
import { type PlacesConfig, providerFor } from '../places/places.module';

export const INSIGHTS_QUEUE = 'insights';
const INSIGHTS_PRISMA = Symbol('INSIGHTS_PRISMA');
const INSIGHTS_JOBS = Symbol('INSIGHTS_JOBS');
const INSIGHTS_WORKER = Symbol('INSIGHTS_WORKER');
const INSIGHTS_REDIS = Symbol('INSIGHTS_REDIS');

const SNAPSHOT = 'platform-daily';
const RESPONSE_STATS = 'response-stats';
const PROFILE_VIEWS = 'profile-views';
const NIGHTLY = { pattern: '0 1 * * *', tz: 'Europe/Bucharest' };

interface InsightsOptions {
  databaseUrl: string;
  // The address look-up that places the garages with no city each night.
  places: PlacesConfig;
  redisUrl: string;
}

// One scheduler per job under a fixed id, so every worker that starts
// upserts the same ones. A missed or failed snapshot is not run again: the
// deltas then show no line until the next month's first row. The response
// figures are retried, since every profile shows them, and so are the profile
// views, whose counters outlive one missed night.
@Module({})
export class InsightsModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Inject(INSIGHTS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(INSIGHTS_JOBS) private readonly jobs: Queue,
    @Inject(INSIGHTS_WORKER) private readonly worker: Worker,
    @Inject(INSIGHTS_REDIS) private readonly redis: Redis,
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
          useFactory: () => {
            const queue = new Queue(INSIGHTS_QUEUE, {
              connection: { url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
        {
          // The profile view counters the API writes.
          provide: INSIGHTS_REDIS,
          // A Redis that stops answering fails the night, which is retried.
          useFactory: () => {
            const redis = new Redis(options.redisUrl, {
              commandTimeout: 10_000,
              connectTimeout: 5000,
              maxRetriesPerRequest: 1,
            });
            redis.on('error', (error) =>
              logger.error(`profile view counters: ${error.message}`),
            );
            return redis;
          },
        },
        {
          inject: [INSIGHTS_PRISMA, INSIGHTS_REDIS],
          provide: INSIGHTS_WORKER,
          useFactory: (prisma: PrismaClient, redis: Redis) => {
            const places = providerFor(options.places);
            const run: Record<string, () => Promise<unknown>> = {
              [PROFILE_VIEWS]: () =>
                writeDailyFigures(prisma, redis, new Date()),
              [RESPONSE_STATS]: async () => {
                const { computed, written } = await writeResponseStats(
                  prisma,
                  new Date(),
                );
                logger.log(
                  `${RESPONSE_STATS} computed ${computed}, written ${written}`,
                );
              },
              [SNAPSHOT]: async () => {
                await placeGarages(prisma, places);
                return writeSnapshot(prisma, new Date());
              },
            };
            const worker = new Worker(
              INSIGHTS_QUEUE,
              (job) =>
                inJob(job, async () => {
                  const handler = Object.hasOwn(run, job.name)
                    ? run[job.name]
                    : undefined;
                  if (!handler) throw new Error(`unknown job ${job.name}`);
                  return handler();
                }),
              {
                connection: {
                  maxRetriesPerRequest: null,
                  url: options.redisUrl,
                },
                telemetry: queueTelemetry(),
              },
            );
            logFinalFailure(worker, logger);
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  async onApplicationBootstrap() {
    await this.jobs.upsertJobScheduler(SNAPSHOT, NIGHTLY, {
      name: SNAPSHOT,
      opts: { attempts: 1, removeOnComplete: true, removeOnFail: 10 },
    });
    // Response figures: three attempts; profile views: three retries (143-FR-012).
    for (const [name, attempts] of [
      [RESPONSE_STATS, 3],
      [PROFILE_VIEWS, 4],
    ] as const) {
      await this.jobs.upsertJobScheduler(name, NIGHTLY, {
        name,
        opts: {
          attempts,
          backoff: { delay: 60_000, type: 'exponential' },
          removeOnComplete: true,
          removeOnFail: 10,
        },
      });
    }
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
    await this.redis.quit();
    await this.prisma.$disconnect();
  }
}
