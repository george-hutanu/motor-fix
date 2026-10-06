import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { PhoneSignIn } from './phone-sign-in';
import { Providers } from './providers';
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
    providers: [
      { provide: Session, useValue: { phoneCode, signInWithPhone } },
      {
        provide: Providers,
        useValue: { load: async () => ({ apple: false, google: true }) },
      },
    ],
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

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: { status, ...body }, status });

async function toProfile() {
  signInWithPhone.mockResolvedValueOnce('profile');
  await sendCode();
  type(field('Cod'), '012345');
  button('Intră în cont').click();
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
      undefined,
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

describe('the profile step, for a number no account holds', () => {
  it('asks for the name and the consent, with "Creează contul", and moves the focus to the name', async () => {
    await open();

    await toProfile();

    const name = field('Nume');
    expect(name.autocomplete).toBe('name');
    expect(document.activeElement).toBe(name);
    const tick = panel().querySelector<HTMLInputElement>(
      'mf-consent input[type=checkbox]',
    );
    expect(tick?.checked).toBe(false);
    expect(button('Creează contul').type).toBe('submit');
    expect(panel().textContent).not.toContain('Intră în cont');
  });

  it('reads English', async () => {
    await open('en');
    signInWithPhone.mockResolvedValueOnce('profile');
    type(field('Phone number'), '0722 123 456');
    button('Send the code').click();
    await settle();
    type(field('Code'), '012345');
    button('Sign in').click();
    await settle();

    expect(field('Name')).toBeDefined();
    expect(button('Create the account')).toBeDefined();
  });

  it('creates the account with the same code, the trimmed name and the language, and closes with "signed-in"', async () => {
    await open();
    field('Ține‑mă autentificat').click();
    await toProfile();

    type(field('Nume'), '  Ion Popescu  ');
    panel().querySelector<HTMLInputElement>('mf-consent input')?.click();
    button('Creează contul').click();
    await settle();

    expect(signInWithPhone).toHaveBeenLastCalledWith(
      '+40722123456',
      '012345',
      false,
      { language: 'ro', name: 'Ion Popescu' },
    );
    await expect(result).resolves.toBe('signed-in');
  });

  it.each([
    ['no name', '', 'Câmpul este obligatoriu.'],
    ['a name of one letter', 'I', 'Scrie cel puțin 2 caractere.'],
    [
      'a name over 80 characters',
      'I'.repeat(81),
      'Scrie cel mult 80 caractere.',
    ],
  ])('shows %s under the field and sends nothing', async (_, name, shown) => {
    await open();
    await toProfile();

    type(field('Nume'), name);
    panel().querySelector<HTMLInputElement>('mf-consent input')?.click();
    button('Creează contul').click();
    await settle();

    expect(signInWithPhone).toHaveBeenCalledTimes(1);
    expect(describedBy(field('Nume'))).toContain(shown);
  });

  it('asks for the tick before sending', async () => {
    await open();
    await toProfile();

    type(field('Nume'), 'Ion Popescu');
    button('Creează contul').click();
    await settle();

    expect(signInWithPhone).toHaveBeenCalledTimes(1);
    expect(panel().querySelector('mf-consent')?.textContent).toContain(
      'Bifează pentru a continua.',
    );
  });

  it('goes back to the code step with "Trimite din nou" when the code expired meanwhile', async () => {
    await open();
    await toProfile();
    signInWithPhone.mockRejectedValueOnce(
      refusal(410, { code: 'code_expired' }),
    );

    type(field('Nume'), 'Ion Popescu');
    panel().querySelector<HTMLInputElement>('mf-consent input')?.click();
    button('Creează contul').click();
    await settle();

    expect(panel().textContent).toContain('Codul a expirat. Cere un cod nou.');
    expect(button('Trimite din nou').disabled).toBe(false);
    expect(panel().textContent).not.toContain('Creează contul');
  });

  it('shows a typed name as text, never as markup', async () => {
    await open();
    await toProfile();
    signInWithPhone.mockRejectedValueOnce(
      refusal(409, { code: 'phone_taken' }),
    );

    type(field('Nume'), '<img src=x onerror=alert(1)>');
    panel().querySelector<HTMLInputElement>('mf-consent input')?.click();
    button('Creează contul').click();
    await settle();

    expect(field('Nume').value).toBe('<img src=x onerror=alert(1)>');
    expect(panel().querySelector('img')).toBeNull();
  });
});

async function enterCode(code = '012345') {
  type(field('Cod'), code);
  button('Intră în cont').click();
  await settle();
}

describe('what the dialog says to each answer', () => {
  // @traces 393-FR-014
  it('says the code is not correct with the attempts left, and clears the code field', async () => {
    await open();
    await sendCode();
    signInWithPhone.mockRejectedValueOnce(
      refusal(401, { attemptsLeft: 4, code: 'code_invalid' }),
    );

    await enterCode();

    const alert = panel().querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert).toContain('Codul nu este corect.');
    expect(alert).toContain('Mai ai 4 încercări.');
    expect(field('Cod').value).toBe('');
  });

  // @traces 393-FR-014
  it('says "1 încercare" for the last one, and "attempts left" in English', async () => {
    await open();
    await sendCode();
    signInWithPhone.mockRejectedValueOnce(
      refusal(401, { attemptsLeft: 1, code: 'code_invalid' }),
    );
    await enterCode();
    expect(panel().textContent).toContain('Mai ai o încercare.');
  });

  it('reads the attempts left in English', async () => {
    await open('en');
    type(field('Phone number'), '0722 123 456');
    button('Send the code').click();
    await settle();
    signInWithPhone.mockRejectedValueOnce(
      refusal(401, { attemptsLeft: 3, code: 'code_invalid' }),
    );
    type(field('Code'), '012345');
    button('Sign in').click();
    await settle();

    expect(panel().textContent).toContain('3 attempts left.');
  });

  // @traces 393-FR-014
  it('says the code expired, keeping the number', async () => {
    await open();
    await sendCode();
    signInWithPhone.mockRejectedValueOnce(
      refusal(410, { code: 'code_expired' }),
    );

    await enterCode();

    expect(panel().textContent).toContain('Codul a expirat. Cere un cod nou.');
    expect(panel().textContent).toContain('+40722123456');
  });

  // @traces 393-FR-014
  it('gives one text for too many codes and for too many wrong codes', async () => {
    await open();
    phoneCode.mockRejectedValueOnce(
      refusal(429, { code: 'too_many_attempts' }),
    );
    await sendCode();
    const asked =
      panel().querySelector('[role="alert"]')?.textContent?.trim() ?? '';
    await sendCode();
    signInWithPhone.mockRejectedValueOnce(
      refusal(429, { code: 'too_many_attempts' }),
    );
    await enterCode();
    const tried =
      panel().querySelector('[role="alert"]')?.textContent?.trim() ?? '';

    expect(asked).toBe(
      'Prea multe încercări. Așteaptă puțin sau cere un cod nou.',
    );
    expect(tried).toBe(asked);
  });

  // @traces 393-FR-013
  it('at 0:00 disables the code field and offers only "Trimite din nou"', async () => {
    const start = Date.now();
    await open();
    await sendCode();
    jest.spyOn(Date, 'now').mockReturnValue(start + 301_000);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await settle();

    expect(panel().textContent).toContain('Codul expiră în 0:00');
    expect(field('Cod').disabled).toBe(true);
    expect(button('Intră în cont').disabled).toBe(true);
    expect(button('Trimite din nou').disabled).toBe(false);
  });

  // @traces 393-FR-013
  it('holds the main button while the code is on its way, and a second tap sends nothing', async () => {
    await open();
    await sendCode();
    signInWithPhone.mockReturnValueOnce(new Promise(() => undefined));

    await enterCode();
    const submit = panel().querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    submit?.click();
    await settle();

    expect(signInWithPhone).toHaveBeenCalledTimes(1);
    expect(submit?.getAttribute('aria-disabled')).toBe('true');
  });

  // @traces 393-FR-014
  it('says WhatsApp did not take the code, with a way back to e-mail and password and to the providers', async () => {
    await open();
    phoneCode.mockRejectedValueOnce(refusal(502, { code: 'whatsapp_failed' }));

    await sendCode();

    const fallback = panel().querySelector('.fallback');
    expect(fallback?.getAttribute('role')).toBe('alert');
    expect(fallback?.textContent).toContain(
      'Nu am putut trimite codul pe WhatsApp.',
    );
    expect(fallback?.textContent).toContain('Intră cu e‑mail și parolă');
    expect(fallback?.querySelector('mf-provider-buttons')).not.toBeNull();
    expect(field('Număr de telefon').value).toBe('0722 123 456');
  });

  // @traces 393-FR-014
  it('offers the same way back when sending the code again fails', async () => {
    const start = Date.now();
    await open();
    await sendCode();
    jest.spyOn(Date, 'now').mockReturnValue(start + 61_000);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await settle();
    phoneCode.mockRejectedValueOnce(refusal(502, { code: 'whatsapp_failed' }));

    button('Trimite din nou').click();
    await settle();

    const fallback = panel().querySelector('.fallback');
    expect(fallback?.textContent).toContain(
      'Nu am putut trimite codul pe WhatsApp.',
    );
    [...(fallback?.querySelectorAll('button') ?? [])]
      .find((b) => b.textContent?.includes('Intră cu e‑mail și parolă'))
      ?.click();
    await expect(result).resolves.toMatchObject({
      phone: '0722 123 456',
      switchTo: 'sign-in',
    });
  });

  // @traces 393-FR-014
  it('shows the shared offline message when the code is asked for and when it is entered', async () => {
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const offline = new HttpErrorResponse({ status: 0 });
    await open();
    phoneCode.mockRejectedValueOnce(offline);
    await sendCode();
    const asked = panel().textContent ?? '';
    await sendCode();
    signInWithPhone.mockRejectedValueOnce(offline);
    await enterCode();

    expect(asked).toContain('Nu ești conectat.');
    expect(panel().textContent).toContain('Nu ești conectat.');
  });

  // @traces 393-FR-014
  it.each([
    [503, 'maintenance', 'MotorFix este în mentenanță.'],
    [403, 'account_suspended', 'Contul tău este suspendat.'],
    [409, 'phone_taken', 'Intră cu e‑mail și parolă'],
  ])('shows the message for %s %s', async (status, code, text) => {
    await open();
    await sendCode();
    signInWithPhone.mockRejectedValueOnce(refusal(status, { code }));

    await enterCode();

    expect(panel().querySelector('mf-task-error')?.textContent ?? '').toContain(
      text,
    );
  });
});
