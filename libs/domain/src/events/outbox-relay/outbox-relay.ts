import type { EventKind } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';

import {
  dropProfiles,
  type ProfileDropper,
} from '../../garages/public-garages/public-garages.cache';
import type { PrismaClient } from '../../generated/prisma/client';
import { type LivePublisher, publishLive } from '../live/live.hub';

const BATCH = 100;
const POLL_MS = 200;
const LAG_MS = 30_000;
const KEEP_MS = 7 * 24 * 60 * 60_000;
const SWEEP_MS = 60 * 60_000;
const REQUEUE_MS = 5 * 60_000;

interface Jobs {
  add(
    name: string,
    data: unknown,
    options: { jobId?: string },
  ): Promise<unknown>;
}

// A queue that gets one job for each relayed event of its kinds. Its add()
// runs inside the batch's transaction, so its client must fail fast when its
// Redis is down (no offline queue) rather than hold the batch's row locks.
// Its requeue, when it has one, puts back in line the relayed events whose
// jobs have not done their work, for a Redis that lost them.
export interface EventConsumer {
  kinds: readonly EventKind[];
  queue: Jobs;
  requeue?: (prisma: PrismaClient) => Promise<number>;
}

interface Row {
  id: bigint;
  kind: EventKind;
  subject_id: string;
  payload: Record<string, unknown>;
  audience: string[];
  created_at: Date;
}

// The worker's outbox-relay: publishes committed events to the live channel
// and hands them to their consumers, in creation order, at least once.
export class OutboxRelay {
  private readonly logger = new Logger('OutboxRelay');
  private lagReportedAt = 0;
  private failing = false;
  private running: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: LivePublisher & ProfileDropper,
    private readonly consumers: readonly EventConsumer[] = [],
  ) {}

  // One batch. A failure rolls the batch back: its rows stay waiting and the
  // next batch publishes them again, oldest first.
  async relay(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Row[]>`
          SELECT id, kind, subject_id, payload, audience, created_at
          FROM outbox_event
          WHERE relayed_at IS NULL
          ORDER BY id
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED`;
        const oldest = rows[0];
        if (oldest) this.reportLag(oldest.created_at);
        for (const row of rows) await this.hand(row);
        if (rows.length > 0) {
          await tx.$executeRaw`
            UPDATE outbox_event SET relayed_at = now()
            WHERE id = ANY(${rows.map((r) => r.id)}::bigint[])`;
        }
        return rows.length;
      },
      { timeout: 15_000 },
    );
  }

  async requeue(): Promise<number> {
    let count = 0;
    for (const { requeue } of this.consumers) {
      if (requeue) count += await requeue(this.prisma);
    }
    if (count > 0) this.logger.warn(`${count} relayed events queued again`);
    return count;
  }

  async sweep(now = new Date()): Promise<number> {
    const { count } = await this.prisma.outboxEvent.deleteMany({
      where: { relayedAt: { lt: new Date(now.getTime() - KEEP_MS) } },
    });
    return count;
  }

  start() {
    this.stopping = false;
    this.running ??= this.loop();
  }

  async stop() {
    this.stopping = true;
    await this.running;
    this.running = null;
  }

  private async loop() {
    let sweptAt = 0;
    let requeuedAt = 0;
    while (!this.stopping) {
      const due = Date.now() - sweptAt >= SWEEP_MS;
      if (due && (await this.attempt(() => this.sweep())) !== null) {
        sweptAt = Date.now();
      }
      if (
        Date.now() - requeuedAt >= REQUEUE_MS &&
        (await this.attempt(() => this.requeue())) !== null
      ) {
        requeuedAt = Date.now();
      }
      const relayed = await this.attempt(() => this.relay());
      // A full batch means more are waiting: take them at once.
      if (relayed !== BATCH) await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  // Logs the first failure of a run of them, and the recovery.
  private async attempt(step: () => Promise<number>) {
    try {
      const done = await step();
      if (this.failing) this.logger.log('the outbox relays again');
      this.failing = false;
      return done;
    } catch (error) {
      if (!this.failing) {
        this.logger.warn(
          `the outbox cannot relay: ${(error as Error).message}`,
        );
      }
      this.failing = true;
      return null;
    }
  }

  private async hand(row: Row) {
    const id = String(row.id);
    await publishLive(
      this.redis,
      {
        at: row.created_at.toISOString(),
        id: row.subject_id,
        kind: row.kind,
      },
      row.audience,
    );
    await dropProfiles(this.redis, row.audience);
    for (const consumer of this.consumers) {
      if (!consumer.kinds.includes(row.kind)) continue;
      await consumer.queue.add(
        'event',
        { id, kind: row.kind, payload: row.payload, subjectId: row.subject_id },
        { jobId: `event-${id}` },
      );
    }
  }

  private reportLag(createdAt: Date) {
    const now = Date.now();
    if (now - createdAt.getTime() <= LAG_MS) return;
    if (now - this.lagReportedAt < LAG_MS) return;
    this.lagReportedAt = now;
    this.logger.error(
      `the outbox lags: its oldest waiting event is ${Math.round((now - createdAt.getTime()) / 1000)} s old`,
    );
  }
}
