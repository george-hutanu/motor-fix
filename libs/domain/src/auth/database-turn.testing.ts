import { Client } from 'pg';

// Jest runs test files in parallel workers against one database; files that
// empty the account tables take turns by holding one advisory lock on a
// dedicated connection that never idles out.
//
// A take queues on the lock, so the turn goes to the files in the order they
// asked. A beforeAll that runs out of time leaves its take queued behind, and
// release() cancels it on the server: left there, it took the turn once its
// holder let go and never gave it back.
export function databaseTurn(databaseUrl: string) {
  const lock = new Client({ connectionString: databaseUrl });
  let backend: Promise<number> | undefined;
  let asking: Promise<unknown> | undefined;
  let held = false;
  let released = false;
  let releasing: Promise<void> | undefined;

  const connect = () => {
    backend ??= lock.connect().then(async () => {
      const { rows } = await lock.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      return rows[0].pid;
    });
    return backend;
  };

  const cancelAsk = async (pid: number) => {
    const canceller = new Client({ connectionString: databaseUrl });
    await canceller.connect();
    try {
      await canceller.query('SELECT pg_cancel_backend($1)', [pid]);
    } finally {
      await canceller.end();
    }
  };

  // A cancel can reach the server before the ask it is meant for, so it is
  // sent again until the ask ends.
  const cancelUntilSettled = async (ask: Promise<unknown>, pid: number) => {
    let settled = false;
    const ended = ask.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    while (!settled) {
      await cancelAsk(pid);
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        ended,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 250);
        }),
      ]);
      clearTimeout(timer);
    }
  };

  const giveBack = async () => {
    released = true;
    if (!backend) return;
    const pid = await backend.catch(() => undefined);
    if (asking && pid !== undefined) await cancelUntilSettled(asking, pid);
    // Closing the session gives the turn back if it was held.
    await lock.end().catch(() => undefined);
  };

  return {
    // Gives the turn back, or ends a take still queued; once is enough.
    release: () => {
      releasing ??= giveBack();
      return releasing;
    },
    // Resolves once the turn is held (at once when it already is), or,
    // without it, once release() ran.
    take: async () => {
      if (held || released) return;
      asking = connect().then(() =>
        lock.query('SELECT pg_advisory_lock(79079)'),
      );
      // A take cancelled by release() ends without the turn.
      held = await asking.then(
        () => true,
        (error: unknown) => {
          if (!released) throw error;
          return false;
        },
      );
      asking = undefined;
    },
  };
}
