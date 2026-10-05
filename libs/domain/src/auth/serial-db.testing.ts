import { databaseTurn } from './database-turn.testing';

// Takes the turn for a whole spec file.
export function serialDatabase(databaseUrl: string) {
  const turn = databaseTurn(databaseUrl);
  beforeAll(turn.take, 120_000);
  afterAll(turn.release);
}
