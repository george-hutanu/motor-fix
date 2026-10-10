import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { ConsentBar } from './consent-bar';
import { Consent } from '../consent';

let consent: {
  accept: jest.Mock;
  refuse: jest.Mock;
  showBar: ReturnType<typeof signal<boolean>>;
};

async function render(language: 'ro' | 'en' = 'ro', shown = true) {
  consent = {
    accept: jest.fn(async () => undefined),
    refuse: jest.fn(async () => undefined),
    showBar: signal(shown),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Consent, useValue: consent }],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('consent');
  await i18n.use(language);
  const fixture = TestBed.createComponent(ConsentBar);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const buttons = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLButtonElement>('button'),
];

// @traces 244-FR-002 244-FR-014
describe('the consent bar', () => {
  it('asks in Romanian, as a region, with the privacy notice and two equal buttons', async () => {
    const host = await render();

    const region = host.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Statistici de utilizare');
    expect(region?.textContent).toContain(
      'MotorFix ar vrea să măsoare cum e folosit site‑ul, ca să‑l facem mai bun. Nu vindem și nu transmitem datele tale.',
    );
    const link = host.querySelector('a');
    expect(link?.textContent?.trim()).toBe('Nota de informare');
    expect(link?.getAttribute('href')).toBe('/ro/privacy');
    expect(buttons(host).map((b) => b.textContent?.trim())).toEqual([
      'Accept',
      'Refuz',
    ]);
    const [accept, refuse] = buttons(host);
    expect(accept?.className).toBe(refuse?.className);
  });

  it('asks in English', async () => {
    const host = await render('en');

    expect(host.textContent).toContain(
      'MotorFix would like to measure how the site is used, to make it better. We never sell or pass on your data.',
    );
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/en/privacy');
    expect(host.querySelector('a')?.textContent?.trim()).toBe('Privacy notice');
    expect(buttons(host).map((b) => b.textContent?.trim())).toEqual([
      'Accept',
      'Refuse',
    ]);
  });

  it('passes each answer to the consent', async () => {
    const host = await render();

    buttons(host)[0]?.click();
    buttons(host)[1]?.click();

    expect(consent.accept).toHaveBeenCalledTimes(1);
    expect(consent.refuse).toHaveBeenCalledTimes(1);
  });

  it('shows nothing once a choice holds', async () => {
    const host = await render('ro', false);

    expect(host.querySelector('[role="region"]')).toBeNull();
  });

  it('keeps its buttons at least 44 px high', () => {
    const css = readFileSync(join(__dirname, 'consent-bar.css'), 'utf8');

    expect(css).toMatch(/button\s*{[^}]*min-height:\s*44px/);
  });
});
