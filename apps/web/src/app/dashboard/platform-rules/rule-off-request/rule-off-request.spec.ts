import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { RuleOffRequest } from './rule-off-request';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const KEY = 'reviews_only_after_confirmed_job';
const SENT = {
  decidedAt: null,
  decidedByName: null,
  id: 'change-1',
  key: KEY,
  mine: true,
  reason: 'Testăm recenziile din profil.',
  requestedAt: '2026-10-08T09:00:00.000Z',
  requestedByName: 'Ioana',
  status: 'requested',
};

let send: jest.Mock;
let result: Promise<OverlayResult<unknown>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  send = jest.fn(async () => SENT);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { platformRuleChangesControllerRequest: send },
      },
    ],
  });
  await TestBed.inject(I18n).enter('admin');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(RuleOffRequest, {
    data: { key: KEY },
    shape: 'dialog',
    title: 'admin.platformRules.request.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const reason = () =>
  panel().querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;
const text = () => (panel().textContent ?? '').replace(/\s+/g, ' ');

function type(value: string) {
  reason().value = value;
  reason().dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('the request to switch the reviews rule off', () => {
  it('asks in Romanian, with what changes, a reason field and its range', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Oprești regula „Recenzii doar după o lucrare confirmată”?',
    );
    expect(text()).toContain(
      'Șoferii conectați vor putea lăsa recenzii și din profilul unui service, fără o lucrare prin MotorFix.',
    );
    expect(text()).toContain('Un alt administrator trebuie să aprobe.');
    const label = panel().querySelector(`label[for="${reason().id}"]`);
    expect(label?.textContent?.trim()).toBe('Motiv');
    const described = (reason().getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('5–300');
    expect(button('Trimite cererea')?.type).toBe('submit');
    expect(button('Renunță')).toBeDefined();
  });

  it('speaks English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Switch off "Reviews only after a confirmed job"?',
    );
    expect(text()).toContain('Another admin has to approve.');
    expect(button('Send the request')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });

  it('sends nothing for a reason under five characters and says why', async () => {
    await open();
    type('  abcd  ');

    button('Trimite cererea')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Scrie cel puțin 5 caractere.');
    expect(reason().getAttribute('aria-invalid')).toBe('true');
  });

  it('sends nothing for a reason over 300 characters', async () => {
    await open();
    type('a'.repeat(301));

    button('Trimite cererea')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Scrie cel mult 300 caractere.');
  });

  it('sends the rule and the trimmed reason, then closes with the request', async () => {
    await open();
    type('  Testăm recenziile din profil.  ');

    button('Trimite cererea')?.click();
    await settle();

    expect(send).toHaveBeenCalledWith({
      body: { key: KEY, reason: 'Testăm recenziile din profil.' },
    });
    await expect(result).resolves.toEqual(SENT);
  });

  it('sends nothing when cancelled', async () => {
    await open();
    type('Testăm recenziile din profil.');

    button('Renunță')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });

  it('closes on Escape and sends nothing', async () => {
    await open();

    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(send).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });

  it('shows in the dialog that another request already waits', async () => {
    await open();
    send.mockRejectedValueOnce(
      new HttpErrorResponse({ error: { code: 'change_pending' }, status: 409 }),
    );
    type('Testăm recenziile din profil.');

    button('Trimite cererea')?.click();
    await settle();

    expect(text()).toContain(
      'O altă cerere pentru această regulă așteaptă deja.',
    );
  });
});
