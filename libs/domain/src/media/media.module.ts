import { observeQueue, queueTelemetry } from '@motor-fix/observability';
import { type DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { MediaController } from './media.controller';
import { MEDIA_JOBS, MediaService } from './media.service';
import { MEDIA_QUEUE } from './processing/processing.config';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import {
  type LiveVideoConfig,
  providerFor,
} from '../live-video/live-video.module';
import { LIVE_VIDEO_PROVIDER } from '../live-video/providers/live-video.provider';

// A job's photos, clips and kept recordings. Needs the global AuthModule for
// Prisma and the event port, and the global StorageModule.
@Module({})
export class MediaModule {
  static register(options: {
    redisUrl: string;
    liveVideo: LiveVideoConfig;
  }): DynamicModule {
    return {
      controllers: [MediaController],
      exports: [MediaService],
      module: MediaModule,
      providers: [
        { provide: AUDIT_PORT, useClass: AuditService },
        {
          provide: LIVE_VIDEO_PROVIDER,
          useValue: providerFor(options.liveVideo),
        },
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
