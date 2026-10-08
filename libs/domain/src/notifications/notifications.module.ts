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
  type OnApplicationShutdown,
  Optional,
  type Provider,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { BellController } from './bell/bell.controller';
import { BellService } from './bell/bell.service';
import { Brevo } from './brevo/brevo';
import { BrevoWebhookController } from './brevo/brevo-webhook.controller';
import type { EmailConfig } from './email-config';
import { NewsController } from './news/news.controller';
import {
  NEWS_QUEUE,
  NEWS_TOKEN_SECRET,
  type NewsEvent,
  NewsFanOut,
} from './news/news.fan-out';
import { NewsService } from './news/news.service';
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
import { NotificationPreferencesController } from './preferences/preferences.controller';
import { NotificationPreferencesService } from './preferences/preferences.service';
import { PUSH_SENDER, PushSender } from './push/push';
import { PUSH_CONFIG, type PushConfig } from './push/push-config';
import { PushSubscriptionsController } from './push/push-subscriptions/push-subscriptions.controller';
import { PushSubscriptionsService } from './push/push-subscriptions/push-subscriptions.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import { createPrisma, PRISMA } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';
import { logFinalFailure } from '../job-failures';
import { inJob } from '../logging';

interface NotificationsOptions {
  databaseUrl: string;
  redisUrl: string;
  email: EmailConfig;
  // The VAPID identity; null (the default) leaves push off.
  push?: PushConfig | null;
}

const WORKER = Symbol('NOTIFICATIONS_WORKER');
const NEWS_WORKER = Symbol('NEWS_WORKER');

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
          telemetry: queueTelemetry(),
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
    @Optional()
    @Inject(NEWS_WORKER)
    private readonly newsWorker?: Worker | null,
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
  // sends SMS, WhatsApp and push, and the monthly news run. The reminders send
  // through its service and share its PostgreSQL pool. News needs the API's
  // token secret and the web address for its links; without them the runs wait.
  static registerWorker(
    options: NotificationsOptions & {
      phone: PhoneConfig;
      tokenSecret?: string;
    },
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
          inject: [
            NotificationsProcessor,
            NotificationsService,
            NOTIFICATIONS_JOBS,
          ],
          provide: WORKER,
          useFactory: async (
            processor: NotificationsProcessor,
            service: NotificationsService,
            jobs: Queue,
          ) => {
            if (!(await processor.ready())) return null;
            observeQueue(jobs);
            await service
              .scheduleRequeue()
              .catch((error) =>
                new Logger('Notifications').error(
                  `the re-queue sweep is not scheduled: ${String(error)}`,
                ),
              );
            const worker = new Worker(
              NOTIFICATIONS_QUEUE,
              (job) => inJob(job, () => processor.handle(job)),
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
                telemetry: queueTelemetry(),
              },
            );
            observeWorker(worker);
            logFinalFailure(worker, new Logger('Notifications'));
            return worker;
          },
        },
        NewsFanOut,
        { provide: NEWS_TOKEN_SECRET, useValue: options.tokenSecret ?? '' },
        {
          inject: [NewsFanOut],
          provide: NEWS_WORKER,
          useFactory: (fanOut: NewsFanOut) => {
            const missing = [
              !options.tokenSecret && 'AUTH_TOKEN_SECRET',
              !options.email.webUrl && 'PUBLIC_WEB_URL',
            ].filter(Boolean);
            if (missing.length > 0) {
              new Logger('News').error(
                `${missing.join(' and ')} missing; news runs wait in their queue`,
              );
              return null;
            }
            const worker = new Worker<NewsEvent>(
              NEWS_QUEUE,
              (job) => inJob(job, () => fanOut.handle(job)),
              {
                connection: {
                  maxRetriesPerRequest: null,
                  url: options.redisUrl,
                },
                telemetry: queueTelemetry(),
              },
            );
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  async onApplicationShutdown() {
    await this.newsWorker?.close();
    await this.worker?.close();
    await this.jobs.close();
    this.publisher.disconnect();
    // In the API the client is AuthModule's, which closes it.
    if (this.worker !== undefined) await this.prisma.$disconnect();
  }
}
