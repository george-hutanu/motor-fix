const nxPreset = require('@nx/jest/preset').default;

// scripts/heavy.sh sets JEST_MAX_WORKERS so a run under the shared lock stays
// small; Jest itself reads no such variable.
const maxWorkers = process.env.JEST_MAX_WORKERS;

module.exports = { ...nxPreset, ...(maxWorkers ? { maxWorkers } : {}) };
