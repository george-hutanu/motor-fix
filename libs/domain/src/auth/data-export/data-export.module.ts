import {
  observeQueue,
  observeWorker,
  queueTelemetry,
} from '@motor-fix/observability';
import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';

import {
  DATA_EXPORT_QUEUE,
  DATA_EXPORT_URL,
  DataExportBuilder,
  type DataExportEvent,
} from './data-export.builder';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { EVENT_PORT, outbox } from '../../events/event.port';
import { logFinalFailure } from '../../job-failures';
import { inJob } from '../../logging';

const DATA_EXPORT_REDIS = Symbol('DATA_EXPORT_REDIS');
const SWEEP = 'sweep';
const HOURLY = { every: 60 * 60_000 };

interface DataExportWorkerOptions {
  // The worker's NotificationsModule, whose database client and sending the
  // build shares.
  notifications: DynamicModule;
  redisUrl: string;
  // The web app's address, for the link in the ready e-mail; unset only
  // where e-mail is off.
  webUrl: string | undefined;
}

// The queue: the relay's data_export.requested and account.deleted events,
// and the hourly sweep of expired files.
@Injectable()
class DataExportJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('DataExport');
  private readonly jobs: Queue;
  private readonly worker: Worker;

  constructor(
    @Inject(DATA_EXPORT_REDIS) redisUrl: string,
    builder: DataExportBuilder,
  ) {
    const connection = { maxRetriesPerRequest: null, url: redisUrl };
    this.jobs = new Queue(DATA_EXPORT_QUEUE, {
      connection,
      telemetry: queueTelemetry(),
    });
    observeQueue(this.jobs);
    this.worker = new Worker(
      DATA_EXPORT_QUEUE,
      (job: Job<DataExportEvent>) =>
        inJob(job, async () => {
          if (job.name === SWEEP) await builder.sweep();
          else await builder.onEvent(job);
        }),
      { autorun: false, connection, telemetry: queueTelemetry() },
    );
    logFinalFailure(this.worker, this.logger);
    observeWorker(this.worker);
  }

  // Started with the application, not when compiled, so a test can hand the
  // builder its jobs itself.
  async onApplicationBootstrap() {
    await this.jobs.upsertJobScheduler(SWEEP, HOURLY, {
      name: SWEEP,
      opts: { removeOnComplete: true, removeOnFail: 48 },
    });
    void this.worker.run();
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.jobs.close();
  }
}

@Module({})
export class DataExportModule {
  // The API: request, state and download. Apart from AuthModule, which many
  // specs boot without an object store: the download needs the global
  // StorageModule. PRISMA and EVENT_PORT are AuthModule's.
  static register(): DynamicModule {
    return {
      controllers: [DataExportController],
      module: DataExportModule,
      providers: [
        DataExportService,
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }

  // The worker: the build, its e-mail and the expiry of the files.
  static registerWorker(options: DataExportWorkerOptions): DynamicModule {
    return {
      imports: [options.notifications],
      module: DataExportModule,
      providers: [
        { provide: EVENT_PORT, useValue: outbox },
        { provide: DATA_EXPORT_REDIS, useValue: options.redisUrl },
        { provide: DATA_EXPORT_URL, useValue: options.webUrl ?? '' },
        DataExportBuilder,
        DataExportJobs,
      ],
    };
  }
}
