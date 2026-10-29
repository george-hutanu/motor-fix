import type { EventKind } from '@motor-fix/contracts';
import type { Job, JobsOptions } from 'bullmq';

import type { PrismaClient } from '../../generated/prisma/client';
import { countMediaItem } from '../../media/media.metrics';
import type { LiveVideoProvider } from '../providers/live-video.provider';
import { countLiveRecording } from '../sessions/sessions.metrics';

export const LIVE_RECORDINGS_QUEUE = 'live-recordings';

const RUN: JobsOptions = {
  attempts: 3,
  backoff: { delay: 60_000, type: 'fixed' },
  removeOnComplete: true,
  removeOnFail: true,
};

const KINDS: readonly EventKind[] = ['live.stopped'];

export const LIVE_RECORDINGS_CONSUMER = {
  jobs: RUN,
  kinds: KINDS,
  queue: LIVE_RECORDINGS_QUEUE,
};

interface LiveStoppedEvent {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  subjectId?: string;
}

export type LiveStoppedJob = Pick<
  Job<LiveStoppedEvent>,
  'data' | 'attemptsMade'
> & { opts: Pick<JobsOptions, 'attempts'> };

// What follows a committed stop: a kept recording is counted as a visible
// live item, and a discarded one is deleted at the provider, the system's
// and the idle stops' at all, and a sender's again, which costs one empty
// call when the API's own delete went through. A failed delete throws, so
// the queue tries again a minute later, three tries in all.
export class LiveRecordings {
  constructor(
    private readonly prisma: Pick<PrismaClient, 'liveSession'>,
    private readonly provider: Pick<
      LiveVideoProvider,
      'name' | 'deleteRecording'
    >,
    private readonly logger: {
      log(line: string): void;
      warn(line: string): void;
    },
  ) {}

  async onEvent(job: LiveStoppedJob): Promise<void> {
    const { kind, payload } = job.data;
    const sessionId = payload['liveSessionId'];
    if (!KINDS.includes(kind as EventKind) || typeof sessionId !== 'string')
      return;
    if (payload['keep'] === true) {
      countMediaItem('live', 'visible');
      return;
    }
    if (payload['keep'] !== false) return;
    const session = await this.prisma.liveSession.findUnique({
      select: { provider: true, providerInputId: true },
      where: { id: sessionId },
    });
    // Only this worker's provider holds the recording.
    if (!session || session.provider !== this.provider.name) return;
    const input = session.providerInputId;
    try {
      await this.provider.deleteRecording(input);
    } catch (error) {
      const tries = job.opts.attempts ?? 1;
      const tried = job.attemptsMade + 1;
      if (tried >= tries) countLiveRecording('discard_failed');
      this.logger.warn(
        `live recording discard failed: session ${sessionId} input ${input} try ${tried} of ${tries}`,
      );
      throw error;
    }
    countLiveRecording('discarded');
    this.logger.log(
      `live recording discarded: session ${sessionId} input ${input}`,
    );
  }
}
