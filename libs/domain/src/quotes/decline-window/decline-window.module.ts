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
  DECLINE_WINDOW_KINDS,
  DECLINE_WINDOW_QUEUE,
  DECLINE_WINDOW_URL,
  type DeclinedEvent,
  DeclineWindow,
} from './decline-window';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';
import { MoveLapse, type MoveProposedEvent } from '../moves/move-lapse';

const DECLINE_WINDOW_WORKER = Symbol('DECLINE_WINDOW_WORKER');

interface DeclineWindowOptions {
  redisUrl: string;
  // The worker's NotificationsModule, whose service tells the driver.
  notifications: DynamicModule;
  // The web app's address, for the link to the driver's request.
  webUrl: string | undefined;
}

type QuoteTimerJob = Job<{ id?: string; kind?: string }>;

// The quote-timers queue: the relay's request.declined and
// booking.move_proposed events, which set a decline's or a move's timer, and
// the timers and their sweep, which close the window or lapse the move.
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
              connection: { maxRetriesPerRequest: null, url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
        { provide: AUDIT_PORT, useClass: AuditService },
        MoveLapse,
        {
          inject: [MoveLapse],
          provide: DECLINE_WINDOW_KINDS,
          useFactory: (lapse: MoveLapse) => [lapse],
        },
        DeclineWindow,
        {
          inject: [DeclineWindow, MoveLapse],
          provide: DECLINE_WINDOW_WORKER,
          useFactory: (window: DeclineWindow, lapse: MoveLapse) => {
            if (!options.webUrl) {
              new Logger('DeclineWindow').error(
                'PUBLIC_WEB_URL missing; declined request messages wait in their queue',
              );
              return null;
            }
            const worker = new Worker(
              DECLINE_WINDOW_QUEUE,
              (job: QuoteTimerJob) =>
                inJob(job, () => {
                  if (job.name !== 'event')
                    return window.timers.handle(job as Job<{ id?: string }>);
                  return job.data.kind === 'booking.move_proposed'
                    ? lapse.onProposed(job as Job<MoveProposedEvent>)
                    : window.onDeclined(job as Job<DeclinedEvent>);
                }),
              {
                autorun: false,
                connection: {
                  maxRetriesPerRequest: null,
                  url: options.redisUrl,
                },
                telemetry: queueTelemetry(),
              },
            );
            logFinalFailure(worker, new Logger('DeclineWindow'));
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
