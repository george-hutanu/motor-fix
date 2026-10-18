import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { PhoneSignIn } from './phone-sign-in/phone-sign-in';
import { Providers } from './providers/providers';
import { type AuthSwitch, SignIn } from './sign-in';
import { Consent } from '../consent/consent';
import { Session } from '../dashboard/session';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(screen: 'sign-in' | 'phone', language: 'ro' | 'en') {
  TestBed.configureTestingModule({
    providers: [
      { provide: Consent, useValue: { track: jest.fn() } },
      {
        provide: Session,
        useValue: {
          phoneCode: jest.fn(),
          signIn: jest.fn(),
          signInWithPhone: jest.fn(),
        },
      },
      {
        provide: Providers,
        useValue: { load: async () => ({ apple: false, google: true }) },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  void host.componentInstance.overlays.open<
    'signed-in' | AuthSwitch,
    { email: string } | undefined
  >(screen === 'sign-in' ? SignIn : PhoneSignIn, {
    data: screen === 'sign-in' ? undefined : { email: '' },
    shape: 'dialog',
    title: 'public.signIn.title',
  });
  await settle();
}

const label = () =>
  document.querySelector<HTMLLabelElement>(
    'mf-overlay-panel label.remember',
  ) as HTMLLabelElement;
const box = () => label().querySelector('input') as HTMLInputElement;

afterEach(() => {
  for (const p of document.querySelectorAll('mf-overlay-panel')) p.remove();
});

const css = (file: string) => readFileSync(join(__dirname, file), 'utf8');
const styles = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8');
const cockpit = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'libs/ui-cockpit/src/styles/cockpit.css',
  ),
  'utf8',
);

// @traces 248-FR-002
describe.each([
  ['sign-in' as const, 'ro' as const, 'Ține‑mă autentificat', 'sign-in.css'],
  ['sign-in' as const, 'en' as const, 'Keep me signed in', 'sign-in.css'],
  [
    'phone' as const,
    'ro' as const,
    'Ține‑mă autentificat',
    'phone-sign-in/phone-sign-in.css',
  ],
  [
    'phone' as const,
    'en' as const,
    'Keep me signed in',
    'phone-sign-in/phone-sign-in.css',
  ],
])(
  'the remember checkbox on %s in %s',
  (screen, language, text, stylesheet) => {
    it('is named by its label in the page language', async () => {
      await open(screen, language);

      expect(label().textContent?.trim()).toBe(text);
      expect(box().type).toBe('checkbox');
    });

    it('toggles from a tap on the label text and on the box, twice over', async () => {
      await open(screen, language);
      const before = box().checked;

      (label().querySelector('span') as HTMLElement).click();
      expect(box().checked).toBe(!before);
      box().click();
      expect(box().checked).toBe(before);
      label().click();
      expect(box().checked).toBe(!before);
    });

    it('is a 44 px box and its label a 44 px high hit area', async () => {
      await open(screen, language);

      expect(box().classList.contains('mf-check')).toBe(true);
      expect(cockpit).toMatch(/--mf-tap:\s*44px/);
      expect(styles).toMatch(
        /input\[type="checkbox"\]\.mf-check\s*\{[^}]*width:\s*var\(--mf-tap\)[^}]*height:\s*var\(--mf-tap\)/,
      );
      expect(css(stylesheet)).toMatch(
        /\.remember\s*\{[^}]*min-height:\s*var\(--mf-tap\)/,
      );
      expect(css(stylesheet)).not.toMatch(
        /\.remember\s*\{[^}]*(?<!min-)height:\s*\d+px/,
      );
    });

    it('is a keyboard stop that Space toggles', async () => {
      await open(screen, language);

      expect(box().tabIndex).toBe(0);
      expect(box().disabled).toBe(false);
    });
  },
);
