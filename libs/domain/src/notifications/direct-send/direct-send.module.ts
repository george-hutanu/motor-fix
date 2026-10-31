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
import { type Job, Queue, QueueEvents, Worker } from 'bullmq';

import {
  DIRECT_SEND_QUEUE,
  type DirectSendJob,
  sendDirect,
} from './direct-send';
import {
  DIRECT_SEND_EVENTS,
  DIRECT_SEND_JOBS,
  DirectSend,
} from './direct-send.client';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';
import { Brevo } from '../brevo/brevo';
import type { EmailConfig } from '../email-config';
import type { PhoneConfig } from '../phone-config';

const DIRECT_SEND_RUNNER = Symbol('DIRECT_SEND_RUNNER');

interface Runner {
  queue: Queue;
  worker: Worker<DirectSendJob>;
}

// A command waits for the broker rather than failing after a few retries;
// the API's wait cap bounds it instead. The offline queue stays on, so a
// broker blip does not fail a sign-in; a job queued through an outage reaches
// the worker past the cap and ends `stale`, unsent.
const connection = (url: string) => ({ maxRetriesPerRequest: null, url });

// The API adds the jobs and waits on their answer (`register`); the worker
// holds the provider client and sends them (`registerWorker`).
@Module({})
export class DirectSendModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Optional() @Inject(DIRECT_SEND_RUNNER) private readonly runner?: Runner,
  ) {}

  static register(redisUrl: string): DynamicModule {
    return {
      exports: [DirectSend],
      module: DirectSendModule,
      providers: [
        {
          provide: DIRECT_SEND_JOBS,
          useFactory: () =>
            new Queue(DIRECT_SEND_QUEUE, {
              connection: connection(redisUrl),
              telemetry: queueTelemetry(),
            }),
        },
        {
          // The API boots without a broker to write its OpenAPI document, so
          // the listener is built on the first send (DirectSend).
          provide: DIRECT_SEND_EVENTS,
          useValue: (lastEventId: string) =>
            new QueueEvents(DIRECT_SEND_QUEUE, {
              connection: connection(redisUrl),
              lastEventId,
            }),
        },
        DirectSend,
      ],
    };
  }

  // Its own Brevo with a 5 s timeout, inside the API's 8 s wait.
  static registerWorker(options: {
    email: EmailConfig;
    phone: PhoneConfig;
    redisUrl: string;
  }): DynamicModule {
    return {
      module: DirectSendModule,
      providers: [
        {
          provide: DIRECT_SEND_RUNNER,
          useFactory: (): Runner => {
            const queue = new Queue(DIRECT_SEND_QUEUE, {
              connection: connection(options.redisUrl),
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            const sender = {
              brevo: new Brevo({
                apiKey: options.email.apiKey ?? '',
                apiUrl: options.email.apiUrl,
                timeoutMs: 5000,
              }),
              email: options.email,
              phone: options.phone,
            };
            const worker = new Worker<DirectSendJob>(
              DIRECT_SEND_QUEUE,
              (job: Job<DirectSendJob>) =>
                inJob(job, () => sendDirect(sender, job)),
              {
                autorun: false,
                concurrency: 10,
                connection: connection(options.redisUrl),
                telemetry: queueTelemetry(),
              },
            );
            observeWorker(worker);
            logFinalFailure(worker, new Logger('DirectSend'));
            return { queue, worker };
          },
        },
      ],
    };
  }

  // Started with the application, not when compiled.
  onApplicationBootstrap() {
    if (this.runner) void this.runner.worker.run();
  }

  async onApplicationShutdown() {
    if (!this.runner) return;
    await this.runner.worker.close();
    await this.runner.queue.close();
  }
}
