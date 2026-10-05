import type { EventKind } from '@motor-fix/contracts';

import { audienceOf, type LiveSubject } from './audience';
import type { Prisma } from '../generated/prisma/client';

export interface DomainEvent {
  kind: EventKind;
  // The object the event is about: the id a screen re-reads.
  subjectId: string;
  payload: Record<string, unknown>;
  // Who may read the subject; stored as its channel keys.
  audience: LiveSubject;
}

// Called inside the change's own transaction, so no change is saved without
// its event.
export interface EventPort {
  record(tx: Prisma.TransactionClient, event: DomainEvent): Promise<void>;
}

export const EVENT_PORT = Symbol('EVENT_PORT');

// The worker's relay publishes what this writes.
export const outbox: EventPort = {
  record: async (tx, { audience, kind, payload, subjectId }) => {
    await tx.outboxEvent.create({
      data: {
        audience: audienceOf(audience),
        kind,
        payload: payload as Prisma.InputJsonObject,
        subjectId,
      },
    });
  },
};

// For tests whose set-up writes accounts and reads no events.
export const noEvents: EventPort = { record: async () => undefined };
