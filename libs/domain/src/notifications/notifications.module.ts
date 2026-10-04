import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationShutdown,
  Optional,
  type Provider,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { Brevo } from './brevo';
import { BrevoWebhookController } from './brevo-webhook.controller';
import type { EmailConfig } from './email-config';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor, retryDelay } from './notifications.processor';
import {
  EMAIL_FALLBACK,
  type EmailFallback,
  LIVE_PUBLISHER,
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_JOBS,
  NOTIFICATIONS_PRISMA,
  NOTIFICATIONS_QUEUE,
  NotificationsService,
} from './notifications.service';
import { NotificationPreferencesController } from './preferences.controller';
import { NotificationPreferencesService } from './preferences.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import { createPrisma, PRISMA } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';

interface NotificationsOptions {
  databaseUrl: string;
  redisUrl: string;
  email: EmailConfig;
}

const WORKER = Symbol('NOTIFICATIONS_WORKER');

// No channel takes over from a failed e-mail yet.
const noFallback: EmailFallback = async () => undefined;

function shared(options: NotificationsOptions, prisma: Provider): Provider[] {
  return [
    NotificationsService,
    prisma,
    { provide: NOTIFICATIONS_CONFIG, useValue: options.email },
    {
      provide: NOTIFICATIONS_JOBS,
      useFactory: () =>
        new Queue(NOTIFICATIONS_QUEUE, {
          connection: { url: options.redisUrl },
        }),
    },
    { provide: LIVE_PUBLISHER, useFactory: () => new Redis(options.redisUrl) },
    { provide: EMAIL_FALLBACK, useValue: noFallback },
    { provide: AUDIT_PORT, useClass: AuditService },
  ];
}

@Module({})
export class NotificationsModule implements OnApplicationShutdown {
  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(NOTIFICATIONS_JOBS) private readonly jobs: Queue,
    @Inject(LIVE_PUBLISHER) private readonly publisher: Redis,
    @Optional() @Inject(WORKER) private readonly worker?: Worker | null,
  ) {}

  // The API: the entry point, the admin test message, the Brevo webhook and
  // each person's message choices.
  // `auth` is the application's AuthModule, whose guard the test route uses.
  static register(
    options: NotificationsOptions,
    auth: DynamicModule,
  ): DynamicModule {
    return {
      controllers: [
        NotificationsController,
        BrevoWebhookController,
        NotificationPreferencesController,
      ],
      exports: [NotificationsService],
      imports: [auth],
      module: NotificationsModule,
      // One PostgreSQL pool per API process: the one AuthModule opened.
      providers: [
        ...shared(options, {
          provide: NOTIFICATIONS_PRISMA,
          useExisting: PRISMA,
        }),
        NotificationPreferencesService,
      ],
    };
  }

  // The worker: the same entry point plus the queue's consumer.
  static registerWorker(options: NotificationsOptions): DynamicModule {
    return {
      module: NotificationsModule,
      providers: [
        ...shared(options, {
          provide: NOTIFICATIONS_PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        }),
        NotificationsProcessor,
        {
          provide: Brevo,
          useFactory: () =>
            new Brevo({
              apiKey: options.email.apiKey ?? '',
              apiUrl: options.email.apiUrl,
            }),
        },
        {
          inject: [NotificationsProcessor],
          provide: WORKER,
          useFactory: async (processor: NotificationsProcessor) =>
            (await processor.ready())
              ? new Worker(
                  NOTIFICATIONS_QUEUE,
                  (job) => processor.handle(job),
                  {
                    concurrency: 10,
                    connection: {
                      maxRetriesPerRequest: null,
                      url: options.redisUrl,
                    },
                    settings: {
                      backoffStrategy: (attemptsMade) =>
                        retryDelay(attemptsMade - 1),
                    },
                  },
                )
              : null,
        },
      ],
    };
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.jobs.close();
    this.publisher.disconnect();
    // In the API the client is AuthModule's, which closes it.
    if (this.worker !== undefined) await this.prisma.$disconnect();
  }
}
