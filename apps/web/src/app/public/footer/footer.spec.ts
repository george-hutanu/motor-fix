import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { PublicFooter } from './footer';

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

  it('opens the cookie settings dialog', async () => {
    const host = await render();

    host.querySelector('button')?.click();

    expect(overlays.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: 'consent.dialog.title' }),
    );
  });
});
