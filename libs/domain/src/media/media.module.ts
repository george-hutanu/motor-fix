import { observeQueue, queueTelemetry } from '@motor-fix/observability';
import { type DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { MediaController } from './media.controller';
import { MEDIA_JOBS, MediaService } from './media.service';
import { MEDIA_QUEUE } from './processing/processing.config';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

// A job's photos, clips and kept recordings. Needs the global AuthModule for
// Prisma and the event port, the global StorageModule, and the app's own
// LiveVideoModule registration, whose provider it shares.
@Module({})
export class MediaModule {
  static register(options: {
    redisUrl: string;
    live: DynamicModule;
  }): DynamicModule {
    return {
      controllers: [MediaController],
      exports: [MediaService],
      imports: [options.live],
      module: MediaModule,
      providers: [
        { provide: AUDIT_PORT, useClass: AuditService },
        MediaService,
        {
          provide: MEDIA_JOBS,
          useFactory: () => {
            const queue = new Queue(MEDIA_QUEUE, {
              connection: { maxRetriesPerRequest: null, url: options.redisUrl },
              telemetry: queueTelemetry(),
            });
            observeQueue(queue);
            return queue;
          },
        },
      ],
    };
  }
}
