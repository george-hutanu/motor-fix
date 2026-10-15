// @traces 1230-FR-006
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { openSheet, stepButton, waitForText } from './flow-helpers.mjs';

// A page whose locators log what they were asked and fail the wait on demand.
function fakePage({ visible = true, clickFails = false } = {}) {
  const log = [];
  const locator = (what) => ({
    first: () => locator(`${what}.first`),
    locator: (sel) => locator(`${what} ${sel}`),
    click: async () => {
      log.push(['click', what]);
      if (clickFails) throw new Error('not clickable');
    },
    waitFor: async (opts) => {
      log.push(['waitFor', what, opts]);
      if (!visible) throw new Error('Timeout');
    },
  });
  return { log, getByText: (t) => (log.push(['getByText', t]), locator(`text:${t}`)), locator: (s) => locator(s), getByRole: (r, o) => (log.push(['getByRole', r, o]), locator(`role:${r}`)) };
}

describe('waitForText', () => {
  it('resolves to nothing when the text shows, waiting for visible within 10 s by default', async () => {
    const page = fakePage();
    assert.equal(await waitForText(page, 'Salut'), undefined);
    const w = page.log.find((l) => l[0] === 'waitFor');
    assert.equal(w[2].state, 'visible');
    assert.equal(w[2].timeout, 10000);
  });

  it('uses the wait the caller gives', async () => {
    const page = fakePage();
    await waitForText(page, 'x', 250);
    assert.equal(page.log.find((l) => l[0] === 'waitFor')[2].timeout, 250);
  });

  it('rejects naming the text and the wait', async () => {
    await assert.rejects(waitForText(fakePage({ visible: false }), 'Bell rang', 1234), (e) => e.message.includes('Bell rang') && e.message.includes('1234'));
  });

  it('names the default wait when the caller gave none', async () => {
    await assert.rejects(waitForText(fakePage({ visible: false }), 'x'), /10000|10 s/);
  });

  it('names text with quotes and regex characters as written', async () => {
    await assert.rejects(waitForText(fakePage({ visible: false }), 'a "b" (c)+'), (e) => e.message.includes('a "b" (c)+'));
  });
});

describe('openSheet', () => {
  it('clicks a locator trigger, then waits for content to be visible', async () => {
    const page = fakePage();
    const trigger = page.locator('#open');
    page.log.length = 0;
    await openSheet(page, trigger);
    assert.deepEqual(page.log.map((l) => l[0]), ['click', 'waitFor']);
    assert.equal(page.log[1][2].state, 'visible');
  });

  it('takes a selector string as the trigger', async () => {
    const page = fakePage();
    await openSheet(page, '#menu');
    assert.deepEqual(page.log[0], ['click', '#menu']);
  });

  it('rejects, naming the wait, when no content shows', async () => {
    await assert.rejects(openSheet(fakePage({ visible: false }), '#menu', 321), (e) => e.message.includes('321'));
  });

  it('lets a failed click reach the caller and waits for nothing', async () => {
    const page = fakePage({ clickFails: true });
    await assert.rejects(openSheet(page, '#menu'), /not clickable/);
    assert.equal(page.log.filter((l) => l[0] === 'waitFor').length, 0);
  });

  it('passes the wait to the content wait', async () => {
    const page = fakePage();
    await openSheet(page, '#menu', 77);
    assert.equal(page.log.find((l) => l[0] === 'waitFor')[2].timeout, 77);
  });
});

describe('stepButton', () => {
  it('asks for a button by the label it was given', () => {
    const page = fakePage();
    stepButton(page, 'Continue');
    assert.deepEqual(page.log[0], ['getByRole', 'button', { name: 'Continue' }]);
  });
});
