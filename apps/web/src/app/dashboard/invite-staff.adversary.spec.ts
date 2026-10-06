import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GaragesService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { InviteStaff } from './invite-staff';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let send: jest.Mock;
let resend: jest.Mock;
let result: Promise<OverlayResult<'sent'>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  send = jest.fn(async () => ({ emailSent: true, id: 'invite-1' }));
  resend = jest.fn(async () => ({ emailSent: true, id: 'invite-1' }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: {
          garageInvitesControllerResend: resend,
          garageInvitesControllerSend: send,
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<'sent', { garageId: string }>(
    InviteStaff,
    {
      data: { garageId: 'garage-1' },
      shape: 'dialog',
      title: 'garage.invite.title',
    },
  );
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

function tick(input: HTMLInputElement) {
  input.click();
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

const text = () => panel().textContent ?? '';

async function fill(name = 'Elena Stan', email = 'elena@example.ro') {
  type(field('Nume'), name);
  type(field('E‑mail'), email);
  await settle();
}

const TICKS = [
  'Poate muta programările',
  'Poate răspunde la cererile de ofertă',
  'Poate înregistra prețul final',
];

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.restoreAllMocks();
  jest.mocked(toast).mockReset();
});

const refuse = (status: number, error: unknown) =>
  new HttpErrorResponse({ error, status });
const submit = async () => {
  button('Trimite invitația')?.click();
  await settle();
};

describe('the invite dialog under hostile use', () => {
  it.each([
    ['two characters', 'Al', true],
    ['eighty characters', 'a'.repeat(80), true],
    ['eighty-one characters', 'a'.repeat(81), false],
    ['one character', 'A', false],
    ['only spaces', '      ', false],
  ])('name of %s', async (_, name, sent) => {
    await open();
    await fill(name);
    await submit();

    expect(send).toHaveBeenCalledTimes(sent ? 1 : 0);
  });

  it('refuses an address of 255 characters', async () => {
    await open();
    await fill('Elena', `${'a'.repeat(248)}@bb.ccc`);
    expect(`${'a'.repeat(248)}@bb.ccc`).toHaveLength(255);
    await submit();

    expect(send).not.toHaveBeenCalled();
  });

  it('accepts an address of exactly 254 characters', async () => {
    await open();
    await fill('Elena', `${'a'.repeat(247)}@bb.ccc`);
    await submit();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['elena@', '@example.ro', 'el ena@example.ro', 'a@b'])(
    'refuses the address %j',
    async (email) => {
      await open();
      await fill('Elena', email);
      await submit();

      expect(send).not.toHaveBeenCalled();
    },
  );

  it('sends nothing for an empty form', async () => {
    await open();
    await submit();

    expect(send).not.toHaveBeenCalled();
    expect(field('Nume').getAttribute('aria-invalid')).toBe('true');
  });

  it('leaves the ticks out of a receptionist invite even when they were ticked first', async () => {
    await open();
    await fill();
    for (const label of TICKS) tick(field(label));
    tick(field('Recepționer'));
    await settle();
    await submit();

    expect(send.mock.calls[0][0].body).toEqual({
      email: 'elena@example.ro',
      kind: 'receptionist',
      name: 'Elena Stan',
    });
  });

  it('sends all three permissions when all are ticked for a mechanic', async () => {
    await open();
    await fill();
    for (const label of TICKS) tick(field(label));
    await settle();
    await submit();

    expect(send.mock.calls[0][0].body).toMatchObject({
      canAnswerQuotes: true,
      canMoveBookings: true,
      canRecordFinalPrice: true,
    });
  });

  it('keeps the address as typed in case, only trimmed', async () => {
    await open();
    await fill('Elena', '  Elena.Stan@Example.RO ');
    await submit();

    expect(send.mock.calls[0][0].body.email).toBe('Elena.Stan@Example.RO');
  });

  it('sends one invite for a double press of the submit button', async () => {
    await open();
    await fill();

    const go = button('Trimite invitația');
    go?.click();
    go?.click();
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('offers no resend when the open invite carries a non-string id', async () => {
    await open();
    send.mockRejectedValueOnce(
      refuse(409, { code: 'invite_open', inviteId: 42, message: 'open' }),
    );
    await fill();
    await submit();

    expect(button('Trimite din nou')).toBeUndefined();
  });

  it('offers no resend when the open invite carries no id', async () => {
    await open();
    send.mockRejectedValueOnce(
      refuse(409, { code: 'invite_open', message: 'open' }),
    );
    await fill();
    await submit();

    expect(button('Trimite din nou')).toBeUndefined();
  });

  it('withdraws the resend offer once a later send is refused for another reason', async () => {
    await open();
    send.mockRejectedValueOnce(
      refuse(409, { code: 'invite_open', inviteId: 'i-1', message: 'open' }),
    );
    send.mockRejectedValueOnce(
      refuse(409, { code: 'already_in_team', message: 'in team' }),
    );
    await fill();
    await submit();
    expect(button('Trimite din nou')).toBeDefined();

    await submit();

    expect(button('Trimite din nou')).toBeUndefined();
  });

  it('keeps the form and toasts when the resend fails', async () => {
    await open();
    send.mockRejectedValueOnce(
      refuse(409, { code: 'invite_open', inviteId: 'i-1', message: 'open' }),
    );
    await fill();
    await submit();
    resend.mockRejectedValueOnce(refuse(409, { code: 'invite_invalid' }));

    button('Trimite din nou')?.click();
    await settle();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(field('Nume').value).toBe('Elena Stan');
    expect(button('Gata')).toBeUndefined();
  });

  it('survives a server error with no body', async () => {
    await open();
    send.mockRejectedValueOnce(refuse(500, null));
    await fill();
    await submit();

    expect(button('Trimite invitația')).toBeDefined();
    expect(button('Gata')).toBeUndefined();
  });

  it('survives a failure that is not an HTTP error', async () => {
    await open();
    send.mockRejectedValueOnce(new Error('offline'));
    await fill();
    await submit();

    expect(button('Trimite invitația')).toBeDefined();
  });

  it('tells the owner the copy failed when the clipboard is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: jest.fn(async () => {
          throw new Error('denied');
        }),
      },
    });
    await open();
    send.mockResolvedValueOnce({
      emailSent: false,
      id: 'i-1',
      link: 'https://motorfix.ro/ro/invite/x',
    });
    await fill();
    await submit();

    button('Copiază linkul')?.click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Nu am putut copia linkul.');
  });

  it('offers no copy button when the e-mail was sent', async () => {
    await open();
    await fill();
    await submit();

    expect(button('Copiază linkul')).toBeUndefined();
    expect(text()).not.toContain('https://');
  });

  it('closes cancelled from "Anulează" without sending', async () => {
    await open();
    await fill();

    button('Anulează')?.click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a receptionist invite after the mechanic kind was switched off', async () => {
    await open();
    send.mockRejectedValueOnce(
      refuse(404, { code: 'feature_off', message: 'off' }),
    );
    await fill();
    await submit();

    await submit();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].body).toEqual({
      email: 'elena@example.ro',
      kind: 'receptionist',
      name: 'Elena Stan',
    });
  });

  it('sends a name with unicode and quotes exactly as typed', async () => {
    await open();
    await fill('Ștefan "Ștef" Țurcanu', 'stefan@example.ro');
    await submit();

    expect(send.mock.calls[0][0].body.name).toBe('Ștefan "Ștef" Țurcanu');
  });
});
