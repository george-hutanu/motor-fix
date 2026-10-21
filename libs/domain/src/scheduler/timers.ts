import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

// A timer on one object, such as a request's expiry. `fire` checks the
// object's state before it acts, so a late or repeated timer does nothing;
// `overdue` names the objects whose time has passed, for the sweep, and
// `sweep` tells a kind the sweep ran it rather than its own timer.
export interface TimerKind {
  name: string;
  fire(objectId: string, sweep: boolean): Promise<void>;
  overdue(now: Date): Promise<string[]>;
}

const SWEEP_EVERY = 5 * 60_000;

// BullMQ refuses ':' in a job id.
const timerId = (kind: string, objectId: string) => `${kind}-${objectId}`;

// One timer per object, under a stable job id: setting it again replaces it,
// clearing it removes it, and the sweep runs what a lost timer missed.
export class ObjectTimers {
  private readonly kinds: ReadonlyMap<string, TimerKind>;
  private readonly logger = new Logger('ObjectTimers');

  constructor(
    private readonly queue: Queue,
    kinds: readonly TimerKind[],
  ) {
    this.kinds = new Map(kinds.map((k) => [k.name, k]));
  }

  async set(kind: string, objectId: string, at: Date, now = new Date()) {
    this.kind(kind);
    await this.clear(kind, objectId);
    await this.queue.add(
      kind,
      { id: objectId },
      {
        delay: Math.max(0, at.getTime() - now.getTime()),
        jobId: timerId(kind, objectId),
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  async clear(kind: string, objectId: string) {
    await this.queue.remove(timerId(kind, objectId));
  }

  startSweep() {
    return this.queue.upsertJobScheduler(
      'sweep',
      { every: SWEEP_EVERY },
      { name: 'sweep' },
    );
  }

  // Answers how many objects it ran. One that fails is logged and does not
  // hold back the ones behind it; the sweep then fails naming them, so the
  // job counts as failed, and the next sweep tries them again.
  async sweep(now = new Date()): Promise<number> {
    let ran = 0;
    const failed: string[] = [];
    for (const kind of this.kinds.values()) {
      for (const id of await kind.overdue(now)) {
        try {
          await kind.fire(id, true);
          ran += 1;
        } catch (error) {
          failed.push(`${kind.name} ${id}`);
          this.logger.warn(
            `sweep ${kind.name} ${id} failed: ${(error as Error).message}`,
          );
        }
      }
    }
    if (failed.length) {
      throw new Error(
        `sweep ran ${ran}, failed ${failed.length}: ${failed.join(', ')}`,
      );
    }
    return ran;
  }

  async handle(job: Job<{ id?: string }>): Promise<void> {
    if (job.name === 'sweep') {
      await this.sweep();
      return;
    }
    await this.kind(job.name).fire(job.data.id ?? '', false);
  }

  private kind(name: string): TimerKind {
    const kind = this.kinds.get(name);
    if (!kind) throw new Error(`unknown timer kind ${name}`);
    return kind;
  }
}
