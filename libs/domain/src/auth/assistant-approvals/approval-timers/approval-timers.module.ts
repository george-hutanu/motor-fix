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
  APPROVAL_TIMERS_JOBS,
  APPROVAL_TIMERS_QUEUE,
  APPROVAL_TIMERS_URL,
  ApprovalTimers,
  type RequestedEvent,
} from './approval-timers';
import { AuditService } from '../../../audit/audit.service';
import { outbox } from '../../../events/event.port';
import type { PrismaClient } from '../../../generated/prisma/client';
import { logFinalFailure } from '../../../job-failures';
import { inJob } from '../../../logging';
import { NOTIFICATIONS_PRISMA } from '../../../notifications/notifications.service';
import { AssistantApprovals } from '../assistant-approvals';

const APPROVAL_TIMERS_WORKER = Symbol('APPROVAL_TIMERS_WORKER');

interface ApprovalTimersOptions {
  redisUrl: string;
  // The worker's NotificationsModule, whose service tells the account.
  notifications: DynamicModule;
  // The web app's address, for the link to the approval.
  webUrl: string | undefined;
}

type ApprovalTimerJob = Job<RequestedEvent | { id?: string }>;

// The assistant-approval-timers queue: the relay's
// assistant_approval.requested events, which tell the account and set the
// expiry timer, and the timers and their sweep, which expire it.
@Module({})
export class ApprovalTimersModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    private readonly approvalTimers: ApprovalTimers,
    @Inject(APPROVAL_TIMERS_JOBS) private readonly jobs: Queue,
    @Inject(APPROVAL_TIMERS_WORKER) private readonly worker: Worker | null,
  ) {}

  static registerWorker(options: ApprovalTimersOptions): DynamicModule {
    return {
      imports: [options.notifications],
      module: ApprovalTimersModule,
      providers: [
        { provide: APPROVAL_TIMERS_URL, useValue: options.webUrl ?? '' },
        {
          provide: APPROVAL_TIMERS_JOBS,
          useFactory: () => {
            const queue = new Queue(APPROVAL_TIMERS_QUEUE, {
              connection: { maxRetriesPerRequest: null, url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
        {
          inject: [NOTIFICATIONS_PRISMA],
          provide: AssistantApprovals,
          useFactory: (prisma: PrismaClient) =>
            new AssistantApprovals(prisma, new AuditService(), outbox),
        },
        ApprovalTimers,
        {
          inject: [ApprovalTimers],
          provide: APPROVAL_TIMERS_WORKER,
          useFactory: (approvalTimers: ApprovalTimers) => {
            if (!options.webUrl) {
              new Logger('ApprovalTimers').error(
                'PUBLIC_WEB_URL missing; assistant approval messages wait in their queue',
              );
              return null;
            }
            const worker = new Worker(
              APPROVAL_TIMERS_QUEUE,
              (job: ApprovalTimerJob) =>
                inJob(job, () =>
                  job.name === 'event'
                    ? approvalTimers.onRequested(job as Job<RequestedEvent>)
                    : approvalTimers.timers.handle(job as Job<{ id?: string }>),
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
            logFinalFailure(worker, new Logger('ApprovalTimers'));
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
    if (!this.worker) return;
    await this.approvalTimers.timers.startSweep();
    void this.worker.run();
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.jobs.close();
  }
}
