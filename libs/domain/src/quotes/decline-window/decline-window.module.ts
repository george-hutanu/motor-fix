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
  DECLINE_WINDOW_JOBS,
  DECLINE_WINDOW_QUEUE,
  DECLINE_WINDOW_URL,
  type DeclinedEvent,
  DeclineWindow,
} from './decline-window';
import { inJob } from '../../logging';

const DECLINE_WINDOW_WORKER = Symbol('DECLINE_WINDOW_WORKER');

interface DeclineWindowOptions {
  redisUrl: string;
  // The worker's NotificationsModule, whose service tells the driver.
  notifications: DynamicModule;
  // The web app's address, for the link to the driver's request.
  webUrl: string | undefined;
}

type QuoteTimerJob = Job<DeclinedEvent | { id?: string }>;

// The quote-timers queue: the relay's request.declined events, which set a
// decline's timer, and the timers and their sweep, which close the window.
@Module({})
export class DeclineWindowModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    private readonly window: DeclineWindow,
    @Inject(DECLINE_WINDOW_JOBS) private readonly jobs: Queue,
    @Inject(DECLINE_WINDOW_WORKER) private readonly worker: Worker | null,
  ) {}

  static registerWorker(options: DeclineWindowOptions): DynamicModule {
    return {
      imports: [options.notifications],
      module: DeclineWindowModule,
      providers: [
        { provide: DECLINE_WINDOW_URL, useValue: options.webUrl ?? '' },
        {
          provide: DECLINE_WINDOW_JOBS,
          useFactory: () => {
            const queue = new Queue(DECLINE_WINDOW_QUEUE, {
              connection: { url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
        DeclineWindow,
        {
          inject: [DeclineWindow],
          provide: DECLINE_WINDOW_WORKER,
          useFactory: (window: DeclineWindow) => {
            if (!options.webUrl) {
              new Logger('DeclineWindow').error(
                'PUBLIC_WEB_URL missing; declined request messages wait in their queue',
              );
              return null;
            }
            const worker = new Worker(
              DECLINE_WINDOW_QUEUE,
              (job: QuoteTimerJob) =>
                inJob(job, () =>
                  job.name === 'event'
                    ? window.onDeclined(job as Job<DeclinedEvent>)
                    : window.timers.handle(job as Job<{ id?: string }>),
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
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  // Started with the application, not when compiled, so a test can run the
  // window itself.
  async onApplicationBootstrap() {
    if (!this.worker) return;
    await this.window.timers.startSweep();
    void this.worker.run();
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.jobs.close();
  }
}
