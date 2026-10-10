import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { openCookieSettings } from './open-cookie-settings';
import { Consent } from '../consent';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let consent: { granted: ReturnType<typeof signal<boolean>>; save: jest.Mock };

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(granted: boolean, language: 'ro' | 'en' = 'ro') {
  consent = { granted: signal(granted), save: jest.fn(async () => undefined) };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Consent, useValue: consent }],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('consent');
  await i18n.use(language);
  const host = TestBed.createComponent(Host);
  const closed = openCookieSettings(host.componentInstance.overlays);
  await settle();
  return closed;
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const toggle = () =>
  panel().querySelector<HTMLButtonElement>('button[role="switch"]');
const press = (name: string) =>
  (
    [
      ...panel().querySelectorAll<HTMLButtonElement>(
        'mf-cookie-settings button',
      ),
    ].find((b) => b.textContent?.trim() === name) as HTMLButtonElement
  ).click();

// @traces 244-FR-006 244-FR-014
describe('the cookie settings dialog', () => {
  it('shows the switch, the line, the privacy notice and the two buttons', async () => {
    void open(true);
    await settle();

    expect(panel().textContent).toContain('Setări cookie');
    expect(panel().textContent).toContain('Statistici de utilizare');
    expect(panel().textContent).toContain(
      'Măsurăm paginile vizitate, fără cookie‑uri și fără să te identificăm.',
    );
    const link = panel().querySelector('mf-cookie-settings a');
    expect(link?.getAttribute('href')).toBe('/ro/privacy');
    expect(link?.textContent?.trim()).toBe('Nota de informare');
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
    const names = [
      ...panel().querySelectorAll('mf-cookie-settings button:not([role])'),
    ].map((b) => b.textContent?.trim());
    expect(names).toEqual(['Salvează', 'Renunță']);
  });

  it('reads English', async () => {
    void open(false, 'en');
    await settle();

    expect(panel().textContent).toContain('Cookie settings');
    expect(panel().textContent).toContain(
      'We count the pages visited, with no cookies and without identifying you.',
    );
    expect(
      panel().querySelector('mf-cookie-settings a')?.getAttribute('href'),
    ).toBe('/en/privacy');
  });

  it('starts off when no valid "granted" holds', async () => {
    void open(false);
    await settle();

    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
  });

  it('saves a changed switch', async () => {
    const closed = open(true);
    await settle();

    toggle()?.click();
    await settle();
    press('Salvează');
    await closed;

    expect(consent.save).toHaveBeenCalledWith(false);
  });

  // An unchanged switch is handed on as it is: Consent.save stores nothing
  // for it (consent.spec.ts), the one place that rule is written.
  it('stores nothing on "Renunță" and leaves an unchanged save to Consent', async () => {
    const cancelled = open(true);
    await settle();
    toggle()?.click();
    await settle();
    press('Renunță');
    await cancelled;
    const first = consent;

    TestBed.resetTestingModule();
    const unchanged = open(false);
    await settle();
    press('Salvează');
    await unchanged;

    expect(first.save).not.toHaveBeenCalled();
    expect(consent.save).toHaveBeenCalledWith(false);
  });
});
