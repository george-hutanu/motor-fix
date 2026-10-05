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

import { BellController } from './bell.controller';
import { BellService } from './bell.service';
import { Brevo } from './brevo';
import { BrevoWebhookController } from './brevo-webhook.controller';
import type { EmailConfig } from './email-config';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor, retryDelay } from './notifications.processor';
import {
  LIVE_PUBLISHER,
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_JOBS,
  NOTIFICATIONS_PRISMA,
  NOTIFICATIONS_QUEUE,
  NotificationsService,
} from './notifications.service';
import { PHONE_CONFIG, type PhoneConfig } from './phone-config';
import { NotificationPreferencesController } from './preferences.controller';
import { NotificationPreferencesService } from './preferences.service';
import { PUSH_SENDER, PushSender } from './push';
import { PUSH_CONFIG, type PushConfig } from './push-config';
import { PushSubscriptionsController } from './push-subscriptions.controller';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import { createPrisma, PRISMA } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';

interface NotificationsOptions {
  databaseUrl: string;
  redisUrl: string;
  email: EmailConfig;
  // The VAPID identity; null (the default) leaves push off.
  push?: PushConfig | null;
}

const WORKER = Symbol('NOTIFICATIONS_WORKER');

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
    { provide: PUSH_CONFIG, useValue: options.push ?? null },
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

  // The API: the entry point, each person's bell, the admin test message,
  // the Brevo webhook and each person's message choices.
  // `auth` is the application's AuthModule, whose guard the test route uses.
  static register(
    options: NotificationsOptions,
    auth: DynamicModule,
  ): DynamicModule {
    return {
      controllers: [
        BellController,
        NotificationsController,
        BrevoWebhookController,
        NotificationPreferencesController,
        NewsController,
        PushSubscriptionsController,
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
        BellService,
        NotificationPreferencesService,
        NewsService,
        PushSubscriptionsService,
      ],
    };
  }

  // The worker: the same entry point plus the queue's consumer, which also
  // sends SMS, WhatsApp and push. The reminders send through its service and
  // share its PostgreSQL pool.
  static registerWorker(
    options: NotificationsOptions & { phone: PhoneConfig },
  ): DynamicModule {
    return {
      exports: [NotificationsService, NOTIFICATIONS_PRISMA],
      module: NotificationsModule,
      providers: [
        ...shared(options, {
          provide: NOTIFICATIONS_PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        }),
        NotificationsProcessor,
        { provide: PHONE_CONFIG, useValue: options.phone },
        {
          provide: PUSH_SENDER,
          useValue: options.push ? new PushSender(options.push) : null,
        },
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
