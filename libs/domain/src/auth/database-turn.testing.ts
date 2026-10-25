import { basename } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';

import { PrismaClient } from '../generated/prisma/client';

type JestGlobal = { expect?: { getState(): { testPath?: string } } };

// Shown in pg_stat_activity, so CI's Database waits step names the holder.
function holderName() {
  const path = (globalThis as JestGlobal).expect?.getState().testPath;
  return `turn ${path ? basename(path) : 'outside jest'}`.slice(0, 63);
}

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
  let waiting: { pid: number; done: Promise<unknown> } | undefined;
  const callOff = async (pid: number) => {
    const other = new Client({ connectionString: databaseUrl });
    await other.connect();
    try {
      await other.query('SELECT pg_cancel_backend($1)', [pid]);
    } finally {
      await other.end();
    }
  };
  return {
    release: async () => {
      released = true;
      const pending = waiting;
      if (pending) {
        await callOff(pending.pid);
        await pending.done.catch(() => undefined);
      }
      await lock.$disconnect();
    },
    take: async () => {
      if (released) return;
      const [session] = await lock.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid() AS pid`;
      // Started once here: a Prisma query runs again on every then().
      const done = Promise.resolve(
        lock.$queryRaw`SELECT 1 AS taken FROM pg_advisory_lock(79079)`,
      );
      waiting = { done, pid: Number(session?.pid) };
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
