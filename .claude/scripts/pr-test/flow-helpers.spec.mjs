// @traces 1230-FR-006
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { SEEDED } from './endpoints.mjs';
import { accounts, openSheet, stepButton, waitForText } from './flow-helpers.mjs';

// Fakes that record what was asked of the page, in the order it was asked.
function fakePage({ visible = true } = {}) {
  const calls = [];
  const locator = (desc) => ({
    desc,
    first: () => locator(`${desc}.first()`),
    locator: (sel) => locator(`${desc}.locator(${sel})`),
    click: async () => calls.push(['click', desc]),
    waitFor: async (opts) => {
      calls.push(['waitFor', desc, opts]);
      if (!visible) throw new Error(`locator.waitFor: Timeout ${opts.timeout}ms exceeded.`);
    },
  });
  const page = {
    getByText: (text) => locator(`text=${text}`),
    getByRole: (role, opts) => locator(`role=${role}[name=${opts?.name}]`),
    locator: (sel) => locator(sel),
  };
  return { page, calls, locator };
}

describe('waitForText', () => {
  it('waits up to 10 s for the text to be visible', async () => {
    const { page, calls } = fakePage();
    await waitForText(page, 'Oferta a fost trimisă');
    assert.deepEqual(calls, [['waitFor', 'text=Oferta a fost trimisă.first()', { state: 'visible', timeout: 10000 }]]);
  });

  it('takes another wait when the caller gives one', async () => {
    const { page, calls } = fakePage();
    await waitForText(page, 'x', 2500);
    assert.equal(calls[0][2].timeout, 2500);
  });

  it('rejects naming the text and the wait', async () => {
    const { page } = fakePage({ visible: false });
    await assert.rejects(waitForText(page, 'Programare confirmată', 3000), /"Programare confirmată" not visible within 3000 ms/);
  });
});

describe('openSheet', () => {
  it("clicks the trigger, then waits for the open sheet's content, never the container's box", async () => {
    const { page, calls, locator } = fakePage();
    await openSheet(page, locator('button#filters'));
    assert.deepEqual(calls[0], ['click', 'button#filters']);
    assert.equal(calls[1][0], 'waitFor');
    assert.match(calls[1][1], /^\[data-slot="sheet-content"\]\[data-state="open"\] > \*/);
    assert.equal(calls[1][2].state, 'visible');
    assert.equal(calls.length, 2);
  });

  it('takes the trigger as a selector too', async () => {
    const { page, calls } = fakePage();
    await openSheet(page, 'button#filters');
    assert.deepEqual(calls[0], ['click', 'button#filters']);
  });

  it('rejects naming the trigger when the content never shows', async () => {
    const { page } = fakePage({ visible: false });
    await assert.rejects(openSheet(page, 'button#filters'), /sheet opened by button#filters showed no content within 10000 ms/);
  });
});

describe('stepButton', () => {
  it("is the step's button visible at this viewport, the hidden phone or desktop copy skipped", () => {
    const { page } = fakePage();
    assert.equal(stepButton(page, 'Diagnoză').desc, 'role=button[name=Diagnoză].locator(visible=true).first()');
  });
});

describe('accounts', () => {
  it('is the seeded role-to-e-mail map the API calls sign in with', () => {
    assert.equal(accounts, SEEDED);
    assert.equal(accounts.driver, 'sofer@example.test');
  });

  it('cannot be changed by a flows file, so a later sign-in still uses the seeded account', () => {
    assert.ok(Object.isFrozen(accounts));
    assert.throws(() => {
      accounts.driver = 'someone@else.test';
    }, TypeError);
    assert.equal(SEEDED.driver, 'sofer@example.test');
  });
});
