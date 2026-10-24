import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '@motor-fix/data-access';
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

let remove: jest.Mock;
let release: () => void;
let revoked: jest.Mock;
let result: Promise<OverlayResult<true>>;
let dropped: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  answer: () => Promise<unknown>,
  me: Record<string, unknown> = {},
) {
  remove = jest.fn(answer);
  revoked = jest.fn();
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
          current: signal({ email: 'andrei@example.ro', phone: null, ...me }),
          deleteAccount: (send: () => Promise<unknown>) => send(),
          revoked,
        },
      },
      { provide: SignInDialog, useValue: { gate: jest.fn(async () => true) } },
      { provide: Live, useValue: { close: jest.fn() } },
      { provide: PushDevice, useValue: { dropped } },
      provideRouter([]),
    ],
  });
  jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<true>(DeleteAccountDialog, {
    shape: 'dialog',
    title: 'shell.deleteAccount.dialogTitle',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const input = () =>
  panel().querySelector<HTMLInputElement>(
    '#mf-delete-confirmation',
  ) as HTMLInputElement;
const confirmButton = () =>
  panel().querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  ) as HTMLButtonElement;

function type(value: string) {
  input().value = value;
  input().dispatchEvent(new Event('input', { bubbles: true }));
}

const pending = () =>
  new Promise<void>((resolve) => {
    release = resolve;
  });

beforeEach(() => jest.mocked(toast).mockClear());

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

// @traces 129-FR-014
describe('the delete-account dialog, attacked', () => {
  it('sends one request for a double click while the first is running', async () => {
    await open(() => pending());
    type('andrei@example.ro');
    await settle();

    confirmButton().click();
    confirmButton().click();
    await settle();
    confirmButton().click();
    await settle();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(confirmButton().getAttribute('aria-busy')).toBe('true');
    release();
    await settle();
  });

  it('sends one request for a submit through the form while the first is running', async () => {
    await open(() => pending());
    type('andrei@example.ro');
    await settle();

    confirmButton().click();
    await settle();
    panel()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(remove).toHaveBeenCalledTimes(1);
    release();
    await settle();
  });

  it('closes as deleted once however many times it was pressed, leaving the sign-out to Setări', async () => {
    await open(() => pending());
    type('andrei@example.ro');
    await settle();

    confirmButton().click();
    confirmButton().click();
    await settle();
    release();
    await settle();

    expect(await result).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    expect(revoked).not.toHaveBeenCalled();
    expect(dropped).not.toHaveBeenCalled();
  });

  it('does not send an empty or blank field through the form', async () => {
    await open(async () => undefined);
    type('   ');
    await settle();

    panel()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(remove).not.toHaveBeenCalled();
  });

  it('shows the error and lets a retry through after a lost connection', async () => {
    let calls = 0;
    await open(async () => {
      if (++calls === 1) {
        throw new HttpErrorResponse({ status: 0 });
      }
    });
    type('andrei@example.ro');
    await settle();

    confirmButton().click();
    await settle();

    expect(input().value).toBe('andrei@example.ro');
    expect(panel()).not.toBeNull();
    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();
    await settle();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await result).toBe(true);
  });

  it('sends the word typed with its surrounding whitespace removed for an account without e-mail or phone', async () => {
    await open(async () => undefined, { email: null, phone: null });
    type('  ȘTERGE\n');
    await settle();

    confirmButton().click();
    await settle();

    expect(remove).toHaveBeenCalledWith({ body: { confirmation: 'ȘTERGE' } });
  });
});
