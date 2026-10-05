import {
  type BeforeApplicationShutdown,
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';

import { loadGarageAccess } from './garage-access';
import { LiveController } from './live.controller';
import { LIVE_CHANNEL, LiveHub } from './live.hub';
import { PRISMA } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';

const SUBSCRIBER = Symbol('LIVE_SUBSCRIBER');

interface EventsOptions {
  redisUrl: string;
}

// A Redis that is down never closes a stream: the subscriber keeps retrying
// and resubscribes.
function subscriber(url: string) {
  const logger = new Logger('Live');
  const redis = new Redis(url, { connectTimeout: 2000, lazyConnect: true });
  let reported = false;
  redis.on('error', (error: Error) => {
    if (reported) return;
    reported = true;
    logger.warn(`live subscriber cannot reach Redis: ${error.message}`);
  });
  redis.on('ready', () => {
    reported = false;
  });
  return redis;
}

@Module({})
export class EventsModule
  implements OnModuleInit, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger('Live');

  constructor(
    private readonly hub: LiveHub,
    @Inject(SUBSCRIBER) private readonly subscriber: Redis,
  ) {}

  static register(options: EventsOptions): DynamicModule {
    return {
      controllers: [LiveController],
      exports: [LiveHub],
      module: EventsModule,
      providers: [
        {
          provide: SUBSCRIBER,
          useFactory: () => subscriber(options.redisUrl),
        },
        {
          inject: [PRISMA],
          provide: LiveHub,
          useFactory: (prisma: PrismaClient) =>
            new LiveHub(loadGarageAccess(prisma)),
        },
      ],
    };
  }

  onModuleInit() {
    this.subscriber.on('message', (_channel: string, message: string) =>
      this.hub
        .deliver(message)
        .catch((error: Error) =>
          this.logger.error(`live event dropped: ${error.message}`),
        ),
    );
    // Not awaited: the API starts, and streams open, whether Redis answers or not.
    this.subscriber
      .subscribe(LIVE_CHANNEL)
      .catch((error: Error) =>
        this.logger.error(
          `live updates are off on this copy: ${error.message}`,
        ),
      );
  }

  beforeApplicationShutdown() {
    this.hub.shutdown();
  }

  onApplicationShutdown() {
    this.subscriber.disconnect();
  }
}
