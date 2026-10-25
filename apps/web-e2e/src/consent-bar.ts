import { expect, type Page } from '@playwright/test';

// On a phone the consent bar and the tab bar pinned at the bottom leave what
// sits under them out of reach of a click or a drag, and the bar grew when it
// named Grafana Faro: answer it first, as a visitor does on their first page.
export async function answerConsent(page: Page) {
  const bar = page.getByRole('region', { name: 'Statistici de utilizare' });
  await bar.getByRole('button', { exact: true, name: 'Refuz' }).click();
  await expect(bar).toBeHidden();
}
