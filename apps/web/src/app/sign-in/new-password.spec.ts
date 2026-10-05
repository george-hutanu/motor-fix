import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { NewPassword } from './new-password';
import type { AuthSwitch } from './sign-in';
import { Session } from '../dashboard/session';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const TOKEN = 'A'.repeat(43);

const problem = (
  status: number,
  code?: string,
  errors?: { code: string; field: string }[],
) =>
  new HttpErrorResponse({
    error: code ? { code, status, ...(errors && { errors }) } : null,
    status,
  });

let check: jest.Mock;
let resetPassword: jest.Mock;
let result: Promise<OverlayResult<'signed-in' | AuthSwitch>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  language: 'ro' | 'en' = 'ro',
  checked: () => Promise<unknown> = async () => undefined,
) {
  check = jest.fn(checked);
  resetPassword = jest.fn(async () => ({ landing: '/app/driver' }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AuthService,
        useValue: { passwordResetControllerCheck: check },
      },
      { provide: Session, useValue: { resetPassword } },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    'signed-in' | AuthSwitch,
    { token: string }
  >(NewPassword, {
    data: { token: TOKEN },
    shape: 'dialog',
    title: 'public.newPassword.title',
  });
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

describe('the new-password task', () => {
  it('checks the link, then asks for a new password', async () => {
    await open();

    expect(check).toHaveBeenCalledWith({ body: { token: TOKEN } });
    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Parolă nouă',
    );
    const input = field('Parolă nouă');
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('new-password');
    expect(text()).toContain('Cel puțin 8 caractere.');
    expect(button('Salvează parola')?.type).toBe('submit');
  });

  it('shows nothing to type while the link is being checked', async () => {
    await open('ro', () => new Promise(() => undefined));

    expect(panel().querySelector('input')).toBeNull();
    expect(panel().querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it.each([
    'token_expired',
    'token_invalid',
  ])('says the link expired for %s and offers a new one', async (code) => {
    await open('ro', async () => {
      throw problem(410, code);
    });

    expect(text()).toContain('Linkul a expirat');
    expect(panel().querySelector('input')).toBeNull();
    button('Cere un link nou')?.click();
    await settle();
    await expect(result).resolves.toEqual({ email: '', switchTo: 'reset' });
  });

  // The check answers nothing on success, so the client reads a refusal as text.
  it('says the link expired when the refusal arrives as text', async () => {
    await open('ro', async () => {
      throw new HttpErrorResponse({
        error: JSON.stringify({ code: 'token_invalid', status: 410 }),
        status: 410,
      });
    });

    expect(text()).toContain('Linkul a expirat');
  });

  it('saves the password, signs in and closes signed in', async () => {
    await open();
    type(field('Parolă nouă'), 'parola-noua-buna');

    button('Salvează parola')?.click();
    await settle();

    expect(resetPassword).toHaveBeenCalledWith(TOKEN, 'parola-noua-buna');
    await expect(result).resolves.toBe('signed-in');
  });

  it('refuses fewer than 8 characters before sending', async () => {
    await open();
    type(field('Parolă nouă'), 'scurt');

    button('Salvează parola')?.click();
    await settle();

    expect(resetPassword).not.toHaveBeenCalled();
    expect(field('Parolă nouă').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows weak_password under the field', async () => {
    await open();
    resetPassword.mockRejectedValueOnce(
      problem(400, 'weak_password', [
        { code: 'weak_password', field: 'password' },
      ]),
    );
    type(field('Parolă nouă'), 'password123');

    button('Salvează parola')?.click();
    await settle();

    expect(text()).toContain('este printre cele mai folosite');
    expect(button('Salvează parola')).toBeDefined();
  });

  it('switches to the expired state when the link stops working before the save', async () => {
    await open();
    resetPassword.mockRejectedValueOnce(problem(410, 'token_expired'));
    type(field('Parolă nouă'), 'parola-noua-buna');

    button('Salvează parola')?.click();
    await settle();

    expect(text()).toContain('Linkul a expirat');
    expect(button('Cere un link nou')).toBeDefined();
  });

  it('offers to try again when the check cannot reach the server', async () => {
    let calls = 0;
    await open('ro', async () => {
      calls++;
      if (calls === 1) throw problem(0);
    });

    expect(text()).not.toContain('Linkul a expirat');
    button('Încearcă din nou')?.click();
    await settle();
    expect(check).toHaveBeenCalledTimes(2);
    expect(field('Parolă nouă')).toBeDefined();
  });

  it('reads English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'New password',
    );
    expect(field('New password')).toBeDefined();
    expect(button('Save the password')).toBeDefined();
  });

  it('reads the expired state in English', async () => {
    await open('en', async () => {
      throw problem(410, 'token_expired');
    });

    expect(text()).toContain('The link has expired');
    expect(button('Ask for a new link')).toBeDefined();
  });
});
