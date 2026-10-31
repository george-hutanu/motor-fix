import type { EventKind } from '@motor-fix/contracts';
import type { JobsOptions } from 'bullmq';

import type { PrismaClient } from '../../generated/prisma/client';
import type { LiveVideoProvider } from '../providers/live-video.provider';
import type { LiveStoppedJob } from '../recordings/recordings';
import { countLiveInputClose } from '../sessions/sessions.metrics';

export const LIVE_INPUTS_QUEUE = 'live-inputs';

const RUN: JobsOptions = {
  attempts: 3,
  backoff: { delay: 60_000, type: 'fixed' },
  removeOnComplete: true,
  removeOnFail: true,
};

const KINDS: readonly EventKind[] = ['live.stopped'];

export const LIVE_INPUTS_CONSUMER = {
  jobs: RUN,
  kinds: KINDS,
  queue: LIVE_INPUTS_QUEUE,
};

const PREFIX = 'live input close failed: ';

// The adapter's reason token, or the error's class: never a message that
// could carry a URL or the provider's words.
const reasonOf = (error: unknown) =>
  error instanceof Error && error.message.startsWith(PREFIX)
    ? error.message.slice(PREFIX.length)
    : ((error as Error | undefined)?.name ?? 'Error');

// After every committed stop, whatever its reason or recording, the
// session's input stops accepting a publisher. A failed close throws, so the
// queue tries again a minute later, three tries in all.
export class LiveInputs {
  constructor(
    private readonly prisma: Pick<PrismaClient, 'liveSession'>,
    private readonly provider: Pick<LiveVideoProvider, 'name' | 'closeInput'>,
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
    const session = await this.prisma.liveSession.findUnique({
      select: { provider: true, providerInputId: true },
      where: { id: sessionId },
    });
    // Only this worker's provider holds the input.
    if (!session || session.provider !== this.provider.name) return;
    const input = session.providerInputId;
    try {
      await this.provider.closeInput(input);
    } catch (error) {
      const tries = job.opts.attempts ?? 1;
      const tried = job.attemptsMade + 1;
      if (tried >= tries) countLiveInputClose('close_failed');
      this.logger.warn(
        `live input close failed: session ${sessionId} input ${input} try ${tried} of ${tries}: ${reasonOf(error)}`,
      );
      throw error;
    }
    countLiveInputClose('closed');
    this.logger.log(`live input closed: session ${sessionId} input ${input}`);
  }
}
