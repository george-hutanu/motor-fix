import { ACCOUNTS } from './accounts.js';

// The garage-only account becomes a driver when add-car.spec adds its first
// car, and a local database is kept between runs. A local run first gives it
// back its seeded state (global-setup.ts): garage only, last seen as a garage,
// no cars. CI starts a fresh database each run.
const RESET = `WITH owner AS (SELECT id FROM account WHERE email = $1),
  cars AS (DELETE FROM car WHERE owner_id IN (SELECT id FROM owner)),
  roles AS (DELETE FROM account_role
    WHERE account_id IN (SELECT id FROM owner) AND role = 'driver')
UPDATE account SET last_role = 'garage' WHERE id IN (SELECT id FROM owner)`;

// The one call the reset needs; a pg client has it.
type Database = {
  query(text: string, values: unknown[]): Promise<{ rowCount: number | null }>;
};

// Returns whether the account was there to reset.
export async function resetGarageOnly(db: Database): Promise<boolean> {
  const { rowCount } = await db.query(RESET, [ACCOUNTS.garageOnly]);
  return (rowCount ?? 0) > 0;
}
