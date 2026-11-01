import { basename } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';

import { PrismaClient } from '../../generated/prisma/client';

type TestGlobal = { expect?: { getState(): { testPath?: string } } };

// Shown in pg_stat_activity, so CI's Database waits step names the holder.
function holderName() {
  const path = (globalThis as TestGlobal).expect?.getState().testPath;
  return `turn ${path ? basename(path) : 'outside a test'}`.slice(0, 63);
}

// How long a take may wait: the turn goes out in order, so a file waits for
// every file queued before it across the api, domain and mcp suites.
export const TURN_WAIT_MS = 20 * 60_000;

// One spec file at a time touches the shared tables. A take queues on the
// lock, so the turn goes out in the order it was asked for. A queued
// pg_advisory_lock outlives a hook that timed out on it, so release() calls
// off a take still waiting before it closes the session: the take never holds
// the turn once its spec file is done.
export function databaseTurn(databaseUrl: string) {
  const lock = new PrismaClient({
    adapter: new PrismaPg({
      application_name: holderName(),
      connectionString: databaseUrl,
      idleTimeoutMillis: 0,
      max: 1,
    }),
  });
  let released = false;
  let waiting:
    | { caller: Client; done: Promise<unknown>; pid: number }
    | undefined;
  const callOff = async ({ caller, pid }: { caller: Client; pid: number }) => {
    await caller.connect();
    try {
      await caller.query('SELECT pg_cancel_backend($1)', [pid]);
    } finally {
      await caller.end();
    }
  };
  return {
    release: async () => {
      released = true;
      const pending = waiting;
      try {
        if (pending) {
          await callOff(pending);
          await pending.done.catch(() => undefined);
        }
      } finally {
        // Closing the session also drops a take the call-off missed.
        await lock.$disconnect();
      }
    },
    take: async () => {
      if (released) return;
      const [session] = await lock.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid() AS pid`;
      // Started once here: a Prisma query runs again on every then().
      const done = Promise.resolve(
        lock.$queryRaw`SELECT 1 AS taken FROM pg_advisory_lock(79079)`,
      );
      // Made before the wait: release() may run in the file's teardown, where
      // a new client can no longer load the socket module it needs.
      const caller = new Client({ connectionString: databaseUrl });
      waiting = { caller, done, pid: Number(session?.pid) };
      try {
        await done;
      } catch (error) {
        if (!released) throw error;
      } finally {
        waiting = undefined;
      }
    },
  };
}
