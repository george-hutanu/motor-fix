import { databaseTurn, TURN_WAIT_MS } from './database-turn.testing';

type TurnGlobal = {
  releaseDatabaseTurnLast?: (release: () => Promise<void>) => void;
};

// Takes the turn for a whole spec file.
export function serialDatabase(databaseUrl: string) {
  const releaseLast = (globalThis as TurnGlobal).releaseDatabaseTurnLast;
  if (!releaseLast)
    throw new Error(
      'serialDatabase needs testEnvironment database-turn.environment.cjs',
    );
  const turn = databaseTurn(databaseUrl);
  beforeAll(turn.take, TURN_WAIT_MS);
  // Given back after every afterAll of the spec, not before them.
  releaseLast(turn.release);
}
