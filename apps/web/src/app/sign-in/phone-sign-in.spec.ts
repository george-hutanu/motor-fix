import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { PhoneSignIn } from './phone-sign-in';
import type { AuthData, AuthSwitch } from './sign-in';
import { Session } from '../dashboard/session';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let phoneCode: jest.Mock;
let signInWithPhone: jest.Mock;
let result: Promise<OverlayResult<'signed-in' | AuthSwitch>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro', data?: AuthData) {
  phoneCode = jest.fn(async () => undefined);
  signInWithPhone = jest.fn(async () => ({ landing: '/app/garage' }));
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { phoneCode, signInWithPhone } }],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    'signed-in' | AuthSwitch,
    AuthData
  >(PhoneSignIn, {
    data: data ?? { email: '' },
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
  [...panel().querySelectorAll('button')].find((b) =>
    b.textContent?.trim().startsWith(name),
  ) as HTMLButtonElement;

const describedBy = (input: HTMLInputElement) =>
  (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => input.form?.querySelector(`#${id}`)?.textContent?.trim())
    .filter(Boolean)
    .join(' ');

async function sendCode(phone = '0722 123 456') {
  type(field('Număr de telefon'), phone);
  button('Trimite codul').click();
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.restoreAllMocks();
});

describe('the phone step', () => {
  it('asks for the number with +40 filled in, "keep me signed in" ticked and "Trimite codul"', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Autentificare',
    );
    const phone = field('Număr de telefon');
    expect(phone.value).toBe('+40');
    expect(phone.type).toBe('tel');
    expect(phone.autocomplete).toBe('tel');
    expect(phone.getAttribute('inputmode')).toBe('tel');
    expect(field('Ține‑mă autentificat').checked).toBe(true);
    expect(button('Trimite codul').type).toBe('submit');
    expect(button('Intră cu e‑mail și parolă').type).toBe('button');
  });

  it('reads English', async () => {
    await open('en');

    expect(field('Phone number').value).toBe('+40');
    expect(field('Keep me signed in').checked).toBe(true);
    expect(button('Send the code')).toBeDefined();
    expect(button('Sign in with e-mail and password')).toBeDefined();
  });

  it('sends the number as E.164 in the language of the screen', async () => {
    await open('en');
    type(field('Phone number'), '0722 123 456');

    button('Send the code').click();
    await settle();

    expect(phoneCode).toHaveBeenCalledWith('+40722123456', 'en');
  });

  it('shows a number that is not possible under the field, and sends nothing', async () => {
    await open();

    await sendCode('0722 1');

    expect(phoneCode).not.toHaveBeenCalled();
    const phone = field('Număr de telefon');
    expect(describedBy(phone)).toBe(
      'Scrie un număr de telefon valid, de exemplu 0722 123 456.',
    );
    expect(document.activeElement).toBe(phone);
  });

  it('goes back to e-mail and password with the e-mail and the number typed so far', async () => {
    await open('ro', { email: 'andrei@example.ro' });
    type(field('Număr de telefon'), ' 0722 123 456 ');

    button('Intră cu e‑mail și parolă').click();
    await settle();

    expect(phoneCode).not.toHaveBeenCalled();
    await expect(result).resolves.toEqual({
      email: 'andrei@example.ro',
      phone: '0722 123 456',
      switchTo: 'sign-in',
    });
  });

  it('starts with the number typed before a switch to e-mail', async () => {
    await open('ro', { email: '', phone: '0722 123 456' });

    expect(field('Număr de telefon').value).toBe('0722 123 456');
  });
});

describe('the code step', () => {
  it('names the number, asks for six digits and counts down from 5:00', async () => {
    await open();

    await sendCode();

    expect(panel().textContent).toContain(
      'Am trimis un cod pe WhatsApp la +40722123456',
    );
    const code = field('Cod');
    expect(code.getAttribute('inputmode')).toBe('numeric');
    expect(code.autocomplete).toBe('one-time-code');
    expect(code.maxLength).toBe(6);
    expect(panel().textContent).toContain('Codul expiră în 5:00');
    expect(button('Intră în cont').type).toBe('submit');
  });

  it('moves the focus to the code field', async () => {
    await open();

    await sendCode();

    expect(document.activeElement).toBe(field('Cod'));
  });

  it('keeps "Trimite din nou" disabled for the first minute', async () => {
    await open();

    await sendCode();

    const again = button('Trimite din nou');
    expect(again.type).toBe('button');
    expect(again.disabled).toBe(true);
  });

  it('does not send on the sixth digit by itself', async () => {
    await open();
    await sendCode();

    type(field('Cod'), '012345');
    await settle();

    expect(signInWithPhone).not.toHaveBeenCalled();
  });

  it('signs in with the number, the code and "keep me signed in", and closes with "signed-in"', async () => {
    await open();
    field('Ține‑mă autentificat').click();
    await sendCode();

    type(field('Cod'), '012345');
    button('Intră în cont').click();
    await settle();

    expect(signInWithPhone).toHaveBeenCalledWith(
      '+40722123456',
      '012345',
      false,
    );
    await expect(result).resolves.toBe('signed-in');
  });

  it('asks for six digits before sending', async () => {
    await open();
    await sendCode();

    type(field('Cod'), '0123');
    button('Intră în cont').click();
    await settle();

    expect(signInWithPhone).not.toHaveBeenCalled();
    expect(describedBy(field('Cod'))).toContain('Codul are 6 cifre.');
  });

  it('goes back to the number with "Schimbă numărul", keeping what was typed', async () => {
    await open();
    await sendCode('0722 123 456');

    button('Schimbă numărul').click();
    await settle();

    expect(field('Număr de telefon').value).toBe('0722 123 456');
    expect(document.activeElement).toBe(field('Număr de telefon'));
  });
});
