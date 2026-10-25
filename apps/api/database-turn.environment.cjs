// The domain's Jest environment, which gives a database turn back once the
// whole file is done (apiBoot hands it its stop). Named here so the config
// keeps it on the one line Stryker reads (scripts/mutation.ts).
module.exports = require('../../libs/domain/src/auth/database-turn.environment.cjs');
