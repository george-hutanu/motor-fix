import { workerUrls } from './src/mutation-db.testing';
import { nestPreset } from '../../vitest.preset.mts';

// Under Stryker each worker reaches its own database and Redis index;
// mutation-db.setup.ts copies the migrated database it started from.
if (process.env['STRYKER_MUTATOR_WORKER'] !== undefined) {
  process.env['MUTATION_TEMPLATE_URL'] ??= process.env['DATABASE_URL'];
  const urls = workerUrls({
    ...process.env,
    DATABASE_URL: process.env['MUTATION_TEMPLATE_URL'],
  });
  for (const [key, value] of Object.entries(urls))
    if (value !== undefined) process.env[key] = value;
}

const config = nestPreset(import.meta.dirname, {
  setupFiles: [
    'src/auth/database-turn/database-turn.setup.ts',
    'src/integration-timeout.testing.ts',
    '../observability/src/testing/otel-reset.ts',
  ],
});
config.test = { ...config.test, globalSetup: ['mutation-db.setup.ts'] };

export default config;
