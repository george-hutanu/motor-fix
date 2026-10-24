import { databaseTurn } from './database-turn.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';

const within = <T>(ms: number, work: Promise<T>) =>
  Promise.race([
    work.then(() => 'settled' as const),
    new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), ms)),
  ]);

// A beforeAll that ran out of time abandons its take, and the afterAll gives
// the turn back. The wait must end there: one still queued on the lock took
// the turn once its holder let go and kept it, and every other spec waiting
// for it then waited out the CI job's 45 minutes.
it('gives up a take still waiting on release, at once and holding nothing', async () => {
  const holder = databaseTurn(databaseUrl);
  // Waits its own turn behind whichever spec holds it now.
  await holder.take();
  const waiter = databaseTurn(databaseUrl);
  try {
    const taking = waiter.take();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await within(5_000, waiter.release())).toBe('settled');
    expect(await within(5_000, taking)).toBe('settled');
  } finally {
    await holder.release();
  }
}, 400_000);
