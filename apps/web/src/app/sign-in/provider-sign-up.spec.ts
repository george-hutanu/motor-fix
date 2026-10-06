import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { ProviderSignUp } from './provider-sign-up';
import type { AuthSwitch } from './sign-in';
import { Session } from '../dashboard/session';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

type Pending = {
  provider: 'google' | 'apple';
  name: string;
  email?: string;
} | null;

let completeProviderSignUp: jest.Mock;
let result: Promise<OverlayResult<'signed-in' | AuthSwitch>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(pending: Pending, language: 'ro' | 'en' = 'ro') {
  completeProviderSignUp = jest.fn(async () => ({ landing: '/app/driver' }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: Session,
        useValue: {
          completeProviderSignUp,
          providerPending: jest.fn(async () => pending),
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(ProviderSignUp, {
    shape: 'dialog',
    title: 'public.providerSignUp.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const nameField = () =>
  panel().querySelector<HTMLInputElement>(
    'input[autocomplete="name"]',
  ) as HTMLInputElement;
const consentBox = () =>
  panel().querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  ) as HTMLInputElement;
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement;
const alertText = () =>
  panel().querySelector('[role="alert"]')?.textContent?.trim() ?? '';

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('the new-person step after a provider', () => {
  it('names the provider and the e-mail, and offers the name the provider gave', async () => {
    await open({
      email: 'elena@example.test',
      name: 'Elena Pop',
      provider: 'google',
    });

    expect(panel().textContent).toContain('Google');
    expect(panel().textContent).toContain('elena@example.test');
    expect(nameField().value).toBe('Elena Pop');
    expect(consentBox().checked).toBe(false);
  });

  it('creates nothing until the consent is ticked', async () => {
    await open({
      email: 'elena@example.test',
      name: 'Elena Pop',
      provider: 'google',
    });

    button('Creează contul').click();
    await settle();

    expect(completeProviderSignUp).not.toHaveBeenCalled();
    expect(panel().textContent).toContain('Bifează');
  });

  it('creates the account with the typed name and the language, then closes signed in', async () => {
    await open({ email: 'ana@icloud.com', name: '', provider: 'apple' }, 'en');
    nameField().value = 'Ana Ionescu';
    nameField().dispatchEvent(new Event('input', { bubbles: true }));
    consentBox().click();

    button('Create account').click();
    await settle();

    expect(completeProviderSignUp).toHaveBeenCalledWith('Ana Ionescu', 'en');
    await expect(result).resolves.toBe('signed-in');
  });

  it('asks for a name when the provider gave none', async () => {
    await open({ name: '', provider: 'apple' });
    consentBox().click();

    button('Creează contul').click();
    await settle();

    expect(completeProviderSignUp).not.toHaveBeenCalled();
  });

  it('says so when the e-mail was taken meanwhile', async () => {
    await open({
      email: 'elena@example.test',
      name: 'Elena Pop',
      provider: 'google',
    });
    completeProviderSignUp.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { code: 'email_taken', status: 409 },
        status: 409,
      }),
    );
    consentBox().click();

    button('Creează contul').click();
    await settle();

    expect(alertText()).toContain('Există deja un cont cu acest e‑mail');
  });

  it('says the step expired, and offers sign-in again, when there is nothing left to finish', async () => {
    await open(null);

    expect(panel().textContent).toContain('Pasul a expirat');
    button('Intră în cont').click();
    await expect(result).resolves.toEqual({ email: '', switchTo: 'sign-in' });
  });

  it('closes without an account on cancel', async () => {
    await open({
      email: 'elena@example.test',
      name: 'Elena Pop',
      provider: 'google',
    });

    button('Anulează').click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(completeProviderSignUp).not.toHaveBeenCalled();
  });
});
