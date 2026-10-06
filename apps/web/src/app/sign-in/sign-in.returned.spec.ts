import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { SignIn } from './sign-in';
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

async function open(
  problem: { code: string; provider: 'google' | 'apple' },
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { signIn: jest.fn() } }],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  void host.componentInstance.overlays.open(SignIn, {
    data: { problem },
    shape: 'dialog',
    title: 'public.signIn.title',
  });
  await settle();
}

const alertText = () =>
  document
    .querySelector('mf-overlay-panel [role="alert"]')
    ?.textContent?.trim() ?? '';

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('sign-in after a provider gave no session', () => {
  it.each([
    [
      'google',
      'Nu am putut contacta Google. Încearcă din nou sau intră cu e‑mail sau telefon.',
    ],
    [
      'apple',
      'Nu am putut contacta Apple. Încearcă din nou sau intră cu e‑mail sau telefon.',
    ],
  ] as const)(
    'names %s when it could not be reached',
    async (provider, text) => {
      await open({ code: 'failed', provider });

      expect(alertText()).toBe(text);
    },
  );

  it('says in English that the provider could not be reached', async () => {
    await open({ code: 'failed', provider: 'google' }, 'en');

    expect(alertText()).toBe(
      'We could not reach Google. Try again, or use e-mail or phone.',
    );
  });

  it('says in English that the e-mail already has an account', async () => {
    await open({ code: 'email_taken', provider: 'google' }, 'en');

    expect(alertText()).toBe(
      'An account already uses this e-mail. Sign in with e-mail and password.',
    );
  });

  it.each([
    ['maintenance', 'MotorFix'],
    ['suspended', 'suspendat'],
  ])('explains %s', async (code, part) => {
    await open({ code, provider: 'google' });

    expect(alertText()).toContain(part);
  });
});
