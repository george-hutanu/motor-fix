import { Pool } from 'pg';

import { databaseTurn } from './database-turn.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const watcher = new Pool({ connectionString: databaseUrl, max: 1 });

afterAll(() => watcher.end());

// The sessions queued on the turn right now.
const waiting = async () => {
  const { rows } = await watcher.query<{ pid: number }>(
    `SELECT pid FROM pg_locks
      WHERE locktype = 'advisory' AND objid = 79079 AND NOT granted`,
  );
  return new Set(rows.map((row) => row.pid));
};

const until = async (check: () => Promise<boolean>, ms: number) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
};

const alive = async (pid: number) => {
  const { rowCount } = await watcher.query(
    'SELECT 1 FROM pg_stat_activity WHERE pid = $1',
    [pid],
  );
  return rowCount === 1;
};

// A beforeAll that times out on take() still gets its teardown: Jest runs the
// release while the take waits on the lock and gives up on it after its hook
// timeout. The take is granted later; the session it was granted on must not
// then sit idle holding the turn for the rest of the run.
it('gives the turn back when it is granted after its release', async () => {
  const holder = databaseTurn(databaseUrl);
  await holder.take();
  const before = await waiting();
  const late = databaseTurn(databaseUrl);
  // A Prisma query runs once awaited; then() is what Jest's await does.
  const granted = late.take().then(() => undefined);
  let pid: number | undefined;
  await until(async () => {
    pid = [...(await waiting())].find((one) => !before.has(one));
    return pid !== undefined;
  }, 10_000);
  if (pid === undefined) await holder.release();
  expect(pid).toBeDefined();

  void late.release();
  await holder.release();
  await granted;

  expect(await until(async () => !(await alive(pid as number)), 10_000)).toBe(
    true,
  );
}, 400_000);

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
    expect(rows.map((row) => row.name)).toEqual([
      'turn database-turn.integration.spec.ts',
    ]);
  } finally {
    await turn.release();
  }
}, 400_000);
