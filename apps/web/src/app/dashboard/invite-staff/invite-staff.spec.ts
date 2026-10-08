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

const has = (label: string) =>
  [...panel().querySelectorAll('label')].some((l) =>
    l.textContent?.trim().startsWith(label),
  );

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

describe('the invite dialog', () => {
  // @traces 131-FR-011
  it('asks for a name, an e-mail and a kind, mechanic chosen, with three unticked permissions', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Invită în echipă',
    );
    expect(field('E‑mail').type).toBe('email');
    expect(field('Mecanic').checked).toBe(true);
    expect(field('Recepționer').checked).toBe(false);
    for (const label of TICKS) expect(field(label).checked).toBe(false);
    expect(button('Trimite invitația')?.type).toBe('submit');
  });

  it('shows the permission ticks only for a mechanic', async () => {
    await open();

    tick(field('Recepționer'));
    await settle();

    for (const label of TICKS) expect(has(label)).toBe(false);
    tick(field('Mecanic'));
    await settle();
    for (const label of TICKS) expect(has(label)).toBe(true);
  });

  // @traces 131-FR-011
  it('shows the field problems and sends nothing until they are fixed', async () => {
    await open();
    type(field('Nume'), 'E');
    type(field('E‑mail'), 'elena');

    button('Trimite invitația')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Adresa de e‑mail nu pare corectă.');
    expect(field('Nume').getAttribute('aria-invalid')).toBe('true');
  });

  // @traces 131-FR-011 131-FR-014
  it('sends a mechanic invite with the trimmed values and the ticks chosen', async () => {
    await open();
    await fill('  Elena Stan ', ' elena@example.ro ');
    tick(field('Poate înregistra prețul final'));
    await settle();

    button('Trimite invitația')?.click();
    await settle();

    expect(send).toHaveBeenCalledWith({
      body: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: true,
        email: 'elena@example.ro',
        kind: 'mechanic',
        name: 'Elena Stan',
      },
      garageId: 'garage-1',
    });
    expect(text()).toContain('Invitația a fost trimisă.');
    button('Gata')?.click();
    await settle();
    await expect(result).resolves.toBe('sent');
  });

  it('sends a receptionist invite with no permissions', async () => {
    await open();
    await fill();
    tick(field('Recepționer'));
    await settle();

    button('Trimite invitația')?.click();
    await settle();

    expect(send).toHaveBeenCalledWith({
      body: {
        email: 'elena@example.ro',
        kind: 'receptionist',
        name: 'Elena Stan',
      },
      garageId: 'garage-1',
    });
  });

  // @traces 131-FR-011
  it('offers the link to copy when the e-mail could not be sent', async () => {
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await open();
    const link = `https://motorfix.ro/ro/invite/${'A'.repeat(43)}`;
    send.mockResolvedValueOnce({ emailSent: false, id: 'invite-1', link });
    await fill();

    button('Trimite invitația')?.click();
    await settle();
    expect(text()).toContain('Nu am putut trimite invitația.');
    button('Copiază linkul')?.click();
    await settle();

    expect(writeText).toHaveBeenCalledWith(link);
    expect(toast).toHaveBeenCalledWith('Linkul a fost copiat.');
  });

  it('offers to send again when the address already has an open invite', async () => {
    await open();
    send.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: {
          code: 'invite_open',
          inviteId: 'invite-9',
          message: 'open',
        },
        status: 409,
      }),
    );
    await fill();

    button('Trimite invitația')?.click();
    await settle();
    expect(text()).toContain('Această adresă are deja o invitație deschisă.');
    button('Trimite din nou')?.click();
    await settle();

    expect(resend).toHaveBeenCalledWith({
      garageId: 'garage-1',
      id: 'invite-9',
    });
    expect(text()).toContain('Invitația a fost trimisă.');
  });

  // @traces 131-FR-011
  it('stops offering a mechanic once the garage has mechanics switched off', async () => {
    await open();
    send.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { code: 'feature_off', message: 'off' },
        status: 404,
      }),
    );
    await fill();

    button('Trimite invitația')?.click();
    await settle();

    expect(text()).toContain('Invitarea mecanicilor nu este disponibilă acum.');
    expect(has('Mecanic')).toBe(false);
    expect(field('Recepționer').checked).toBe(true);
    for (const label of TICKS) expect(has(label)).toBe(false);
  });

  it("says so when the person is already in the garage's team", async () => {
    await open();
    send.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { code: 'already_in_team', message: 'in team' },
        status: 409,
      }),
    );
    await fill();

    button('Trimite invitația')?.click();
    await settle();

    expect(text()).toContain('Persoana face deja parte din echipă.');
    expect(button('Trimite din nou')).toBeUndefined();
  });

  // @traces 131-FR-013
  it('shows a typed name as text, never as markup', async () => {
    await open();
    send.mockResolvedValueOnce({
      emailSent: false,
      id: 'invite-1',
      link: 'https://motorfix.ro/ro/invite/x',
    });
    await fill('<b>Elena</b>', 'elena@example.ro');

    button('Trimite invitația')?.click();
    await settle();

    expect(panel().querySelector('b')).toBeNull();
  });

  // @traces 131-FR-013
  it('reads English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Invite to the team',
    );
    expect(field('Mechanic').checked).toBe(true);
    expect(button('Send the invite')).toBeDefined();
  });
});
