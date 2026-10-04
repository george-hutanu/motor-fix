import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { SignIn } from './sign-in';
import { Session } from '../dashboard/session';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const problem = (status: number, body: unknown) =>
  new HttpErrorResponse({ error: body, status });

let signIn: jest.Mock;
let result: Promise<OverlayResult<'signed-in'>>;
let online = true;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open() {
  signIn = jest.fn(async () => ({ landing: '/app/driver' }));
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { signIn } }],
  });
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<'signed-in'>(SignIn, {
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

const button = () =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Intră în cont',
  ) as HTMLButtonElement;

const alertText = () =>
  panel().querySelector('[role="alert"]')?.textContent?.trim() ?? '';

async function submit(email: string, password: string) {
  type(field('E‑mail'), email);
  type(field('Parolă'), password);
  button().click();
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

describe('the sign-in dialog under hostile input', () => {
  it.each([
    'andrei@.ro',
    'a@@b.ro',
    'andrei@exa mple.ro',
    'andrei@example.ro\nbcc@x.ro',
    '   ',
  ])('sends nothing for the e-mail %j', async (email) => {
    await open();

    await submit(email, 'parola');

    expect(signIn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field('E‑mail'));
  });

  it('accepts the shortest address that has text, an at sign and a dotted domain', async () => {
    await open();

    await submit('a@b.c', 'p');

    expect(signIn).toHaveBeenCalledWith('a@b.c', 'p', true);
  });

  it('accepts a password of only spaces as filled in, and sends it as typed', async () => {
    await open();

    await submit('andrei@example.ro', '   ');

    expect(signIn).toHaveBeenCalledWith('andrei@example.ro', '   ', true);
  });

  it('sends a unicode e-mail and a very long password without cutting them', async () => {
    await open();
    const long = 'p'.repeat(5000);

    await submit('ionuț@exemplu.ro', long);

    expect(signIn).toHaveBeenCalledWith('ionuț@exemplu.ro', long, true);
  });

  it('sends one request when the form is submitted several times in the same moment', async () => {
    await open();
    signIn.mockImplementation(() => new Promise(() => undefined));
    type(field('E‑mail'), 'andrei@example.ro');
    type(field('Parolă'), 'parola');

    const form = panel().querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    button().click();
    await settle();

    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('lets a second try go out once the first one has been refused', async () => {
    await open();
    signIn.mockRejectedValueOnce(problem(401, { code: 'invalid_credentials' }));
    await submit('andrei@example.ro', 'wrong');

    await submit('andrei@example.ro', 'right');

    expect(signIn).toHaveBeenCalledTimes(2);
    expect(signIn).toHaveBeenLastCalledWith('andrei@example.ro', 'right', true);
    await expect(result).resolves.toBe('signed-in');
  });

  it('shows no markup from a problem body, only the message for its code', async () => {
    await open();
    signIn.mockRejectedValueOnce(
      problem(401, {
        code: 'invalid_credentials',
        detail: '<img src=x onerror=alert(1)>',
        title: '<b>bold</b>',
      }),
    );

    await submit('andrei@example.ro', 'parola');

    expect(panel().querySelector('img, b, script')).toBeNull();
    expect(alertText()).toBe('E‑mailul sau parola nu sunt corecte.');
  });

  it('keeps an e-mail that looks like markup as text in the field', async () => {
    await open();
    signIn.mockRejectedValueOnce(problem(401, { code: 'invalid_credentials' }));

    await submit('"><img src=x onerror=alert(1)>@example.ro', 'parola');

    expect(panel().querySelector('img')).toBeNull();
    expect(panel().querySelector('[role="alert"] img')).toBeNull();
  });

  it.each([
    ['a body that is a bare string', problem(401, 'invalid_credentials')],
    ['a code that is not text', problem(401, { code: 42 })],
    ['a code from the prototype chain', problem(401, { code: 'constructor' })],
    ['an answer with no body', problem(401, null)],
    ['an error that is null', null],
    ['an error that is a string', 'invalid_credentials'],
  ])('shows the generic message for %s', async (_, failure) => {
    await open();
    signIn.mockRejectedValueOnce(failure);

    await submit('andrei@example.ro', 'parola');

    expect(alertText()).toBe('Ceva nu a mers. Încearcă din nou.');
    expect(button().disabled).toBe(false);
  });

  it('shows the refusal the server sent, not the offline text, when the browser says offline but an answer arrived', async () => {
    await open();
    online = false;
    signIn.mockRejectedValueOnce(problem(429, { code: 'too_many_attempts' }));

    await submit('andrei@example.ro', 'parola');

    expect(alertText()).toBe(
      'Prea multe încercări. Încearcă din nou în 15 minute.',
    );
  });

  it('keeps the e-mail and the unticked box after a refusal', async () => {
    await open();
    field('Ține‑mă autentificat').click();
    signIn.mockRejectedValueOnce(problem(403, { code: 'account_suspended' }));

    await submit('andrei@example.ro', 'parola');

    expect(field('E‑mail').value).toBe('andrei@example.ro');
    expect(field('Parolă').value).toBe('parola');
    expect(field('Ține‑mă autentificat').checked).toBe(false);
  });

  it('does not navigate or resolve when the answer is a refusal', async () => {
    await open();
    signIn.mockRejectedValueOnce(problem(503, { code: 'maintenance' }));
    const settled = jest.fn();
    result.then(settled);

    await submit('andrei@example.ro', 'parola');

    expect(settled).not.toHaveBeenCalled();
  });

  it('shows the generic message and stays open when the sign-in finishes without an account', async () => {
    await open();
    signIn.mockResolvedValueOnce(null);
    const settled = jest.fn();
    result.then(settled);

    await submit('andrei@example.ro', 'parola');

    expect(settled).not.toHaveBeenCalled();
    expect(alertText()).toBe('Ceva nu a mers. Încearcă din nou.');
  });
});
