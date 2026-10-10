import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { PublicFooter } from './footer';
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
  const fixture = TestBed.createComponent(PublicFooter);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const links = (host: HTMLElement) =>
  [...host.querySelectorAll('a')].map((a) => [
    a.textContent?.trim(),
    a.getAttribute('href'),
  ]);

// @traces 244-FR-006 244-FR-014
describe('the public footer', () => {
  it('holds the terms, the privacy notice and "Setări cookie"', async () => {
    const host = await render();

    expect(links(host)).toEqual([
      ['Termeni de utilizare', '/ro/terms'],
      ['Nota de informare', '/ro/privacy'],
    ]);
    expect(host.querySelector('button')?.textContent?.trim()).toBe(
      'Setări cookie',
    );
  });

  it('reads English', async () => {
    const host = await render('en');

    expect(links(host)).toEqual([
      ['Terms of use', '/en/terms'],
      ['Privacy notice', '/en/privacy'],
    ]);
    expect(host.querySelector('button')?.textContent?.trim()).toBe(
      'Cookie settings',
    );
  });

  it('spaces the items apart with no "·" glyph, so a narrow phone never starts or ends a line with one', async () => {
    const host = await render();

    expect(host.textContent).not.toContain('·');
    expect(host.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(host.querySelectorAll('nav > a, nav > button')).toHaveLength(3);
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
