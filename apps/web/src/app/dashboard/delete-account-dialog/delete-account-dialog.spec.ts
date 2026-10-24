import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService, type MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { DeleteAccountDialog } from './delete-account-dialog';
import { SignInDialog } from '../../sign-in/sign-in-dialog';
import { Live } from '../live';
import { PushDevice } from '../push-device';
import { Session } from '../session';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

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

let remove: jest.Mock;
let gate: jest.Mock;
let revoked: jest.Mock;
let deleteAccount: jest.Mock;
let close: jest.Mock;
let dropped: jest.Mock;
let navigate: jest.SpyInstance;
let result: Promise<OverlayResult<true>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  me: Partial<MeDto> = {},
  answers: (() => Promise<unknown>)[] = [],
  language: 'ro' | 'en' = 'ro',
) {
  const queue = [...answers];
  remove = jest.fn(() => (queue.shift() ?? (async () => undefined))());
  gate = jest.fn(async () => true);
  revoked = jest.fn();
  deleteAccount = jest.fn((send: () => Promise<unknown>) => send());
  close = jest.fn();
  dropped = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AuthService,
        useValue: { accountDeletionControllerDeleteAccount: remove },
      },
      {
        provide: Session,
        useValue: {
          current: signal({
            email: 'andrei@example.ro',
            phone: null,
            ...me,
          }),
          deleteAccount,
          revoked,
        },
      },
      { provide: SignInDialog, useValue: { gate } },
      { provide: Live, useValue: { close } },
      { provide: PushDevice, useValue: { dropped } },
      provideRouter([]),
    ],
  });
  navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<true>(DeleteAccountDialog, {
    shape: 'dialog',
    title: 'shell.deleteAccount.dialogTitle',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

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
  ) as HTMLButtonElement;

const LABEL = 'Scrie e‑mailul sau telefonul contului';

async function confirm(value = 'andrei@example.ro') {
  type(field(LABEL), value);
  await settle();
  button('Șterge contul').click();
  await settle();
}

beforeEach(() => jest.mocked(toast).mockClear());

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

// @traces 129-FR-014
// @traces 129-FR-015
describe('the delete-account dialog', () => {
  it('says what goes and what stays, and asks for the e-mail or phone', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Ștergi contul?',
    );
    expect(panel().textContent).toContain(
      'sesiunile de pe toate dispozitivele',
    );
    expect(panel().textContent).toContain('„Șofer MotorFix”');
    expect(field(LABEL).autocomplete).toBe('off');
    expect(button('Renunță')).toBeDefined();
  });

  it('asks an account with neither e-mail nor phone to type the word', async () => {
    await open({ email: null, phone: null });

    expect(field('Scrie ȘTERGE')).toBeDefined();
  });

  it('keeps the destructive button off until the field is filled', async () => {
    await open();

    expect(button('Șterge contul').disabled).toBe(true);
    type(field(LABEL), '   ');
    await settle();
    expect(button('Șterge contul').disabled).toBe(true);
    type(field(LABEL), 'andrei@example.ro');
    await settle();
    expect(button('Șterge contul').disabled).toBe(false);
  });

  // @traces 129-FR-008
  it("sends the deletion as the session's own, so the sign-out word it sends this tab is left to it", async () => {
    await open();

    await confirm('andrei@example.ro');

    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(deleteAccount.mock.invocationCallOrder[0]).toBeLessThan(
      remove.mock.invocationCallOrder[0],
    );
    expect(revoked).toHaveBeenCalled();
  });

  it('sends what was typed and, once deleted, signs the tab out to Home with a toast', async () => {
    await open();

    await confirm(' andrei@example.ro ');

    expect(remove).toHaveBeenCalledWith({
      body: { confirmation: 'andrei@example.ro' },
    });
    expect(close).toHaveBeenCalled();
    expect(revoked).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/');
    expect(toast).toHaveBeenCalledWith('Contul tău a fost șters');
    expect(await result).toBe(true);
  });

  // @traces 129-FR-008
  it("forgets this browser's push device once deleted, and not before", async () => {
    await open({}, [
      async () => {
        throw problem(500, 'internal_error');
      },
    ]);

    await confirm();
    expect(dropped).not.toHaveBeenCalled();

    button('Șterge contul').click();
    await settle();
    expect(dropped).toHaveBeenCalledTimes(1);
  });

  it('shows a mismatch under the field and stays open', async () => {
    await open({}, [
      async () => {
        throw problem(400, 'validation_failed', [
          { code: 'mismatch', field: 'confirmation' },
        ]);
      },
    ]);

    await confirm('altcineva@example.ro');

    expect(panel().textContent).toContain('Nu se potrivește cu contul');
    expect(revoked).not.toHaveBeenCalled();
    expect(field(LABEL).value).toBe('altcineva@example.ro');
  });

  it('asks for a fresh sign-in on reauth_required, then sends once more', async () => {
    await open({}, [
      async () => {
        throw problem(401, 'reauth_required');
      },
    ]);

    await confirm();

    expect(gate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(revoked).toHaveBeenCalled();
  });

  it('sends only once more after a sign-in the server still finds too old', async () => {
    const stale = async () => {
      throw problem(401, 'reauth_required');
    };
    await open({}, [stale, stale]);

    await confirm();

    expect(gate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(revoked).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });

  it('does not send again when the sign-in is closed', async () => {
    await open({}, [
      async () => {
        throw problem(401, 'reauth_required');
      },
    ]);
    gate.mockResolvedValue(false);

    await confirm();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(revoked).not.toHaveBeenCalled();
  });

  it('keeps the dialog and the text after a failure, and a second press retries', async () => {
    await open({}, [
      async () => {
        throw problem(500, 'internal_error');
      },
    ]);

    await confirm();

    expect(panel().textContent).toContain('Ceva nu a mers la noi.');
    expect(field(LABEL).value).toBe('andrei@example.ro');
    expect(revoked).not.toHaveBeenCalled();

    button('Șterge contul').click();
    await settle();

    expect(remove).toHaveBeenCalledTimes(2);
    expect(revoked).toHaveBeenCalled();
  });

  it('closes without sending on "Renunță"', async () => {
    await open();

    button('Renunță').click();
    await settle();

    expect(remove).not.toHaveBeenCalled();
    expect(await result).toBe('cancelled');
  });

  it('reads English', async () => {
    await open({}, [], 'en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Delete your account?',
    );
    expect(field('Type the e‑mail or phone of the account')).toBeDefined();
    expect(button('Delete account').disabled).toBe(true);
    expect(button('Cancel')).toBeDefined();
  });
});
