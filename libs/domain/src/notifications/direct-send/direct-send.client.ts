import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Queue, QueueEvents } from 'bullmq';

import { DIRECT_SEND_WAIT_MS, type DirectSendJob } from './direct-send';

export const DIRECT_SEND_JOBS = Symbol('DIRECT_SEND_JOBS');
export const DIRECT_SEND_EVENTS = Symbol('DIRECT_SEND_EVENTS');

// One attempt, and gone from Valkey a minute after it ends: the job carries a
// code, a number or a link.
const JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 60 },
  removeOnFail: { age: 60 },
};

// A failed job's reason is one of the worker's kinds; anything else is not
// passed on, as it may carry what the logs must not.
function failureKind(error: unknown): string {
  const message = (error as Error).message ?? '';
  if (message.startsWith('Job wait')) return 'timeout';
  return /^[a-z0-9_]+$/.test(message) ? message : 'provider_error';
}

// The API's side of direct-send: adds the job and waits for the worker's
// answer, at most DIRECT_SEND_WAIT_MS in all. Answers null when the message
// left, otherwise why it did not. Logs nothing; the callers log the kind.
@Injectable()
export class DirectSend implements OnApplicationShutdown {
  constructor(
    @Inject(DIRECT_SEND_JOBS) private readonly queue: Queue<DirectSendJob>,
    @Inject(DIRECT_SEND_EVENTS) private readonly events: QueueEvents,
  ) {}

  whatsapp(
    template: string,
    language: 'ro' | 'en',
    values: Record<string, unknown>,
    to: string,
  ): Promise<string | null> {
    return this.send('whatsapp', { language, template, to, values });
  }

  email(
    template: string,
    language: 'ro' | 'en',
    values: Record<string, unknown>,
    to: { email: string; name?: string },
  ): Promise<string | null> {
    return this.send('email', {
      language,
      name: to.name,
      template,
      to: to.email,
      values,
    });
  }

  async onApplicationShutdown() {
    await this.events.close();
    await this.queue.close();
  }

  private async send(
    name: 'whatsapp' | 'email',
    data: DirectSendJob,
  ): Promise<string | null> {
    let timer: NodeJS.Timeout | undefined;
    const cap = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), DIRECT_SEND_WAIT_MS);
    });
    try {
      return await Promise.race([this.run(name, data), cap]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async run(
    name: 'whatsapp' | 'email',
    data: DirectSendJob,
  ): Promise<string | null> {
    const job = await this.queue.add(name, data, JOB_OPTIONS).catch(() => null);
    if (!job) return 'queue_unavailable';
    // The listener reads finish events from when it is ready; BullMQ checks
    // the job's own state too, so one that finished first is not missed.
    const ready = await this.events.waitUntilReady().then(
      () => true,
      () => false,
    );
    if (!ready) return 'queue_unavailable';
    return job
      .waitUntilFinished(this.events, DIRECT_SEND_WAIT_MS)
      .then((result: string | null) => result ?? null, failureKind);
  }
}
