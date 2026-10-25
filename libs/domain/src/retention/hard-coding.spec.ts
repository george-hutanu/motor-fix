import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ANONYMISED } from './retention.config';

// The config and the module's scheduler options are the only places a number
// may sit; every other source here is a sweep, today's or a later one.
const NOT_SWEEPS = new Set(['retention.config.ts', 'retention.module.ts']);

const sweeps = () =>
  readdirSync(__dirname).filter(
    (name) =>
      name.endsWith('.ts') &&
      !NOT_SWEEPS.has(name) &&
      !/\.(spec|testing)\.ts$/.test(name),
  );

// Comments and quoted strings go; template text stays, so a number written
// into a query is caught too.
function literals(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''");
  return (code.match(/\b\d[\d_]*(?:\.\d+)?\b/g) ?? []).filter(
    (n) => n !== '0' && n !== '1',
  );
}

// @traces 1156-FR-002
describe('the retention sweeps', () => {
  it('exist', () => {
    expect(sweeps().length).toBeGreaterThan(0);
  });

  it.each(sweeps())('%s names no period or batch of its own', (name) => {
    expect(literals(readFileSync(join(__dirname, name), 'utf8'))).toEqual([]);
  });

  it('would fail a sweep that holds a period of its own', () => {
    expect(
      literals(
        'const cutoff = new Date(now.getTime() - 90 * 86_400_000); // 30',
      ),
    ).toEqual(['90', '86_400_000']);
    expect(literals('sql`DELETE ... LIMIT 500`')).toEqual(['500']);
    expect(literals("const kind = 'v2'; let i = 0; i += 1;")).toEqual([]);
  });
});

// @traces 1156-FR-008
describe('the anonymised marker', () => {
  it('is the one the database admits', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261025090000_retention/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain(`'${ANONYMISED}'`);
  });
});
