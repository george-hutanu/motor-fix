import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';

import { OutboxRelay } from './outbox-relay';
import { createPrisma } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';

const RELAY_PRISMA = Symbol('RELAY_PRISMA');
const RELAY_REDIS = Symbol('RELAY_REDIS');

interface RelayOptions {
  databaseUrl: string;
  redisUrl: string;
}

// The worker's outbox-relay. A Redis that is down fails each publish fast, so
// the batch rolls back and waits for the next poll.
@Module({})
export class OutboxRelayModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    private readonly relay: OutboxRelay,
    @Inject(RELAY_PRISMA) private readonly prisma: PrismaClient,
    @Inject(RELAY_REDIS) private readonly redis: Redis,
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
          inject: [RELAY_PRISMA, RELAY_REDIS],
          provide: OutboxRelay,
          useFactory: (prisma: PrismaClient, redis: Redis) =>
            new OutboxRelay(prisma, redis),
        },
      ],
    };
  }

  onModuleInit() {
    this.relay.start();
  }

  async onApplicationShutdown() {
    await this.relay.stop();
    this.redis.disconnect();
    await this.prisma.$disconnect();
  }
}
