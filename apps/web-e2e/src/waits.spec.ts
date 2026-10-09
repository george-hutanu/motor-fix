import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { test } from './fixtures.js';

// Every page listens for maintenance: a public page opens the public live
// stream once it has gone quiet, and a stream never ends, so a networkidle
// wait on it races that stream and can hang. Pages wait through settled()
// in accounts.ts, the one place allowed to name networkidle (dashboards only).
// @traces 261-FR-010
test('no spec waits for networkidle on its own', () => {
  const dir = import.meta.dirname;
  const waits = readdirSync(dir)
    .filter((file) => file.endsWith('.ts') && file !== 'accounts.ts')
    .filter((file) =>
      /waitForLoadState\(\s*['"]networkidle['"]/.test(
        readFileSync(join(dir, file), 'utf8'),
      ),
    );

  expect(waits).toEqual([]);
});
