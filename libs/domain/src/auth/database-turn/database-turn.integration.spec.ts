import { createRequire } from 'node:module';

import { Pool } from 'pg';

import { databaseTurn, TURN_WAIT_MS } from './database-turn.testing';

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

// This file's takes still waiting: CI's other spec files queue on the turn too.
const waiting = async () => {
  const { rows } = await watcher.query<{ pid: number }>(
    `SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.objid = 79079 AND NOT l.granted
        AND a.application_name = $1`,
    [name],
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
it(
  'a take still waiting when released closes its session and never holds the turn',
  async () => {
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
  },
  TURN_WAIT_MS,
);

// The turn goes out in the order it was asked for: a take polled for it
// instead could lose every round to newer spec files until its hook timed out,
// which failed whole files of CI's integration run while the turn moved on.
it(
  'queues a waiting take in PostgreSQL, so the first to ask is the next to hold',
  async () => {
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
  },
  TURN_WAIT_MS,
);

// A turn held past its time is found in pg_stat_activity by the spec it
// belongs to: CI's Database waits step prints each holder's name.
it(
  'names its spec file on the session that holds the turn',
  async () => {
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
  },
  TURN_WAIT_MS,
);

// A file's teardown, where apiBoot gives its turn back, can load no module: a
// client made there to call a waiting take off threw, and the take it left
// queued held the turn once granted, until every later file's hook timed out.
it(
  'makes the client that calls a waiting take off before the take waits',
  async () => {
    const pg = createRequire(__filename)('pg') as typeof import('pg');
    const Real = pg.Client;
    const holder = databaseTurn(databaseUrl);
    await holder.take();
    const late = databaseTurn(databaseUrl);
    const made = vi
      .spyOn(pg, 'Client')
      .mockImplementation((config) => new Real(config));
    try {
      const taking = late.take();
      expect(
        await until(async () => (await waiting()).length === 1, 10_000),
      ).toBe(true);
      const before = made.mock.calls.length;
      await late.release();
      await taking;
      expect({ after: made.mock.calls.length, before }).toEqual({
        after: 1,
        before: 1,
      });
    } finally {
      made.mockRestore();
      await late.release();
      await holder.release();
    }
  },
  TURN_WAIT_MS,
);
