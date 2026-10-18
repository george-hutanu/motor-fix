import { expect, type Page } from '@playwright/test';

import { hydrated, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// The seeded driver with a Dacia Logan, and the garage that works on Dacia
// and has an oil change on its price list (quote-request.spec.ts).
const DRIVER = 'cerere@example.test';
const OIL = 'Schimb de ulei și filtre';

// What the keyboard focus sits on, in the page: the focused element, or the
// label of a visually hidden input (a radio, a switch), its box, whether it
// shows a ring and what is drawn at its centre.
function focusFacts() {
  const focused = document.activeElement as HTMLElement | null;
  if (!focused || focused === document.body) return null;
  const own = focused.getBoundingClientRect();
  const hidden = own.width <= 1 || own.height <= 1;
  const label = hidden
    ? (focused.closest('label') ??
      document.querySelector(`label[for="${focused.id}"]`))
    : null;
  const shown = (label as HTMLElement | null) ?? focused;
  const rect = shown.getBoundingClientRect();
  const style = getComputedStyle(focused);
  const top = document.elementFromPoint(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  const clear =
    top !== null &&
    (shown === top || shown.contains(top) || top.contains(shown));
  return {
    covered: !clear,
    coveredBy: top
      ? `${top.tagName.toLowerCase()}.${[...top.classList].join('.')} in ${[
          ...document.querySelectorAll('*'),
        ]
          .filter((e) => e.tagName.includes('-') && e.contains(top))
          .pop()
          ?.tagName.toLowerCase()}`
      : 'nothing',
    focused: `${focused.tagName.toLowerCase()} "${(focused.getAttribute('aria-label') ?? focused.textContent ?? '').trim().slice(0, 40)}"`,
    labelled: label !== null,
    outline: [style.outlineStyle, style.outlineWidth, style.boxShadow],
    rect: rect.toJSON() as DOMRect,
    viewport: [window.innerWidth, window.innerHeight],
  };
}

// The focus is shown, ringed and not covered.
async function focusShows(page: Page) {
  const facts = await page.evaluate(focusFacts);
  expect(facts, 'something has the focus').not.toBeNull();
  if (!facts) return;
  const { rect, viewport, outline } = facts;
  const [outlineStyle, outlineWidth, boxShadow] = outline;
  expect(rect.width * rect.height, 'the focus has a box').toBeGreaterThan(0);
  const inView =
    rect.bottom > 0 &&
    rect.top < viewport[1] &&
    rect.right > 0 &&
    rect.left < viewport[0];
  expect(inView, `the focus on ${facts.focused} is in view`).toBe(true);
  const ringed =
    facts.labelled ||
    (outlineStyle !== 'none' && Number.parseFloat(outlineWidth) > 0) ||
    boxShadow !== 'none';
  expect(ringed, `the focus on ${facts.focused} has a ring`).toBe(true);
  expect(
    facts.covered,
    `the focus on ${facts.focused} is covered by ${facts.coveredBy}`,
  ).toBe(false);
}

// Presses Tab until the focus is on `target`, checking every stop on the way;
// past the page's last control the focus leaves for the browser's own
// controls once, then comes back to the skip link.
async function tabTo(
  page: Page,
  target: ReturnType<Page['locator']>,
  limit = 60,
) {
  // A screen drawn from data shows a placeholder first: tabbing past it
  // reaches the footer, which the list then pushes out of view.
  await expect(target).toBeVisible();
  let wrapped = false;
  // The stops so far, named when the focus falls to the page a second time.
  const trail: string[] = [];
  for (let presses = 0; presses < limit; presses++) {
    await page.keyboard.press('Tab');
    const left = await page.evaluate(
      () => document.activeElement === document.body,
    );
    if (left && !wrapped) {
      wrapped = true;
      continue;
    }
    expect(left, `the focus left the page after ${trail.join(' | ')}`).toBe(
      false,
    );
    trail.push((await page.evaluate(focusFacts))?.focused ?? '');
    await focusShows(page);
    if (
      await target
        .evaluate((e) => e === document.activeElement)
        .catch(() => false)
    )
      return;
  }
  throw new Error(`Tab never reached ${target}`);
}

// @traces 248-FR-004
// @traces 248-FR-005
// @traces 248-FR-006
test.describe('the core flow by keyboard alone @seeded', () => {
  test('from home to a sent request, every stop visible and ringed', async ({
    page,
  }) => {
    // Signed in first, at desktop size where the site bar shows its sign-in
    // button, so the request goes out without the sign-in sheet.
    await ready(page, '/ro');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, DRIVER);
    await expect(page).toHaveURL('/app/driver');
    await page.setViewportSize({ height: 844, width: 390 });
    await hydrated(page, '/ro');

    // The skip link is the first stop and lands on the main content.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Sari la conținut' });
    await expect(skip).toBeFocused();
    await focusShows(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('main').first()).toBeFocused();

    // The place dialog opens and Escape brings the focus back to its opener.
    const place = page.locator('mf-home .place').getByRole('button');
    await tabTo(page, place);
    await page.keyboard.press('Enter');
    await expect(
      page
        .getByRole('dialog', { name: 'Alege locul' })
        .locator('mf-overlay-panel'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Alege locul' })).toHaveCount(
      0,
    );
    await expect(place).toBeFocused();

    // A brand, by arrow keys inside its radio group.
    const brands = page.getByRole('radiogroup', { name: 'Marca mașinii' });
    await tabTo(page, brands.getByRole('radio', { checked: true }));
    await page.keyboard.press('ArrowRight');
    await brands.getByRole('radio', { name: 'Dacia' }).focus();
    await page.keyboard.press('Space');
    await expect(brands.getByRole('radio', { name: 'Dacia' })).toBeChecked();

    await tabTo(page, page.getByRole('link', { name: 'Caută service‑uri' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/ro/garages?brand=dacia');
    await hydrated(page);

    const results = page.getByRole('list', { name: 'Service‑uri găsite' });
    const militari = results.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: 'Service Auto Militari' }),
    });
    await tabTo(page, militari.getByRole('link', { name: 'Vezi service‑ul' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/ro\/garages\/service-auto-militari/);
    await hydrated(page);

    await tabTo(
      page,
      page.getByRole('button', { exact: true, name: 'Cere ofertă' }),
    );
    await page.keyboard.press('Enter');
    const quote = page.getByRole('dialog', { name: 'Cere ofertă' });
    await expect(quote.locator('mf-overlay-panel')).toBeVisible();

    const oil = quote.getByRole('switch', { name: OIL });
    await tabTo(page, oil);
    await page.keyboard.press('Space');
    await expect(oil).toBeChecked();

    await tabTo(page, quote.getByRole('button', { name: 'Trimite' }));
    await page.keyboard.press('Enter');
    await expect(
      quote.getByText('Trimis către Service Auto Militari.'),
    ).toBeVisible();

    await tabTo(page, quote.getByRole('link', { name: 'Vezi Cererile mele' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/app/driver/requests');
    await expect(page.locator('[data-request]').first()).toContainText(OIL);
  });

  test('Escape closes the sign-in sheet and the focus goes back to its button', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 568, width: 320 });
    await ready(page, '/ro');

    // On a phone the site bar's account button opens the sign-in sheet.
    const opener = page.getByRole('button', { exact: true, name: 'Cont' });
    await tabTo(page, opener);
    await page.keyboard.press('Enter');
    // On a phone the dialog's own box is empty; its panel is what shows.
    const sheet = page.getByRole('dialog', { name: 'Autentificare' });
    await expect(sheet.locator('mf-overlay-panel')).toBeVisible();
    // The sheet takes the focus once it has opened; a Tab before that would
    // start from the page behind it.
    const inSheet = () =>
      page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') != null,
      );
    await expect.poll(inSheet).toBe(true);
    await page.keyboard.press('Tab');
    await expect.poll(inSheet).toBe(true);
    await focusShows(page);

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  // @traces 248-FR-010
  test('a result opens its garage profile from the keyboard', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 568, width: 320 });
    await ready(page, '/ro/garages?brand=dacia');

    const results = page.getByRole('list', { name: 'Service‑uri găsite' });
    const first = results
      .locator('mf-result-card')
      .first()
      .getByRole('link')
      .first();
    await tabTo(page, first);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/ro\/garages\/[\w-]+/);
  });
});
