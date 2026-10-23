import { observeWorker, queueTelemetry } from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import {
  REVIEW_RATINGS_QUEUE,
  ReviewRatings,
  type ReviewRatingsEvent,
} from './ratings';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';

const REVIEW_RATINGS_WORKER = Symbol('REVIEW_RATINGS_WORKER');

interface ReviewRatingsOptions {
  redisUrl: string;
  // The worker's NotificationsModule, whose database client the ratings
  // share.
  notifications: DynamicModule;
}

// The review-ratings queue: the relay's review events, each recomputing the
// rating of the review's garage and mechanic.
@Module({})
export class ReviewRatingsModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(@Inject(REVIEW_RATINGS_WORKER) private readonly worker: Worker) {}

  static registerWorker(options: ReviewRatingsOptions): DynamicModule {
    const connection = { maxRetriesPerRequest: null, url: options.redisUrl };
    return {
      imports: [options.notifications],
      module: ReviewRatingsModule,
      providers: [
        ReviewRatings,
        {
          inject: [ReviewRatings],
          provide: REVIEW_RATINGS_WORKER,
          useFactory: (ratings: ReviewRatings) => {
            const worker = new Worker(
              REVIEW_RATINGS_QUEUE,
              (job: Job<ReviewRatingsEvent>) =>
                inJob(job, () => ratings.onEvent(job)),
              { autorun: false, connection, telemetry: queueTelemetry() },
            );
            logFinalFailure(worker, new Logger('ReviewRatings'));
            observeWorker(worker);
            return worker;
          },
        },
      ],
    };
  }

  // Started with the application, not when compiled, so a test can hand the
  // handler its events itself.
  onApplicationBootstrap() {
    void this.worker.run();
  }

  async onApplicationShutdown() {
    await this.worker.close();
  }
}
