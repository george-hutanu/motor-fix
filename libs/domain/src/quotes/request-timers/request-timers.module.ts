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
  REQUEST_TIMERS_JOBS,
  REQUEST_TIMERS_QUEUE,
  REQUEST_TIMERS_URL,
  type RequestTimerEvent,
  RequestTimers,
} from './request-timers';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';

const REQUEST_TIMERS_WORKER = Symbol('REQUEST_TIMERS_WORKER');

interface RequestTimersOptions {
  redisUrl: string;
  // The worker's NotificationsModule, whose service reminds the garage.
  notifications: DynamicModule;
  // The web app's address, for the messages' links.
  webUrl: string | undefined;
}

type RequestTimerJob = Job<RequestTimerEvent | { id?: string }>;

// The request-timers queue: the relay's request and quote events, which set
// and clear the timers or announce an expiry, and the timers and their sweep,
// which remind the waiting garages and expire requests and quotes.
@Module({})
export class RequestTimersModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    private readonly requests: RequestTimers,
    @Inject(REQUEST_TIMERS_JOBS) private readonly jobs: Queue,
    @Inject(REQUEST_TIMERS_WORKER) private readonly worker: Worker,
  ) {}

  static registerWorker(options: RequestTimersOptions): DynamicModule {
    return {
      imports: [options.notifications],
      module: RequestTimersModule,
      providers: [
        { provide: AUDIT_PORT, useClass: AuditService },
        { provide: REQUEST_TIMERS_URL, useValue: options.webUrl ?? '' },
        {
          provide: REQUEST_TIMERS_JOBS,
          useFactory: () => {
            const queue = new Queue(REQUEST_TIMERS_QUEUE, {
              connection: { maxRetriesPerRequest: null, url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
        RequestTimers,
        {
          inject: [RequestTimers],
          provide: REQUEST_TIMERS_WORKER,
          useFactory: (requests: RequestTimers) => {
            // Without the address only the messages stop; requests and
            // quotes still expire.
            if (!options.webUrl) {
              new Logger('RequestTimers').error(
                'PUBLIC_WEB_URL missing; request reminders and expiry notices are not sent',
              );
            }
            const worker = new Worker(
              REQUEST_TIMERS_QUEUE,
              (job: RequestTimerJob) =>
                inJob(job, () =>
                  job.name === 'event'
                    ? requests.onEvent(job as Job<RequestTimerEvent>)
                    : requests.timers.handle(job as Job<{ id?: string }>),
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
            logFinalFailure(worker, new Logger('RequestTimers'));
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
    await this.requests.timers.startSweep();
    void this.worker.run();
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
  }
}
