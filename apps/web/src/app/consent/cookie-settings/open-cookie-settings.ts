import type { Overlays } from '@motor-fix/overlays';

// "Setări cookie", loaded on the first tap so the dialog and its switch stay
// out of every page's initial bundle.
export async function openCookieSettings(overlays: Overlays): Promise<unknown> {
  const { CookieSettings } = await import('./cookie-settings');
  return overlays.open(CookieSettings, {
    shape: 'dialog',
    title: 'consent.dialog.title',
  });
}
