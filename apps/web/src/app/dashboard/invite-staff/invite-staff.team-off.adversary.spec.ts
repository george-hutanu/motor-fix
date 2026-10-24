import { Component, inject, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GaragesService, type MeDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { InviteStaff } from './invite-staff';
import { Session } from '../session';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let send: jest.Mock;
let current: WritableSignal<MeDto | null>;

const entry = (garageId: string, features?: Record<string, unknown>) => ({
  features,
  garageId,
  name: garageId,
  permissions: {},
  role: 'owner',
  status: 'approved',
});

const account = (...entries: ReturnType<typeof entry>[]) =>
  ({ garageAccess: entries, garageId: 'garage-1' }) as unknown as MeDto;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(me: MeDto | null, garageId = 'garage-1') {
  send = jest.fn(async () => ({ emailSent: true, id: 'invite-1' }));
  current = signal(me);
  TestBed.configureTestingModule({
    providers: [
      { provide: Session, useValue: { current } },
      {
        provide: GaragesService,
        useValue: {
          garageInvitesControllerResend: jest.fn(),
          garageInvitesControllerSend: send,
        },
      },
    ],
  });
  const host = TestBed.createComponent(Host);
  host.componentInstance.overlays.open<'sent', { garageId: string }>(
    InviteStaff,
    { data: { garageId }, shape: 'dialog', title: 'garage.invite.title' },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

const radio = (label: string) =>
  [...panel().querySelectorAll('label')].find((l) =>
    l.textContent?.trim().startsWith(label),
  );

const input = (label: string) => {
  const found = radio(label);
  const el = found?.htmlFor
    ? document.getElementById(found.htmlFor)
    : found?.querySelector('input');
  return el instanceof HTMLInputElement ? el : null;
};

const type = (label: string, value: string) => {
  const el = input(label) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

async function submit() {
  type('Nume', 'Elena Stan');
  type('E‑mail', 'elena@example.ro');
  await settle();
  [...panel().querySelectorAll('button')]
    .find((b) => b.textContent?.trim() === 'Trimite invitația')
    ?.click();
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

describe('the invite dialog reading the session’s switches', () => {
  // @traces 531-FR-003
  it('offers no Mecanic and sends a receptionist invite with the team off', async () => {
    await open(account(entry('garage-1', { team_mechanics: false })));

    expect(radio('Mecanic')).toBeUndefined();
    expect(input('Recepționer')?.checked).toBe(true);
    expect(input('Poate muta programările')).toBeNull();
    await submit();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].body).toEqual({
      email: 'elena@example.ro',
      kind: 'receptionist',
      name: 'Elena Stan',
    });
  });

  // @traces 531-FR-003
  it.each([
    ['true', { team_mechanics: true }],
    ['unset', {}],
    ['undefined', undefined],
    ['another switch off', { day_sheets: false }],
    ['null', { team_mechanics: null }],
    ['the string false', { team_mechanics: 'false' }],
  ])(
    'offers Mecanic preselected with its ticks when the team is %s',
    async (_, features) => {
      await open(account(entry('garage-1', features)));

      expect(input('Mecanic')?.checked).toBe(true);
      expect(input('Poate muta programările')).not.toBeNull();
      await submit();
      expect(send.mock.calls[0][0].body.kind).toBe('mechanic');
    },
  );

  // @traces 531-FR-003
  it('keeps Mecanic when there is no session at all', async () => {
    await open(null);

    expect(input('Mecanic')?.checked).toBe(true);
  });

  // @traces 531-FR-003
  it('keeps Mecanic when the session holds no entry for the dialog’s garage', async () => {
    await open(account(entry('other', { team_mechanics: false })));

    expect(input('Mecanic')?.checked).toBe(true);
  });

  // @traces 531-FR-003
  it('reads the entry of the dialog’s garage, not the session’s current garage', async () => {
    await open(
      account(
        entry('garage-1', {}),
        entry('garage-2', { team_mechanics: false }),
      ),
      'garage-2',
    );

    expect(radio('Mecanic')).toBeUndefined();
    expect(input('Recepționer')?.checked).toBe(true);
  });

  // @traces 531-FR-003
  it('ignores the off switch of another garage in the same session', async () => {
    await open(
      account(
        entry('garage-1', {}),
        entry('garage-2', { team_mechanics: false }),
      ),
      'garage-1',
    );

    expect(input('Mecanic')?.checked).toBe(true);
  });

  // @traces 531-FR-003
  it('withdraws Mecanic and chooses Recepționer when the session turns the team off while open', async () => {
    await open(account(entry('garage-1', {})));
    expect(input('Mecanic')?.checked).toBe(true);

    current.set(account(entry('garage-1', { team_mechanics: false })));
    await settle();

    expect(radio('Mecanic')).toBeUndefined();
    expect(input('Recepționer')?.checked).toBe(true);
    await submit();
    expect(send.mock.calls[0][0].body.kind).toBe('receptionist');
  });

  // @traces 531-FR-003
  it('offers Mecanic again when the session turns the team back on while open', async () => {
    await open(account(entry('garage-1', { team_mechanics: false })));

    current.set(account(entry('garage-1', { team_mechanics: true })));
    await settle();

    expect(radio('Mecanic')).toBeDefined();
  });

  // @traces 531-FR-003
  it('keeps what was typed when the switch changes while open', async () => {
    await open(account(entry('garage-1', {})));
    type('Nume', 'Elena Stan');

    current.set(account(entry('garage-1', { team_mechanics: false })));
    await settle();

    expect(input('Nume')?.value).toBe('Elena Stan');
  });

  // @traces 531-FR-003
  it('never sends kind mechanic when the team is off even if mechanic was chosen before the change', async () => {
    await open(account(entry('garage-1', {})));
    expect(input('Mecanic')?.checked).toBe(true);
    current.set(account(entry('garage-1', { team_mechanics: false })));
    await settle();
    await submit();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].body.kind).not.toBe('mechanic');
    expect(send.mock.calls[0][0].body).not.toHaveProperty('canMoveBookings');
  });

  // @traces 531-FR-003
  it('goes on offering a receptionist invite after the session loses the garage entry', async () => {
    await open(account(entry('garage-1', { team_mechanics: false })));

    current.set(null);
    await settle();
    await submit();

    expect(send).toHaveBeenCalledTimes(1);
  });
});
