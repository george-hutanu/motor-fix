import type { Prisma } from '../generated/prisma/client';

export interface DomainEvent {
  kind: string;
  subjectId: string;
  payload: Record<string, unknown>;
}

// Called inside the change's own transaction, so no change is saved without
// its event.
export interface EventPort {
  record(tx: Prisma.TransactionClient, event: DomainEvent): Promise<void>;
}

export const EVENT_PORT = Symbol('EVENT_PORT');

// Bound until the outbox exists.
export const noEvents: EventPort = { record: async () => undefined };
