const nxPreset = require('@nx/jest/preset').default;

// Specs that need PostgreSQL or Redis are named *.integration.spec.ts.
// JEST_SUITE=unit leaves them out, JEST_SUITE=integration runs only them, and
// no JEST_SUITE runs everything. A chosen suite passes a project that has
// none of its specs, as the other suite may hold them all.
const INTEGRATION = '\\.integration\\.spec\\.ts$';
const suites = {
  integration: { testMatch: ['**/?(*.)integration.spec.ts'] },
  unit: { testPathIgnorePatterns: ['/node_modules/', INTEGRATION] },
};
const suite = process.env.JEST_SUITE;
if (suite && !(suite in suites))
  throw new Error(
    `JEST_SUITE must be "unit" or "integration", or unset; got "${suite}"`,
  );

// scripts/heavy.sh sets JEST_MAX_WORKERS so a run in a shared heavy-command
// slot stays small; Jest itself reads no such variable.
const maxWorkers = process.env.JEST_MAX_WORKERS;

// A worker that has grown past 1 GB after a file is replaced before the next
// one: the web suite's workers reached a 4 GB heap on CI and crashed.
module.exports = {
  ...nxPreset,
  workerIdleMemoryLimit: '1GB',
  ...(suite && { ...suites[suite], passWithNoTests: true }),
  ...(maxWorkers ? { maxWorkers } : {}),
};
