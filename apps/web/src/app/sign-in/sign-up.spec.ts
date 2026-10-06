import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import type { AuthSwitch } from './sign-in';
import { SignUp } from './sign-up';
import { Session } from '../dashboard/session';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const problem = (
  status: number,
  code?: string,
  errors?: { code: string; field: string }[],
) =>
  new HttpErrorResponse({
    error: code ? { code, status, ...(errors && { errors }) } : null,
    status,
  });

let signUp: jest.Mock;
let result: Promise<OverlayResult<'signed-in' | AuthSwitch>>;
let online = true;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  language: 'ro' | 'en' = 'ro',
  email?: string,
  name?: string,
) {
  signUp = jest.fn(async () => ({ landing: '/app/driver' }));
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { signUp } }],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    'signed-in' | AuthSwitch,
    { email?: string; name?: string }
  >(SignUp, {
    data: { email, name },
    shape: 'dialog',
    title: 'public.signUp.title',
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
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name,
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

const consentBox = () =>
  panel().querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  ) as HTMLInputElement;

function tick() {
  consentBox().click();
}

async function submit(
  name: string,
  email: string,
  password: string,
  consent = true,
) {
  type(field('Nume'), name);
  type(field('E‑mail'), email);
  type(field('Parolă'), password);
  if (consent) tick();
  button('Creează contul').click();
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

describe('the sign-up dialog', () => {
  it('shows the name, the driver blurb, the three fields and the main button', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe('Cont nou');
    expect(panel().textContent).toContain('MotorFix');
    expect(panel().textContent).toContain(
      'Cererile tale de ofertă, mașinile și recenziile scrise.',
    );
    const name = field('Nume');
    expect(name.autocomplete).toBe('name');
    const email = field('E‑mail');
    expect(email.type).toBe('email');
    expect(email.autocomplete).toBe('email');
    expect(email.placeholder).toBe('tu@exemplu.ro');
    const password = field('Parolă');
    expect(password.type).toBe('password');
    expect(password.autocomplete).toBe('new-password');
    expect(button('Creează contul').type).toBe('submit');
    expect(panel().textContent).toContain('Ai deja cont?');
  });

  it('has no "keep me signed in", no role switch and no other way in', async () => {
    await open();

    const text = panel().textContent ?? '';
    for (const absent of [
      'Ține‑mă autentificat',
      'Sunt șofer',
      'Am un service',
      'Apple',
      'Google',
      'Ai uitat parola?',
    ]) {
      expect(text).not.toContain(absent);
    }
  });

  it('starts with the e-mail typed in the sign-in dialog', async () => {
    await open('ro', 'andrei@example.ro');

    expect(field('E‑mail').value).toBe('andrei@example.ro');
  });

  it('starts with the invited name when it comes from an invite link', async () => {
    await open('ro', 'elena@example.ro', 'Elena Stan');

    expect(field('Nume').value).toBe('Elena Stan');
    expect(field('E‑mail').value).toBe('elena@example.ro');
  });

  it('shows and hides the password', async () => {
    await open();
    const toggle = button('Arată parola');

    toggle.click();
    await settle();
    expect(field('Parolă').type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    await settle();
    expect(field('Parolă').type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('reads English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'New account',
    );
    expect(field('Name')).toBeDefined();
    expect(field('Password').placeholder).toBe('At least 8 characters');
    expect(button('Create account')).toBeDefined();
    expect(button('Show password')).toBeDefined();
    expect(panel().textContent).toContain(
      'Your quote requests, your cars and the reviews you wrote.',
    );
    expect(panel().textContent).toContain('Already have an account?');
  });
});

describe('switching back to sign-in', () => {
  it('closes with the switch and the e-mail typed so far', async () => {
    await open();
    type(field('E‑mail'), ' andrei@example.ro ');
    type(field('Nume'), 'Andrei');

    button('Intră în cont').click();
    await settle();

    await expect(result).resolves.toEqual({
      email: 'andrei@example.ro',
      switchTo: 'sign-in',
    });
    expect(document.querySelector('mf-overlay-panel')).toBeNull();
  });
});

describe('checking the form before sending', () => {
  it('points out every empty field, sends nothing, and focuses the name', async () => {
    await open();

    button('Creează contul').click();
    await settle();

    expect(signUp).not.toHaveBeenCalled();
    for (const label of ['Nume', 'E‑mail', 'Parolă']) {
      expect(field(label).getAttribute('aria-invalid')).toBe('true');
      expect(describedBy(field(label))).toContain('Câmpul este obligatoriu.');
    }
    expect(document.activeElement).toBe(field('Nume'));
  });

  it('refuses a password shorter than 8 characters before sending', async () => {
    await open();

    await submit('Andrei Marin', 'andrei@example.ro', 'scurta1');

    expect(signUp).not.toHaveBeenCalled();
    expect(describedBy(field('Parolă'))).toContain(
      'Scrie cel puțin 8 caractere.',
    );
    expect(document.activeElement).toBe(field('Parolă'));
  });

  it('refuses a password longer than 128 characters before sending', async () => {
    await open();

    await submit('Andrei Marin', 'andrei@example.ro', 'a'.repeat(129));

    expect(signUp).not.toHaveBeenCalled();
    expect(describedBy(field('Parolă'))).toContain(
      'Scrie cel mult 128 caractere.',
    );
  });

  it.each([
    ['a', 'Scrie cel puțin 2 caractere.'],
    ['   ', 'Câmpul este obligatoriu.'],
    [' a ', 'Scrie cel puțin 2 caractere.'],
    ['a'.repeat(81), 'Scrie cel mult 80 caractere.'],
  ])('refuses the name "%s"', async (name, message) => {
    await open();

    await submit(name, 'andrei@example.ro', 'o-parola-lunga');

    expect(signUp).not.toHaveBeenCalled();
    expect(describedBy(field('Nume'))).toContain(message);
  });

  it.each(['andrei', 'andrei@example', 'an drei@example.ro'])(
    'refuses "%s" as an e-mail address',
    async (email) => {
      await open();

      await submit('Andrei Marin', email, 'o-parola-lunga');

      expect(signUp).not.toHaveBeenCalled();
      expect(describedBy(field('E‑mail'))).toContain(
        'Adresa de e‑mail nu pare corectă.',
      );
    },
  );
});

describe('sending', () => {
  it('creates the account with what was typed, in the interface language, and closes with "signed-in"', async () => {
    await open();

    await submit(' Andrei Marin ', ' Andrei@Example.ro ', 'o-parola-lunga');

    expect(signUp).toHaveBeenCalledWith(
      'Andrei Marin',
      'Andrei@Example.ro',
      'o-parola-lunga',
      'ro',
    );
    await expect(result).resolves.toBe('signed-in');
  });

  it('sends the English interface language', async () => {
    await open('en');

    type(field('Name'), 'Andrei Marin');
    type(field('E-mail'), 'andrei@example.ro');
    type(field('Password'), 'o-parola-lunga');
    tick();
    button('Create account').click();
    await settle();

    expect(signUp).toHaveBeenCalledWith(
      'Andrei Marin',
      'andrei@example.ro',
      'o-parola-lunga',
      'en',
    );
  });

  it('disables the button while it waits, and ignores a second tap', async () => {
    await open();
    let finish: () => void = () => undefined;
    signUp.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const main = button('Creează contul');
    await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga');
    main.click();
    panel().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();

    expect(signUp).toHaveBeenCalledTimes(1);
    expect(main.getAttribute('aria-disabled')).toBe('true');
    expect(main.getAttribute('aria-busy')).toBe('true');
    finish();
    await settle();
  });
});

describe('answers that refuse', () => {
  it('says the e-mail is taken next to the button and keeps everything typed', async () => {
    await open();
    signUp.mockRejectedValueOnce(problem(409, 'email_taken'));

    await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga');

    expect(alertText()).toBe('Există deja un cont cu acest e‑mail.');
    expect(field('Nume').value).toBe('Andrei Marin');
    expect(field('E‑mail').value).toBe('andrei@example.ro');
    expect(field('Parolă').value).toBe('o-parola-lunga');
    expect(button('Creează contul').disabled).toBe(false);
  });

  it('shows a weak password under the password field', async () => {
    await open();
    signUp.mockRejectedValueOnce(
      problem(400, 'weak_password', [
        { code: 'weak_password', field: 'password' },
      ]),
    );

    await submit('Andrei Marin', 'andrei@example.ro', 'parola123');

    expect(describedBy(field('Parolă'))).toContain(
      'Alege o parolă mai greu de ghicit: este printre cele mai folosite.',
    );
    expect(document.activeElement).toBe(field('Parolă'));
    expect(alertText()).toBe('Verifică câmpurile marcate.');
  });

  it.each([
    [
      429,
      'too_many_attempts',
      'Prea multe încercări. Încearcă din nou peste o oră.',
    ],
    [
      503,
      'maintenance',
      'MotorFix este în mentenanță. Încearcă din nou în câteva minute.',
    ],
    [500, 'internal_error', 'Ceva nu a mers la noi. Încearcă din nou.'],
  ])('shows the message for %s %s', async (status, code, message) => {
    await open();
    signUp.mockRejectedValueOnce(problem(status, code));

    await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga');

    expect(alertText()).toBe(message);
  });

  it('keeps everything typed when the device is offline', async () => {
    await open();
    online = false;
    signUp.mockRejectedValueOnce(problem(0));

    await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga');

    expect(alertText()).toBe(
      'Nu ești conectat. Încearcă din nou când revine conexiunea.',
    );
    expect(field('Nume').value).toBe('Andrei Marin');
    expect(field('Parolă').value).toBe('o-parola-lunga');
  });

  it('says the e-mail is taken in English', async () => {
    await open('en');
    signUp.mockRejectedValueOnce(problem(409, 'email_taken'));

    type(field('Name'), 'Andrei Marin');
    type(field('E-mail'), 'andrei@example.ro');
    type(field('Password'), 'o-parola-lunga');
    tick();
    button('Create account').click();
    await settle();

    expect(alertText()).toBe('An account with this e-mail already exists.');
  });
});

describe('the consent to the terms and the privacy notice', () => {
  const links = () =>
    [...panel().querySelectorAll<HTMLAnchorElement>('label a')].map((a) => ({
      href: a.getAttribute('href'),
      rel: a.rel,
      target: a.target,
      text: a.textContent?.trim(),
    }));

  it('asks for the tick, unticked, above the main button, with both texts linked in a new tab', async () => {
    await open();

    const box = consentBox();
    expect(box.checked).toBe(false);
    expect(box.closest('label')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Accept Termenii de utilizare și am citit Nota de informare privind datele personale.',
    );
    expect(links()).toEqual([
      {
        href: '/ro/terms',
        rel: 'noopener',
        target: '_blank',
        text: 'Termenii de utilizare',
      },
      {
        href: '/ro/privacy',
        rel: 'noopener',
        target: '_blank',
        text: 'Nota de informare privind datele personale',
      },
    ]);
    expect(
      box.compareDocumentPosition(button('Creează contul')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('sends nothing with the tick empty, says to tick it and focuses it', async () => {
    await open();

    await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga', false);

    expect(signUp).not.toHaveBeenCalled();
    const box = consentBox();
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(box)).toBe('Bifează pentru a continua.');
    expect(document.activeElement).toBe(box);
  });

  it('sends once the tick is set after the message', async () => {
    await open();
    await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga', false);

    tick();
    await settle();
    expect(describedBy(consentBox())).toBe('');
    button('Creează contul').click();
    await settle();

    expect(signUp).toHaveBeenCalledTimes(1);
  });

  it('says to tick it again when it is cleared before sending', async () => {
    await open();
    tick();
    tick();

    await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga', false);

    expect(signUp).not.toHaveBeenCalled();
    expect(describedBy(consentBox())).toBe('Bifează pentru a continua.');
  });

  it('reads English, with the English texts linked', async () => {
    await open('en');

    expect(
      consentBox().closest('label')?.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe('I accept the Terms of use and have read the Privacy notice.');
    expect(links().map(({ href, text }) => ({ href, text }))).toEqual([
      { href: '/en/terms', text: 'Terms of use' },
      { href: '/en/privacy', text: 'Privacy notice' },
    ]);

    type(field('Name'), 'Andrei Marin');
    type(field('E-mail'), 'andrei@example.ro');
    type(field('Password'), 'o-parola-lunga');
    button('Create account').click();
    await settle();

    expect(signUp).not.toHaveBeenCalled();
    expect(describedBy(consentBox())).toBe('Tick to continue.');
  });

  it('shows a refusal for the consent under the tick', async () => {
    await open();
    signUp.mockRejectedValueOnce(
      problem(400, 'consent_required', [
        { code: 'consent_required', field: 'consent' },
      ]),
    );

    await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga');

    expect(describedBy(consentBox())).toBe('Bifează pentru a continua.');
    expect(document.activeElement).toBe(consentBox());
  });
});
