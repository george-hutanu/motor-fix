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

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro', email?: string) {
  signUp = jest.fn(async () => ({ landing: '/app/driver' }));
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { signUp } }],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    'signed-in' | AuthSwitch,
    { email?: string }
  >(SignUp, {
    data: { email },
    shape: 'dialog',
    title: 'public.signUp.title',
  });
  await settle();
  // These cases are about the other fields: the terms are accepted up front.
  panel().querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
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

async function submit(name: string, email: string, password: string) {
  type(field('Nume'), name);
  type(field('E‑mail'), email);
  type(field('Parolă'), password);
  button('Creează contul').click();
  await settle();
}

beforeEach(() => {
  jest.spyOn(navigator, 'onLine', 'get').mockImplementation(() => true);
});

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.restoreAllMocks();
});

describe('what the person typed is never markup', () => {
  const markup = '<img src=x onerror=alert(1)><b>Andrei</b>';

  it('keeps a markup name as text in the field after the e-mail is refused as taken', async () => {
    await open();
    signUp.mockRejectedValueOnce(problem(409, 'email_taken'));

    await submit(markup, 'andrei@example.ro', 'o-parola-lunga');

    expect(field('Nume').value).toBe(markup);
    expect(panel().querySelector('img')).toBeNull();
    expect(panel().querySelector('b')).toBeNull();
    expect(alertText()).toBe('Există deja un cont cu acest e‑mail.');
  });

  it('sends a markup name unchanged, as text', async () => {
    await open();

    await submit(markup, 'andrei@example.ro', 'o-parola-lunga');

    expect(signUp).toHaveBeenCalledWith(
      markup,
      'andrei@example.ro',
      'o-parola-lunga',
      'ro',
    );
  });

  it('shows an e-mail from the sign-in dialog that holds markup as text only', async () => {
    await open('ro', '"><img src=x onerror=alert(1)>@example.ro');

    expect(panel().querySelector('img')).toBeNull();
    expect(panel().querySelector('[onerror]')).toBeNull();
    expect(field('E‑mail').value).toContain('<img');
  });

  it('never prints the typed password in the panel after a refusal', async () => {
    await open();
    signUp.mockRejectedValueOnce(problem(409, 'email_taken'));

    await submit('Andrei Marin', 'andrei@example.ro', 'zq-secret-77');

    expect(panel().textContent).not.toContain('zq-secret-77');
    expect(panel().innerHTML).not.toContain('zq-secret-77');
    expect(field('Parolă').type).toBe('password');
  });

  it('never prints the typed name or e-mail into the error region', async () => {
    await open();
    signUp.mockRejectedValueOnce(problem(429, 'too_many_attempts'));

    await submit('Zorro <i>Quux</i>', 'zorro@example.ro', 'o-parola-lunga');

    expect(alertText()).not.toMatch(/zorro|quux/i);
    expect(panel().querySelector('i')).toBeNull();
  });
});

describe('switching to sign-in with odd e-mails', () => {
  it.each([
    ['capitals and accents', 'ÉMILE@Example.RO', 'ÉMILE@Example.RO'],
    ['padding of tabs and spaces', ' \t a@b.ro \t ', 'a@b.ro'],
    ['an unfinished address', 'andrei@', 'andrei@'],
    ['markup', '<b>a</b>@b.ro', '<b>a</b>@b.ro'],
    ['a right-to-left mark', 'a‏@b.ro', 'a‏@b.ro'],
  ])('carries %s without asking', async (_, typed, carried) => {
    await open();
    type(field('E‑mail'), typed);

    button('Intră în cont').click();
    await settle();

    const answer = await result;
    expect(answer).toMatchObject({ switchTo: 'sign-in' });
    expect((answer as { email?: string }).email).toBe(carried);
    expect(document.querySelector('mf-overlay-panel')).toBeNull();
  });

  it('carries no e-mail when none was typed, and never the name or the password', async () => {
    await open();
    type(field('Nume'), 'Andrei Marin');
    type(field('Parolă'), 'zq-secret-77');

    button('Intră în cont').click();
    await settle();

    const answer = (await result) as { email?: string; switchTo: string };
    expect(answer.switchTo).toBe('sign-in');
    expect(answer.email ?? '').toBe('');
    expect(JSON.stringify(answer)).not.toMatch(/Andrei|zq-secret-77/);
  });

  it('resolves once and sends nothing when the switch is tapped five times at once', async () => {
    await open('ro', 'andrei@example.ro');
    const back = button('Intră în cont');

    for (let i = 0; i < 5; i++) back.click();
    await settle();

    await expect(result).resolves.toEqual({
      email: 'andrei@example.ro',
      switchTo: 'sign-in',
    });
    expect(signUp).not.toHaveBeenCalled();
  });

  it('does not switch while a sign-up is on its way and sends nothing more', async () => {
    await open();
    let finish: () => void = () => undefined;
    signUp.mockImplementation(
      () =>
        new Promise<{ landing: string }>((resolve) => {
          finish = () => resolve({ landing: '/app/driver' });
        }),
    );
    await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga');

    button('Intră în cont')?.click();
    await settle();
    finish();
    await settle();

    expect(signUp).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toBe('signed-in');
  });
});

describe('sending more than once', () => {
  it('lets the person fix the password after a weak one and then signs up', async () => {
    await open();
    signUp.mockRejectedValueOnce(
      problem(400, 'weak_password', [
        { code: 'weak_password', field: 'password' },
      ]),
    );
    await submit('Andrei Marin', 'andrei@example.ro', 'parola123');
    expect(document.activeElement).toBe(field('Parolă'));

    type(field('Parolă'), 'o-parola-mai-buna');
    button('Creează contul').click();
    await settle();

    expect(signUp).toHaveBeenCalledTimes(2);
    expect(signUp).toHaveBeenLastCalledWith(
      'Andrei Marin',
      'andrei@example.ro',
      'o-parola-mai-buna',
      'ro',
    );
    await expect(result).resolves.toBe('signed-in');
  });

  it('clears the weak-password message once the password is sent again', async () => {
    await open();
    signUp.mockRejectedValueOnce(
      problem(400, 'weak_password', [
        { code: 'weak_password', field: 'password' },
      ]),
    );
    await submit('Andrei Marin', 'andrei@example.ro', 'parola123');
    signUp.mockRejectedValueOnce(problem(409, 'email_taken'));

    type(field('Parolă'), 'o-parola-mai-buna');
    button('Creează contul').click();
    await settle();

    expect(describedBy(field('Parolă'))).not.toContain('greu de ghicit');
    expect(alertText()).toBe('Există deja un cont cu acest e‑mail.');
  });

  it('enables the button after a refusal and sends again on the next tap', async () => {
    await open();
    signUp.mockRejectedValueOnce(problem(409, 'email_taken'));
    await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga');
    const main = button('Creează contul');
    expect(main.getAttribute('aria-busy')).not.toBe('true');

    main.click();
    await settle();

    expect(signUp).toHaveBeenCalledTimes(2);
  });

  it('sends once for a submit event fired twice in a row while waiting', async () => {
    await open();
    let finish: () => void = () => undefined;
    signUp.mockImplementation(
      () =>
        new Promise<{ landing: string }>((resolve) => {
          finish = () => resolve({ landing: '/app/driver' });
        }),
    );
    type(field('Nume'), 'Andrei Marin');
    type(field('E‑mail'), 'andrei@example.ro');
    type(field('Parolă'), 'o-parola-lunga');

    const form = panel().querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(signUp).toHaveBeenCalledTimes(1);
    finish();
    await settle();
  });
});

describe('answers the dialog does not expect', () => {
  it.each([
    ['a 400 with no code', problem(400)],
    ['a 502 with no body', problem(502)],
    ['an unknown code', problem(418, 'teapot')],
    [
      'a field error for a field it does not have',
      problem(400, 'weak_password', [{ code: 'weak_password', field: 'zip' }]),
    ],
    ['an error with an empty list of field errors', problem(400, 'x', [])],
  ])(
    'shows a message and keeps what was typed after %s',
    async (_, failure) => {
      await open();
      signUp.mockRejectedValueOnce(failure);

      await submit('Andrei Marin', 'andrei@example.ro', 'o-parola-lunga');

      expect(field('Nume').value).toBe('Andrei Marin');
      expect(field('E‑mail').value).toBe('andrei@example.ro');
      expect(field('Parolă').value).toBe('o-parola-lunga');
      expect(
        alertText() +
          describedBy(field('Parolă')) +
          describedBy(field('Nume')) +
          describedBy(field('E‑mail')),
      ).not.toBe('');
    },
  );

  it('shows the weak-password text in English under the password', async () => {
    await open('en');
    signUp.mockRejectedValueOnce(
      problem(400, 'weak_password', [
        { code: 'weak_password', field: 'password' },
      ]),
    );

    type(field('Name'), 'Andrei Marin');
    type(field('E-mail'), 'andrei@example.ro');
    type(field('Password'), 'password1');
    button('Create account').click();
    await settle();

    expect(describedBy(field('Password'))).toMatch(/harder to guess/i);
    expect(document.activeElement).toBe(field('Password'));
  });

  it('shows the too-many-attempts text in English', async () => {
    await open('en');
    signUp.mockRejectedValueOnce(problem(429, 'too_many_attempts'));

    type(field('Name'), 'Andrei Marin');
    type(field('E-mail'), 'andrei@example.ro');
    type(field('Password'), 'o-parola-lunga');
    button('Create account').click();
    await settle();

    expect(alertText()).toBe('Too many attempts. Try again in an hour.');
  });
});

describe('lengths counted the way the server counts them', () => {
  it.each([
    ['a password of 8 emoji', 'Andrei Marin', '😀'.repeat(8)],
    [
      'a password of 100 emoji, 200 UTF-16 units',
      'Andrei Marin',
      '😀'.repeat(100),
    ],
    ['a name of 80 emoji, 160 UTF-16 units', '😀'.repeat(80), 'o-parola-lunga'],
  ])('sends %s', async (_, name, password) => {
    await open();

    await submit(name, 'andrei@example.ro', password);

    expect(signUp).toHaveBeenCalledTimes(1);
  });

  it('does not take a password of 5 emoji for 8 characters it does not have', async () => {
    await open();

    await submit('Andrei Marin', 'andrei@example.ro', '😀'.repeat(5));

    expect(signUp).not.toHaveBeenCalled();
    expect(describedBy(field('Parolă'))).toContain(
      'Scrie cel puțin 8 caractere.',
    );
  });

  it('refuses a name of one emoji, which is one character', async () => {
    await open();

    await submit('😀', 'andrei@example.ro', 'o-parola-lunga');

    expect(signUp).not.toHaveBeenCalled();
    expect(describedBy(field('Nume'))).toContain(
      'Scrie cel puțin 2 caractere.',
    );
  });

  it('sends a password of 128 characters and refuses 129, at the edge', async () => {
    await open();
    await submit('Andrei Marin', 'andrei@example.ro', 'a'.repeat(128));
    expect(signUp).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
      n.innerHTML = '';
    });
    await open();
    await submit('Andrei Marin', 'andrei@example.ro', 'a'.repeat(129));
    expect(signUp).not.toHaveBeenCalled();
  });

  it.each([
    ['an e-mail with two at signs', 'a@b@c.ro'],
    ['an e-mail with a tab inside', 'a\tb@c.ro'],
    ['an e-mail with nothing before the at sign', '@c.ro'],
    ['an e-mail with nothing after the last dot', 'a@c.'],
  ])('refuses %s before sending', async (_, email) => {
    await open();

    await submit('Andrei Marin', email, 'o-parola-lunga');

    expect(signUp).not.toHaveBeenCalled();
    expect(describedBy(field('E‑mail'))).toContain(
      'Adresa de e‑mail nu pare corectă.',
    );
  });
});
