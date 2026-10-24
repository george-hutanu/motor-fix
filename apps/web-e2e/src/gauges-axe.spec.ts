import { expect } from '@playwright/test';

import { violations } from './axe.js';
import { test } from './fixtures.js';

// The gauges catalogue (the /cockpit sample page) scanned by axe with its
// default rules over the whole page, once per theme: nothing is disabled or
// excluded, so a finding is fixed in the product, never filtered here.

// @traces 451-gauges-axe-FR-001
// @traces 451-gauges-axe-FR-002
// @traces 451-gauges-axe-FR-003
// @traces 451-gauges-axe-FR-004
for (const scheme of ['light', 'dark'] as const) {
  test(`the gauges catalogue has no axe violations in ${scheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/cockpit');
    await expect(
      page.locator('mf-cockpit-gauges-sample mf-lamp').first(),
    ).toBeVisible();
    // Axe reads colours as drawn: a part still rolling or fading in would read
    // as low contrast, so the scan waits until no finite animation runs.
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (a) =>
            a.playState !== 'running' ||
            a.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
        ),
    );

    const found = (await violations(page, { resultTypes: ['violations'] })).map(
      (v) =>
        `${scheme}: ${v.id} ${v.nodes.map((n) => JSON.stringify(n.target)).join(' ')}`,
    );

    expect(found).toEqual([]);
  });
}
