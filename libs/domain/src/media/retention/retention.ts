import { purgeMedia } from './purge';
import type { AuditPort } from '../../audit/audit.port';
import type { PrismaClient } from '../../generated/prisma/client';
import type { LiveVideoProvider } from '../../live-video/providers/live-video.provider';
import type { StorageService } from '../../storage/storage.service';
import { countRetentionStepFailure } from '../media.metrics';

export interface MediaRetentionDeps {
  prisma: PrismaClient;
  storage: Pick<StorageService, 'deleteObject' | 'deleteWithCopies'>;
  provider: Pick<LiveVideoProvider, 'deleteRecording'>;
  audit: AuditPort;
  logger: { log(line: string): void; error(line: string): void };
}

interface MediaRetentionStep {
  name: string;
  run(deps: MediaRetentionDeps, now: Date): Promise<unknown>;
}

// What the nightly media run does, in its order.
export const MEDIA_RETENTION_STEPS: readonly MediaRetentionStep[] = [
  { name: 'purge', run: purgeMedia },
];

// Runs every step in turn; one that throws is logged and counted, and the
// next still runs. The error's class only: its message can carry keys.
export async function runMediaRetention(
  deps: MediaRetentionDeps,
  now: Date,
  steps: readonly MediaRetentionStep[] = MEDIA_RETENTION_STEPS,
): Promise<string[]> {
  const failed: string[] = [];
  for (const step of steps) {
    try {
      await step.run(deps, now);
    } catch (error) {
      failed.push(step.name);
      countRetentionStepFailure(step.name);
      deps.logger.error(
        `media retention ${step.name} failed: ${error instanceof Error ? error.name : typeof error}`,
      );
    }
  }
  return failed;
}
