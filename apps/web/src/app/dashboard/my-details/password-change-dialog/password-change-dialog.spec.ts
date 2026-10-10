import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { PasswordChangeDialog } from './password-change-dialog';
import { Session } from '../../session';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const problem = (
  status: number,
  code: string,
  errors?: { code: string; field: string }[],
) =>
  new HttpErrorResponse({
    error: { code, status, ...(errors && { errors }) },
    status,
  });

let changePassword: jest.Mock;
let result: Promise<OverlayResult<'changed' | 'sign-in'>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(hasPassword = true, language: 'ro' | 'en' = 'ro') {
  changePassword = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { changePassword } }],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    'changed' | 'sign-in',
    { hasPassword: boolean }
  >(PasswordChangeDialog, {
    data: { hasPassword },
    shape: 'dialog',
    title: hasPassword
      ? 'driver.passwordChange.title'
      : 'driver.passwordChange.setTitle',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

const labels = () =>
  [...panel().querySelectorAll('label')].map((l) => l.textContent?.trim());

function field(label: string): HTMLInputElement {
  const found = [...panel().querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
  );
  const input = found?.htmlFor ? document.getElementById(found.htmlFor) : null;
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

async function submitChange(current = 'parola-veche', next = 'parola-noua') {
  type(field('Parola actuală'), current);
  type(field('Parola nouă'), next);
  button('Schimbă parola')?.click();
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

// @traces 139-edit-my-details-FR-014
// @traces 139-edit-my-details-FR-015
describe('the password dialog', () => {
  it('asks for the current and the new password, each with its autocomplete', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Schimbă parola',
    );
    expect(labels()).toEqual(['Parola actuală', 'Parola nouă']);
    const current = field('Parola actuală');
    const next = field('Parola nouă');
    expect(current.type).toBe('password');
    expect(current.autocomplete).toBe('current-password');
    expect(next.type).toBe('password');
    expect(next.autocomplete).toBe('new-password');
    expect(text()).toContain('8 la 128 de caractere');
    expect(button('Schimbă parola')?.type).toBe('submit');
  });

  it('sends both passwords as typed and closes with "changed"', async () => {
    await open();

    await submitChange(' veche cu spatii ', 'parola-noua-lunga');

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: ' veche cu spatii ',
      newPassword: 'parola-noua-lunga',
    });
    await expect(result).resolves.toBe('changed');
  });

  it.each([
    ['a new password under 8 characters', 'parola-veche', 'scurta7'],
    ['a new password over 128 characters', 'parola-veche', 'a'.repeat(129)],
    ['no current password', '', 'parola-noua'],
  ])('refuses %s before sending', async (_, current, next) => {
    await open();

    await submitChange(current, next);

    expect(changePassword).not.toHaveBeenCalled();
    expect(panel().querySelector('[aria-invalid="true"]')).not.toBeNull();
  });

  it('says the current password is not right', async () => {
    await open();
    changePassword.mockRejectedValueOnce(problem(401, 'invalid_credentials'));

    await submitChange();

    expect(text()).toContain('Parola actuală nu e corectă.');
  });

  it('says there were too many tries', async () => {
    await open();
    changePassword.mockRejectedValueOnce(problem(429, 'too_many_attempts'));

    await submitChange();

    expect(text()).toContain(
      'Prea multe încercări. Încearcă din nou mai târziu.',
    );
  });

  it('shows a common password under the new-password field, as sign-up does', async () => {
    await open();
    changePassword.mockRejectedValueOnce(
      problem(400, 'weak_password', [
        { code: 'weak_password', field: 'newPassword' },
      ]),
    );

    await submitChange('parola-veche', 'password1');

    const next = field('Parola nouă');
    expect(next.getAttribute('aria-invalid')).toBe('true');
    const described = (next.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain(
      'Alege o parolă mai greu de ghicit: este printre cele mai folosite.',
    );
  });

  it('speaks English', async () => {
    await open(true, 'en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Change the password',
    );
    expect(labels()).toEqual(['Current password', 'New password']);
    expect(text()).toContain('8 to 128 characters');
  });
});

// @traces 139-edit-my-details-FR-016
describe('setting a password', () => {
  it('asks only for the new password, under "Setează o parolă"', async () => {
    await open(false);

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Setează o parolă',
    );
    expect(labels()).toEqual(['Parola nouă']);
    expect(button('Setează parola')?.type).toBe('submit');
  });

  it('sends the new password alone and closes with "changed"', async () => {
    await open(false);
    type(field('Parola nouă'), 'parola-noua-lunga');

    button('Setează parola')?.click();
    await settle();

    expect(changePassword).toHaveBeenCalledWith({
      newPassword: 'parola-noua-lunga',
    });
    await expect(result).resolves.toBe('changed');
  });

  it('asks to sign in again when the sign-in is not recent, and closes with "sign-in" from its button', async () => {
    await open(false);
    changePassword.mockRejectedValueOnce(
      problem(403, 'recent_sign_in_required'),
    );
    type(field('Parola nouă'), 'parola-noua-lunga');
    button('Setează parola')?.click();
    await settle();

    expect(text()).toContain('Intră din nou în cont ca să setezi o parolă.');
    button('Intră din nou în cont')?.click();
    await settle();

    await expect(result).resolves.toBe('sign-in');
  });

  it('speaks English', async () => {
    await open(false, 'en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Set a password',
    );
    expect(button('Set the password')).toBeDefined();
  });
});
