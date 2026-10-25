import { Pool } from 'pg';

import { databaseTurn } from './database-turn.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const watcher = new Pool({ connectionString: databaseUrl, max: 1 });
const name = 'turn database-turn.integration.spec.ts';

afterAll(() => watcher.end());

// This file's turn sessions open right now.
const sessions = async () => {
  const { rows } = await watcher.query<{ pid: number }>(
    'SELECT pid FROM pg_stat_activity WHERE application_name = $1',
    [name],
  );
  return new Set(rows.map((row) => row.pid));
};

const holders = async () => {
  const { rows } = await watcher.query<{ pid: number }>(
    `SELECT pid FROM pg_locks
      WHERE locktype = 'advisory' AND objid = 79079 AND granted`,
  );
  return rows.map((row) => row.pid);
};

const until = async (check: () => Promise<boolean>, ms: number) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
};

// A beforeAll that times out on take() still gets its teardown, while the take
// waits. Once released, the waiting take must never hold the turn: in CI the
// spec file is gone by the time a queued lock would be granted, and the
// session it was granted on sat idle holding the turn for the rest of the run.
it('a take still waiting when released closes its session and never holds the turn', async () => {
  const holder = databaseTurn(databaseUrl);
  await holder.take();
  const before = await sessions();
  const late = databaseTurn(databaseUrl);
  const taking = late.take().then(() => undefined);
  let pid: number | undefined;
  await until(async () => {
    pid = [...(await sessions())].find((one) => !before.has(one));
    return pid !== undefined;
  }, 10_000);

  try {
    expect(pid).toBeDefined();
    await late.release();
    expect(await sessions()).not.toContain(pid);
  } finally {
    await holder.release();
  }
  await taking;
  expect(await holders()).not.toContain(pid);
}, 60_000);

// The turn goes out in the order it was asked for: a take polled for it
// instead could lose every round to newer spec files until its hook timed out,
// which failed whole files of CI's integration run while the turn moved on.
it('queues a waiting take in PostgreSQL, so the first to ask is the next to hold', async () => {
  const waiting = async () => {
    const { rows } = await watcher.query<{ pid: number }>(
      `SELECT pid FROM pg_locks
        WHERE locktype = 'advisory' AND objid = 79079 AND NOT granted`,
    );
    return rows.map((row) => row.pid);
  };
  const holder = databaseTurn(databaseUrl);
  await holder.take();
  const first = databaseTurn(databaseUrl);
  const second = databaseTurn(databaseUrl);
  try {
    let firstTaken = false;
    let secondTaken = false;
    const takingFirst = first.take().then(() => {
      firstTaken = true;
    });
    const queuedFirst = await until(
      async () => (await waiting()).length === 1,
      10_000,
    );
    const takingSecond = second.take().then(() => {
      secondTaken = true;
    });
    const queuedSecond = await until(
      async () => (await waiting()).length === 2,
      10_000,
    );
    expect({ queuedFirst, queuedSecond }).toEqual({
      queuedFirst: true,
      queuedSecond: true,
    });

    await holder.release();
    await takingFirst;
    expect({ firstTaken, secondTaken }).toEqual({
      firstTaken: true,
      secondTaken: false,
    });
    await first.release();
    await takingSecond;
    expect(secondTaken).toBe(true);
  } finally {
    await holder.release();
    await first.release();
    await second.release();
  }
}, 60_000);

// A turn held past its time is found in pg_stat_activity by the spec it
// belongs to: CI's Database waits step prints each holder's name.
it('names its spec file on the session that holds the turn', async () => {
  const turn = databaseTurn(databaseUrl);
  await turn.take();
  try {
    const { rows } = await watcher.query<{ name: string }>(
      `SELECT a.application_name AS name
         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND l.objid = 79079 AND l.granted`,
    );
    expect(rows.map((row) => row.name)).toEqual([name]);
  } finally {
    await turn.release();
  }
}, 400_000);
