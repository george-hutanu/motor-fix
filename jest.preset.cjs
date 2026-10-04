const nxPreset = require('@nx/jest/preset').default;

// Specs that need PostgreSQL or Redis are named *.integration.spec.ts.
// JEST_SUITE=unit leaves them out, JEST_SUITE=integration runs only them, and
// no JEST_SUITE runs everything.
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

module.exports = { ...nxPreset, ...(suite && suites[suite]) };
