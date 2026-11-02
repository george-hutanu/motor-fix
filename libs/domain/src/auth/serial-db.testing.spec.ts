// @traces 1338-FR-007
import { serialDatabase } from './serial-db.testing';

it('names the setup file it needs when the file has no database turn', () => {
  const global = globalThis as { releaseDatabaseTurnLast?: unknown };
  const saved = global.releaseDatabaseTurnLast;
  delete global.releaseDatabaseTurnLast;
  try {
    expect(() => serialDatabase('postgresql://localhost:5432/x')).toThrow(
      'serialDatabase needs setup file database-turn.setup.ts',
    );
  } finally {
    global.releaseDatabaseTurnLast = saved;
  }
});
