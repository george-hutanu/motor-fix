import type { EventKind } from '@motor-fix/contracts';
import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { OutboxRelay } from './outbox-relay';
import { createPrisma } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';

const RELAY_PRISMA = Symbol('RELAY_PRISMA');
const RELAY_REDIS = Symbol('RELAY_REDIS');
const RELAY_QUEUES = Symbol('RELAY_QUEUES');

type Consumers = { kinds: readonly EventKind[]; queue: Queue }[];

// A queue the relay hands each event of its kinds to, with its jobs' options.
interface RelayConsumer {
  kinds: readonly EventKind[];
  queue: string;
  jobs: JobsOptions;
}

interface RelayOptions {
  databaseUrl: string;
  redisUrl: string;
  consumers?: readonly RelayConsumer[];
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
          useFactory: () => {
            const redis = new Redis(options.redisUrl, {
              commandTimeout: 2000,
              connectTimeout: 2000,
              enableOfflineQueue: false,
              maxRetriesPerRequest: 1,
            });
            // The relay logs a failed batch; the client's own errors add nothing.
            redis.on('error', () => undefined);
            return redis;
          },
        },
        {
          provide: RELAY_QUEUES,
          // Fails fast like the publisher: the add runs inside the batch.
          useFactory: (): Consumers =>
            (options.consumers ?? []).map(({ jobs, kinds, queue }) => ({
              kinds,
              queue: new Queue(queue, {
                connection: {
                  commandTimeout: 2000,
                  enableOfflineQueue: false,
                  maxRetriesPerRequest: 1,
                  url: options.redisUrl,
                },
                defaultJobOptions: jobs,
              }),
            })),
        },
        {
          inject: [RELAY_PRISMA, RELAY_REDIS, RELAY_QUEUES],
          provide: OutboxRelay,
          useFactory: (prisma: PrismaClient, redis: Redis, queues: Consumers) =>
            new OutboxRelay(prisma, redis, queues),
        },
      ],
    };
  }

  onModuleInit() {
    this.relay.start();
  }

  async onApplicationShutdown() {
    await this.relay.stop();
    for (const { queue } of this.queues) await queue.close();
    this.redis.disconnect();
    await this.prisma.$disconnect();
  }
}
