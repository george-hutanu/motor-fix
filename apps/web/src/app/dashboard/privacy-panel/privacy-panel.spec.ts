import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { PrivacyPanel } from './privacy-panel';
import { CookieSettings } from '../../consent/cookie-settings/cookie-settings';

let overlays: { open: jest.Mock };

async function render(language: 'ro' | 'en' = 'ro') {
  overlays = { open: jest.fn(async () => undefined) };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Overlays, useValue: overlays }],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('consent');
  await i18n.use(language);
  const fixture = TestBed.createComponent(PrivacyPanel);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

// @traces 244-FR-006 244-FR-014
describe('the privacy panel of a dashboard', () => {
  it('carries "Setări cookie" under "Confidențialitate"', async () => {
    const host = await render();

    expect(host.querySelector('h2')?.textContent?.trim()).toBe(
      'Confidențialitate',
    );
    expect(host.querySelector('button')?.textContent?.trim()).toBe(
      'Setări cookie',
    );
  });

  it('reads English', async () => {
    const host = await render('en');

    expect(host.querySelector('h2')?.textContent?.trim()).toBe('Privacy');
    expect(host.querySelector('button')?.textContent?.trim()).toBe(
      'Cookie settings',
    );
  });

  it('opens the cookie settings dialog', async () => {
    const host = await render();

    host.querySelector('button')?.click();
    // The dialog loads with its first opening.
    for (let i = 0; i < 50 && !overlays.open.mock.calls.length; i++)
      await new Promise((resolve) => setTimeout(resolve));

    expect(overlays.open).toHaveBeenCalledWith(
      CookieSettings,
      expect.objectContaining({ title: 'consent.dialog.title' }),
    );
  });
});

// @traces 244-FR-015
describe('news e-mails beside the privacy panel', () => {
  it('stay with their own switch: the panel holds no switch and no news control', async () => {
    const host = await render();

    expect(host.querySelectorAll('[role="switch"], input')).toHaveLength(0);
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.textContent).not.toMatch(/news|noutăți/i);
  });
});
