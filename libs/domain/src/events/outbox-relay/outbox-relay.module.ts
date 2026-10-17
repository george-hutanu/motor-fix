import { observeQueue, queueTelemetry } from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { type EventConsumer, OutboxRelay } from './outbox-relay';
import { createPrisma } from '../../auth/prisma';
import { CdnPurgeSender, cdnPurgeHook } from '../../cache/cdn-purge/cdn-purge';
import type { PrismaClient } from '../../generated/prisma/client';
import { borrowStore, returnStore } from '../../store/store';

const RELAY_PRISMA = Symbol('RELAY_PRISMA');
const RELAY_REDIS = Symbol('RELAY_REDIS');
const RELAY_QUEUES = Symbol('RELAY_QUEUES');
const RELAY_CDN = Symbol('RELAY_CDN');

type Consumers = (Omit<EventConsumer, 'queue'> & { queue: Queue })[];

// A queue the relay hands each event of its kinds to, with its jobs' options.
interface RelayConsumer extends Pick<EventConsumer, 'kinds' | 'requeue'> {
  queue: string;
  jobs: JobsOptions;
}

interface RelayOptions {
  databaseUrl: string;
  redisUrl: string;
  consumers?: readonly RelayConsumer[];
  // The CDN's API key and pull zone: set, each purged page tag reaches it.
  cdn?: { apiKey: string; pullZoneId: string };
}

// The worker's outbox-relay. A Redis that is down fails each publish fast, so
// the batch rolls back and waits for the next poll.
@Module({})
export class OutboxRelayModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    private readonly relay: OutboxRelay,
    @Inject(RELAY_PRISMA) private readonly prisma: PrismaClient,
    @Inject(RELAY_REDIS) private readonly redis: Redis,
    @Inject(RELAY_QUEUES) private readonly queues: Consumers,
    @Inject(RELAY_CDN) private readonly cdn: CdnPurgeSender | undefined,
  ) {}

  static register(options: RelayOptions): DynamicModule {
    return {
      module: OutboxRelayModule,
      providers: [
        {
          provide: RELAY_PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        {
          provide: RELAY_REDIS,
          useFactory: () => borrowStore(options.redisUrl),
        },
        {
          provide: RELAY_QUEUES,
          // Fails fast like the publisher: the add runs inside the batch.
          // The relay runs in the worker only, so its queues are the ones
          // whose health it reports.
          useFactory: (): Consumers =>
            (options.consumers ?? []).map(
              ({ jobs, kinds, queue, requeue }) => ({
                kinds,
                queue: observed(
                  new Queue(queue, {
                    connection: {
                      commandTimeout: 2000,
                      enableOfflineQueue: false,
                      maxRetriesPerRequest: null,
                      url: options.redisUrl,
                    },
                    defaultJobOptions: jobs,
                    telemetry: queueTelemetry(),
                  }),
                ),
                requeue,
              }),
            ),
        },
        {
          inject: [RELAY_REDIS],
          provide: RELAY_CDN,
          useFactory: (redis: Redis) =>
            options.cdn ? new CdnPurgeSender(redis, options.cdn) : undefined,
        },
        {
          inject: [RELAY_PRISMA, RELAY_REDIS, RELAY_QUEUES],
          provide: OutboxRelay,
          useFactory: (prisma: PrismaClient, redis: Redis, queues: Consumers) =>
            new OutboxRelay(
              prisma,
              redis,
              queues,
              options.cdn ? cdnPurgeHook(redis) : undefined,
            ),
        },
      ],
    };
  }

  onModuleInit() {
    this.relay.start();
    this.cdn?.start();
  }

  async onApplicationShutdown() {
    await this.relay.stop();
    await this.cdn?.stop();
    for (const { queue } of this.queues) await queue.close();
    await returnStore(this.redis);
    await this.prisma.$disconnect();
  }
}

function observed(queue: Queue): Queue {
  observeQueue(queue);
  return queue;
}
