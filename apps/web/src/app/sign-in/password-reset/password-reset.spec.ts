import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { PasswordReset } from './password-reset';
import type { AuthSwitch } from '../sign-in';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let ask: jest.Mock;
let result: Promise<OverlayResult<AuthSwitch>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro', email = '') {
  ask = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { passwordResetControllerAsk: ask } },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<AuthSwitch, { email: string }>(
    PasswordReset,
    {
      data: { email },
      shape: 'dialog',
      title: 'public.passwordReset.title',
    },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

function field(label: string): HTMLInputElement {
  const found = [...panel().querySelectorAll('label')].find((l) =>
    l.textContent?.trim().startsWith(label),
  );
  const input = found?.htmlFor
    ? document.getElementById(found.htmlFor)
    : found?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label}`);
  return input;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

const text = () => panel().textContent ?? '';

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.restoreAllMocks();
});

// @traces 127-FR-010
describe('the reset task', () => {
  it('shows its title, one e-mail field holding the typed e-mail and "Trimite linkul"', async () => {
    await open('ro', 'andrei@example.ro');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Resetează parola',
    );
    const email = field('E‑mail');
    expect(email.type).toBe('email');
    expect(email.autocomplete).toBe('email');
    expect(email.value).toBe('andrei@example.ro');
    expect(panel().querySelectorAll('input')).toHaveLength(1);
    expect(button('Trimite linkul')?.type).toBe('submit');
  });

  it('sends the trimmed e-mail and shows the same line whatever the answer', async () => {
    await open();
    type(field('E‑mail'), '  andrei@example.ro ');

    button('Trimite linkul')?.click();
    await settle();

    expect(ask).toHaveBeenCalledWith({ body: { email: 'andrei@example.ro' } });
    expect(text()).toContain(
      'Dacă există un cont cu această adresă, ți‑am trimis un link.',
    );
    expect(panel().querySelector('[role="status"]')?.textContent).toContain(
      'ți‑am trimis un link',
    );
    expect(button('Trimite linkul')).toBeUndefined();
  });

  it('refuses an address that does not look like one, without sending', async () => {
    await open();
    type(field('E‑mail'), 'andrei');

    button('Trimite linkul')?.click();
    await settle();

    expect(ask).not.toHaveBeenCalled();
    expect(text()).toContain('Adresa de e‑mail nu pare corectă.');
  });

  it('keeps the form and says so when the call fails', async () => {
    await open('ro', 'andrei@example.ro');
    ask.mockRejectedValueOnce(
      new HttpErrorResponse({ error: null, status: 503 }),
    );

    button('Trimite linkul')?.click();
    await settle();

    expect(button('Trimite linkul')).toBeDefined();
    expect(panel().querySelector('[role="alert"]')?.textContent).not.toBe('');
  });

  it('goes back to sign-in with the e-mail', async () => {
    await open('ro', 'andrei@example.ro');
    button('Trimite linkul')?.click();
    await settle();

    button('Înapoi la autentificare')?.click();
    await settle();

    await expect(result).resolves.toEqual({
      email: 'andrei@example.ro',
      switchTo: 'sign-in',
    });
  });

  it('offers the way back before sending too', async () => {
    await open();
    type(field('E‑mail'), 'ana@example.ro');

    button('Înapoi la autentificare')?.click();
    await settle();

    expect(ask).not.toHaveBeenCalled();
    await expect(result).resolves.toEqual({
      email: 'ana@example.ro',
      switchTo: 'sign-in',
    });
  });

  it('reads English', async () => {
    await open('en', 'ann@example.com');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Reset your password',
    );
    button('Send the link')?.click();
    await settle();
    expect(text()).toContain(
      'If an account uses this address, we have sent a link.',
    );
    expect(button('Back to sign in')).toBeDefined();
  });
});
