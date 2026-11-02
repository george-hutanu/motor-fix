import {
  databaseTurn,
  TURN_WAIT_MS,
} from './database-turn/database-turn.testing';
import type { PrismaClient } from '../generated/prisma/client';

type TurnGlobal = {
  releaseDatabaseTurnLast?: (release: () => Promise<void>) => void;
};

// Takes the turn for a whole spec file.
export function serialDatabase(databaseUrl: string) {
  const releaseLast = (globalThis as TurnGlobal).releaseDatabaseTurnLast;
  if (!releaseLast)
    throw new Error('serialDatabase needs setup file database-turn.setup.ts');
  const turn = databaseTurn(databaseUrl);
  beforeAll(turn.take, TURN_WAIT_MS);
  // Given back after every afterAll of the spec, not before them.
  releaseLast(turn.release);
}

// Waits until `count` statements wait on a row lock; safe because the spec
// file holds the database alone.
export async function waitingOnLocks(prisma: PrismaClient, count: number) {
  for (let tries = 0; tries < 200; tries += 1) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND datname = current_database()`;
    if (waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fewer than ${count} statements wait on a lock`);
}
