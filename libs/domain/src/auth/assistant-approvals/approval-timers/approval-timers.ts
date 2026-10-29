import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions, Queue } from 'bullmq';

import { NotificationsService } from '../../../notifications/notifications.service';
import { ObjectTimers, type TimerKind } from '../../../scheduler/timers';
import { AssistantApprovals } from '../assistant-approvals';

export const APPROVAL_TIMERS_QUEUE = 'assistant-approval-timers';
export const APPROVAL_TIMERS_JOBS = Symbol('APPROVAL_TIMERS_JOBS');
export const APPROVAL_TIMERS_URL = Symbol('APPROVAL_TIMERS_URL');
const KIND = 'assistant-approval';

// A failed job is tried 5 more times, 1, 2, 4, 8 and 16 minutes later; the
// sweep expires an approval whose timer was lost for good.
const APPROVAL_TIMERS_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

export const APPROVAL_TIMERS_CONSUMER = {
  jobs: APPROVAL_TIMERS_RUN,
  kinds: ['assistant_approval.requested'] as readonly EventKind[],
  queue: APPROVAL_TIMERS_QUEUE,
};

// A job as the relay queues it: `subjectId` is the approval's.
export interface RequestedEvent {
  subjectId: string;
}

// An assistant's action waiting for the person: its event tells the account
// and sets a timer at its expiry; the timer (or the sweep, for a lost one)
// expires it if nobody decided.
@Injectable()
export class ApprovalTimers implements TimerKind {
  readonly name = KIND;
  private readonly logger = new Logger('ApprovalTimers');
  readonly timers: ObjectTimers;
  now = () => new Date();

  constructor(
    private readonly approvals: AssistantApprovals,
    private readonly notifications: NotificationsService,
    @Inject(APPROVAL_TIMERS_JOBS) queue: Queue,
    @Inject(APPROVAL_TIMERS_URL) private readonly webUrl: string,
  ) {
    this.timers = new ObjectTimers(queue, [this]);
  }

  async onRequested(job: Pick<Job<RequestedEvent>, 'data'>): Promise<void> {
    const id = job.data.subjectId;
    const waiting = await this.approvals.waiting(id);
    if (!waiting) return;
    await this.notifications.notify({
      // One message per approval, however often the event is replayed.
      eventId: id,
      kind: 'ASSISTANT_APPROVAL_NEEDED',
      params: { link: `${this.webUrl}/app/assistant/approvals/${id}` },
      recipients: [waiting.accountId],
      subjectId: id,
    });
    await this.timers.set(KIND, id, waiting.expiresAt, this.now());
  }

  overdue(now: Date): Promise<string[]> {
    return this.approvals.overdue(now);
  }

  async fire(id: string, sweep: boolean): Promise<void> {
    const expired = await this.approvals.expireOverdue(id, this.now(), sweep);
    this.logger.log(
      `approval ${id}${sweep ? ' (sweep)' : ''}: ${expired ? 'expired' : 'unchanged'}`,
    );
  }
}
