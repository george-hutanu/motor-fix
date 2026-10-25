import { databaseTurn } from '@motor-fix/domain/testing';

// A turn the handle kept would never come back; another file holding it
// gives it back well within this window, which matches the other takers'.
export async function expectTurnFree(databaseUrl: string) {
  const probe = databaseTurn(databaseUrl);
  let timer: NodeJS.Timeout | undefined;
  const leaked = new Promise<'leaked'>((resolve) => {
    timer = setTimeout(() => resolve('leaked'), 120_000);
  });
  const outcome = await Promise.race([
    probe.take().then(() => 'free' as const),
    leaked,
  ]);
  clearTimeout(timer);
  // A take still asking for the turn stops once released.
  await probe.release();
  expect(outcome).toBe('free');
}
