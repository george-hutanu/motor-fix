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
  Optional,
} from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import { SupportContactController } from './contact/contact.controller';
import { SUPPORT_MESSAGES_QUEUE } from './delivery/delivery.consumer';
import {
  SupportDelivery,
  type SupportMessageEvent,
} from './delivery/delivery.handler';
import { countUnsent, observeUnsent } from './delivery/gauge';
import { SupportMessagesController } from './messages/messages.controller';
import { SupportMessagesService } from './messages/messages.service';
import { SupportThrottle, SupportThrottleGuard } from './messages/throttle';
import { SUPPORT_CONFIG, type SupportConfig } from './support-config';
import { AUTH_REDIS } from '../auth/attempts';
import type { PrismaClient } from '../generated/prisma/client';
import { logFinalFailure } from '../job-failures';
import { inJob } from '../logging';
import { Brevo } from '../notifications/brevo/brevo';
import type { EmailConfig } from '../notifications/email-config';
import { NOTIFICATIONS_PRISMA } from '../notifications/notifications.service';

const SUPPORT_RUNNER = Symbol('SUPPORT_RUNNER');

interface SupportWorkerOptions {
  // The worker's NotificationsModule, for its database client.
  notifications: DynamicModule;
  email: EmailConfig;
  support: SupportConfig;
  redisUrl: string;
}

// The worker's side: the queue's worker and the unsent gauge, stopped with
// the application.
interface Runner {
  worker: Worker | null;
  queue: Queue;
  stopGauge: () => void;
}

// Contact MotorFix. In the API: the form's endpoint and the support address,
// needing the global AuthModule for its database, Redis and event port. In
// the worker: the two e-mails of each stored message.
@Module({})
export class SupportModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Optional() @Inject(SUPPORT_RUNNER) private readonly runner?: Runner,
  ) {}

  static register(config: SupportConfig): DynamicModule {
    return {
      controllers: [SupportContactController, SupportMessagesController],
      module: SupportModule,
      providers: [
        { provide: SUPPORT_CONFIG, useValue: config },
        SupportMessagesService,
        SupportThrottleGuard,
        {
          inject: [AUTH_REDIS],
          provide: SupportThrottle,
          useFactory: (redis: Redis) => new SupportThrottle(redis),
        },
      ],
    };
  }

  static registerWorker(options: SupportWorkerOptions): DynamicModule {
    return {
      imports: [options.notifications],
      module: SupportModule,
      providers: [
        {
          inject: [NOTIFICATIONS_PRISMA],
          provide: SUPPORT_RUNNER,
          useFactory: (prisma: PrismaClient): Runner => {
            const connection = {
              maxRetriesPerRequest: null,
              url: options.redisUrl,
            };
            const queue = new Queue(SUPPORT_MESSAGES_QUEUE, {
              connection,
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            const stopGauge = observeUnsent(() => countUnsent(prisma));
            if (!options.email.webUrl) {
              new Logger('Support').error(
                'PUBLIC_WEB_URL missing; support messages wait in their queue',
              );
              return { queue, stopGauge, worker: null };
            }
            const delivery = new SupportDelivery(
              prisma,
              new Brevo({
                apiKey: options.email.apiKey ?? '',
                apiUrl: options.email.apiUrl,
              }),
              options.email,
              options.support,
            );
            const worker = new Worker(
              SUPPORT_MESSAGES_QUEUE,
              (job: Job<SupportMessageEvent>) =>
                inJob(job, () => delivery.handle(job)),
              { autorun: false, connection, telemetry: queueTelemetry() },
            );
            observeWorker(worker);
            logFinalFailure(worker, new Logger('Support'));
            return { queue, stopGauge, worker };
          },
        },
      ],
    };
  }

  // Started with the application, not when compiled.
  onApplicationBootstrap() {
    if (this.runner?.worker) void this.runner.worker.run();
  }

  async onApplicationShutdown() {
    if (!this.runner) return;
    this.runner.stopGauge();
    await this.runner.worker?.close();
    await this.runner.queue.close();
  }
}
