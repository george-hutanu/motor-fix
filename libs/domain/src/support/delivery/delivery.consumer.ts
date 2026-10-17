import type { EventKind } from '@motor-fix/contracts';
import type { JobsOptions } from 'bullmq';

import type { PrismaClient } from '../../generated/prisma/client';
import type { SupportConfig } from '../support-config';

export const SUPPORT_MESSAGES_QUEUE = 'support-messages';

// A failed delivery is tried 5 more times, 1, 2, 4, 8 and 16 minutes later,
// and removed once it has run or failed for good; the requeue below picks
// it up again.
const SUPPORT_MESSAGES_JOBS: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// A message with an e-mail still to send has its event relayed again five
// minutes after the last relay, so a job an emptied Redis lost, or one that
// ran out of tries, is queued again from the outbox. A support e-mail left
// unconfigured counts once an address is set; while none is, only the
// acknowledgements are queued again.
const requeueUnsent =
  (configured: boolean) =>
  (prisma: PrismaClient): Promise<number> =>
    prisma.$executeRaw`
      UPDATE outbox_event e SET relayed_at = NULL
      FROM support_message m
      WHERE e.kind = 'support.message_received'
        AND e.subject_id = m.id::text
        AND (
          m.acknowledgement_status = 'pending'
          OR (${configured} AND m.support_email_status IN ('pending', 'unconfigured'))
        )
        AND e.relayed_at < now() - interval '5 minutes'`;

// The stored message's event, consumed on its own queue by the worker.
export const supportMessagesConsumer = (support: SupportConfig) => ({
  jobs: SUPPORT_MESSAGES_JOBS,
  kinds: ['support.message_received'] as readonly EventKind[],
  queue: SUPPORT_MESSAGES_QUEUE,
  requeue: requeueUnsent(support.email !== undefined),
});
