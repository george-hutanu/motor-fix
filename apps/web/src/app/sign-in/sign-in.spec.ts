import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { type AuthSwitch, SignIn } from './sign-in';
import { Session } from '../dashboard/session';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const problem = (status: number, code?: string) =>
  new HttpErrorResponse({
    error: code ? { code, status } : null,
    status,
  });

let signIn: jest.Mock;
let result: Promise<OverlayResult<'signed-in' | AuthSwitch>>;
let online = true;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro', email?: string) {
  signIn = jest.fn(async () => ({ landing: '/app/driver' }));
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { signIn } }],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    'signed-in' | AuthSwitch,
    { email?: string } | undefined
  >(SignIn, {
    data: email === undefined ? undefined : { email },
    shape: 'dialog',
    title: 'public.signIn.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

function field(label: string): HTMLInputElement {
  const found = [...panel().querySelectorAll('label')].find((l) =>
    l.textContent?.trim().startsWith(label),
  );
  const input =
    found?.querySelector('input') ??
    (found?.htmlFor ? document.getElementById(found.htmlFor) : null);
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
  ) as HTMLButtonElement;

const alertText = () =>
  panel().querySelector('[role="alert"]')?.textContent?.trim() ?? '';

const describedBy = (input: HTMLInputElement) =>
  (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => input.form?.querySelector(`#${id}`)?.textContent?.trim())
    .filter(Boolean)
    .join(' ');

async function submit(email: string, password: string) {
  type(field('E‑mail'), email);
  type(field('Parolă'), password);
  button('Intră în cont').click();
  await settle();
}

beforeEach(() => {
  online = true;
  jest.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
});

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.restoreAllMocks();
});

describe('the sign-in dialog', () => {
  it('shows the name, the two fields, "keep me signed in" ticked and the main button', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Autentificare',
    );
    expect(panel().textContent).toContain('MotorFix');
    const email = field('E‑mail');
    expect(email.type).toBe('email');
    expect(email.autocomplete).toBe('email');
    expect(email.placeholder).toBe('tu@exemplu.ro');
    const password = field('Parolă');
    expect(password.type).toBe('password');
    expect(password.autocomplete).toBe('current-password');
    expect(password.placeholder).toBe('Parola ta');
    expect(field('Ține‑mă autentificat').checked).toBe(true);
    expect(button('Intră în cont').type).toBe('submit');
  });

  it('shows no control of a flow that is not built yet', async () => {
    await open();

    const text = panel().textContent ?? '';
    for (const absent of [
      'Apple',
      'Google',
      'Ai uitat parola?',
      'Sunt șofer',
      'Am un service',
    ]) {
      expect(text).not.toContain(absent);
    }
  });

  it('offers to create an account under the main button', async () => {
    await open();

    expect(panel().textContent).toContain('Ești nou pe MotorFix?');
    const create = button('Creează un cont');
    expect(create.type).toBe('button');
    const buttons = [...panel().querySelectorAll('form button')];
    expect(buttons.indexOf(create)).toBeGreaterThan(
      buttons.indexOf(button('Intră în cont')),
    );
  });

  it('switches to sign-up with the e-mail typed so far, without sending', async () => {
    await open();
    type(field('E‑mail'), ' andrei@example.ro ');
    type(field('Parolă'), 'parola');

    button('Creează un cont').click();
    await settle();

    expect(signIn).not.toHaveBeenCalled();
    await expect(result).resolves.toEqual({
      email: 'andrei@example.ro',
      switchTo: 'sign-up',
    });
    expect(document.querySelector('mf-overlay-panel')).toBeNull();
  });

  it('starts with the e-mail typed in the sign-up dialog', async () => {
    await open('ro', 'andrei@example.ro');

    expect(field('E‑mail').value).toBe('andrei@example.ro');
    expect(field('Parolă').value).toBe('');
  });

  it('reads English', async () => {
    await open('en');

    expect(panel().textContent).toContain('New to MotorFix?');
    expect(button('Create an account')).toBeDefined();
    expect(panel().querySelector('h2')?.textContent?.trim()).toBe('Sign in');
    expect(field('E-mail').placeholder).toBe('you@example.com');
    expect(field('Password').placeholder).toBe('Your password');
    expect(field('Keep me signed in').checked).toBe(true);
    expect(button('Sign in')).toBeDefined();
  });
});

describe('checking the form before sending', () => {
  it('points out an empty e-mail and password, sends nothing, and focuses the e-mail', async () => {
    await open();

    button('Intră în cont').click();
    await settle();

    expect(signIn).not.toHaveBeenCalled();
    const email = field('E‑mail');
    const password = field('Parolă');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(email)).toContain('Câmpul este obligatoriu.');
    expect(describedBy(password)).toContain('Câmpul este obligatoriu.');
    expect(document.activeElement).toBe(email);
  });

  it.each([
    'andrei',
    'andrei@',
    'andrei@example',
    '@example.ro',
    'an drei@example.ro',
  ])('refuses "%s" as an e-mail address', async (email) => {
    await open();

    await submit(email, 'parola');

    expect(signIn).not.toHaveBeenCalled();
    expect(describedBy(field('E‑mail'))).toContain(
      'Adresa de e‑mail nu pare corectă.',
    );
    expect(document.activeElement).toBe(field('E‑mail'));
  });

  it('focuses the password when only the password is missing', async () => {
    await open();

    await submit('andrei@example.ro', '');

    expect(signIn).not.toHaveBeenCalled();
    expect(field('E‑mail').getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(field('Parolă'));
  });

  it('drops a field error once the field is fixed', async () => {
    await open();
    signIn.mockImplementation(() => new Promise(() => undefined));
    button('Intră în cont').click();
    await settle();

    await submit('andrei@example.ro', 'parola');

    expect(field('E‑mail').getAttribute('aria-invalid')).toBeNull();
    expect(describedBy(field('E‑mail'))).toBe('');
  });
});

describe('sending', () => {
  it('signs in with what was typed and closes with "signed-in"', async () => {
    await open();

    await submit(' andrei@example.ro ', 'parola');

    expect(signIn).toHaveBeenCalledWith('andrei@example.ro', 'parola', true);
    await expect(result).resolves.toBe('signed-in');
  });

  it('sends "keep me signed in" unticked when it was unticked', async () => {
    await open();
    field('Ține‑mă autentificat').click();

    await submit('andrei@example.ro', 'parola');

    expect(signIn).toHaveBeenCalledWith('andrei@example.ro', 'parola', false);
  });

  it('disables the button while it waits, and ignores a second tap', async () => {
    await open();
    let finish: () => void = () => undefined;
    signIn.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const main = button('Intră în cont');
    await submit('andrei@example.ro', 'parola');
    main.click();
    panel().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(main.getAttribute('aria-disabled')).toBe('true');
    expect(main.getAttribute('aria-busy')).toBe('true');
    finish();
    await settle();
  });
});

describe('answers that refuse', () => {
  it.each([
    [401, 'invalid_credentials', 'E‑mailul sau parola nu sunt corecte.'],
    [
      429,
      'too_many_attempts',
      'Prea multe încercări. Încearcă din nou în 15 minute.',
    ],
    [403, 'account_suspended', 'Contul tău este suspendat.'],
    [
      503,
      'maintenance',
      'MotorFix este în mentenanță. Încearcă din nou în câteva minute.',
    ],
  ])('shows the message for %s %s and keeps the e-mail', async (status, code, message) => {
    await open();
    signIn.mockRejectedValueOnce(problem(status, code));

    await submit('andrei@example.ro', 'parola');

    expect(alertText()).toBe(message);
    expect(field('E‑mail').value).toBe('andrei@example.ro');
    expect(button('Intră în cont').disabled).toBe(false);
  });

  it('clears the password after the e-mail or password did not match, and focuses it', async () => {
    await open();
    signIn.mockRejectedValueOnce(problem(401, 'invalid_credentials'));

    await submit('andrei@example.ro', 'parola');

    expect(field('Parolă').value).toBe('');
    expect(document.activeElement).toBe(field('Parolă'));
  });

  it('keeps everything typed when the device is offline', async () => {
    await open();
    online = false;
    signIn.mockRejectedValueOnce(problem(0));

    await submit('andrei@example.ro', 'parola');

    expect(alertText()).toBe(
      'Nu ești conectat. Încearcă din nou când revine conexiunea.',
    );
    expect(field('Parolă').value).toBe('parola');
  });

  it.each([
    [
      'a failed call while online',
      problem(0),
      'Nu am putut ajunge la MotorFix. Verifică conexiunea și încearcă din nou.',
    ],
    [
      'a server error',
      problem(500, 'internal_error'),
      'Ceva nu a mers la noi. Încearcă din nou.',
    ],
    [
      'an unknown code',
      problem(418, 'teapot'),
      'Ceva nu a mers. Încearcă din nou.',
    ],
    [
      'an error that is not an answer',
      new Error('boom'),
      'Ceva nu a mers. Încearcă din nou.',
    ],
  ])('shows the shared message for %s', async (_, error, message) => {
    await open();
    signIn.mockRejectedValueOnce(error);

    await submit('andrei@example.ro', 'parola');

    expect(alertText()).toBe(message);
  });

  it('shows the refusal in English', async () => {
    await open('en');
    signIn.mockRejectedValueOnce(problem(401, 'invalid_credentials'));

    type(field('E-mail'), 'andrei@example.ro');
    type(field('Password'), 'parola');
    button('Sign in').click();
    await settle();

    expect(alertText()).toBe('The e-mail or password is not correct.');
  });

  it('clears the message at the next try', async () => {
    await open();
    signIn
      .mockRejectedValueOnce(problem(401, 'invalid_credentials'))
      .mockImplementationOnce(() => new Promise(() => undefined));
    await submit('andrei@example.ro', 'parola');

    await submit('andrei@example.ro', 'parola-buna');

    expect(alertText()).toBe('');
  });
});
