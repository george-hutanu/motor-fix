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
import { type Job, Queue, Worker } from 'bullmq';

import {
  MODERATION_TIMERS_JOBS,
  MODERATION_TIMERS_QUEUE,
  MODERATION_TIMERS_URL,
  type ModerationEvent,
  ModerationTimers,
} from './moderation-timers';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';

const MODERATION_TIMERS_WORKER = Symbol('MODERATION_TIMERS_WORKER');

interface ModerationTimersOptions {
  redisUrl: string;
  // The worker's NotificationsModule, whose service tells the admins.
  notifications: DynamicModule;
  // The web app's address, for the alert's and the reminder's link.
  webUrl: string | undefined;
}

type ModerationJob = Job<ModerationEvent | { id?: string }>;

// The moderation-timers queue: the relay's review.reported, review.decided
// and review.deleted events, and the 48-hour reminders and their sweep.
@Module({})
export class ModerationTimersModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    private readonly moderation: ModerationTimers,
    @Inject(MODERATION_TIMERS_JOBS) private readonly jobs: Queue,
    @Inject(MODERATION_TIMERS_WORKER) private readonly worker: Worker,
  ) {}

  static registerWorker(options: ModerationTimersOptions): DynamicModule {
    return {
      imports: [options.notifications],
      module: ModerationTimersModule,
      providers: [
        { provide: AUDIT_PORT, useClass: AuditService },
        { provide: MODERATION_TIMERS_URL, useValue: options.webUrl ?? '' },
        {
          provide: MODERATION_TIMERS_JOBS,
          useFactory: () => {
            const queue = new Queue(MODERATION_TIMERS_QUEUE, {
              connection: { maxRetriesPerRequest: null, url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
        ModerationTimers,
        {
          inject: [ModerationTimers],
          provide: MODERATION_TIMERS_WORKER,
          useFactory: (moderation: ModerationTimers) => {
            // Without the address the admins are not told; a report still
            // closes when its review is deleted.
            if (!options.webUrl) {
              new Logger('ModerationTimers').error(
                'PUBLIC_WEB_URL missing; review report alerts are not sent',
              );
            }
            const worker = new Worker(
              MODERATION_TIMERS_QUEUE,
              (job: ModerationJob) =>
                inJob(job, () =>
                  job.name === 'event'
                    ? moderation.onEvent(job as Job<ModerationEvent>)
                    : moderation.timers.handle(job as Job<{ id?: string }>),
                ),
              {
                autorun: false,
                connection: {
                  maxRetriesPerRequest: null,
                  url: options.redisUrl,
                },
                telemetry: queueTelemetry(),
              },
            );
            logFinalFailure(worker, new Logger('ModerationTimers'));
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  // Started with the application, not when compiled, so a test can run the
  // timers itself.
  async onApplicationBootstrap() {
    await this.moderation.timers.startSweep();
    void this.worker.run();
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
  }
}
