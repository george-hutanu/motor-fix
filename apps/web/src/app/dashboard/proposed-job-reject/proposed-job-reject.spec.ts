import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { ProposedJobReject } from './proposed-job-reject';

// @traces 414-FR-012

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const JOB = {
  id: 'job-2',
  name: 'Chestii motor',
  proposedAt: '2026-10-20T09:00:00.000Z',
};
const REASON = 'Nu este clar ce lucrare este; există deja Diagnoză în catalog.';
const DECIDED = {
  decidedAt: '2026-10-23T09:00:00.000Z',
  id: 'job-2',
  nameEn: 'Chestii motor',
  nameRo: 'Chestii motor',
  rejectionReason: REASON,
  status: 'rejected',
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
  send = jest.fn(async () => DECIDED);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { jobDecisionsControllerReject: send },
      },
    ],
  });
  await TestBed.inject(I18n).enter('admin');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(ProposedJobReject, {
    data: { job: JOB },
    shape: 'dialog',
    title: 'admin.proposedJobs.reject.title',
    titleParams: { name: JOB.name },
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const reason = () =>
  panel().querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;
const text = () => (panel().textContent ?? '').replace(/\s+/g, ' ');
const counter = () =>
  panel().querySelector('[data-count]')?.textContent?.trim();

async function type(value: string) {
  reason().value = value;
  reason().dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

describe('the reject dialog', () => {
  it('asks with the job in its title, labels the reason and says who gets it', async () => {
    await open();

    expect(text()).toContain('Respingi lucrarea „Chestii motor”?');
    expect(
      panel().querySelector(`label[for="${reason().id}"]`)?.textContent?.trim(),
    ).toBe('Motivul');
    expect(text()).toContain('Service‑ul primește motivul.');
    expect(counter()).toBe('0/500');
  });

  it('speaks English in English', async () => {
    await open('en');

    expect(text()).toContain('Reject the job "Chestii motor"?');
    expect(text()).toContain('The garage gets the reason.');
    expect(button('Reject')).toBeDefined();
  });

  it('keeps "Respinge" disabled under 10 trimmed characters and over 500, counting as it goes', async () => {
    await open();

    expect(button('Respinge')?.disabled).toBe(true);
    await type('  123456789  ');
    expect(counter()).toBe('9/500');
    expect(button('Respinge')?.disabled).toBe(true);
    await type('1234567890');
    expect(counter()).toBe('10/500');
    expect(button('Respinge')?.disabled).toBe(false);
    await type('x'.repeat(500));
    expect(button('Respinge')?.disabled).toBe(false);
    await type('x'.repeat(501));
    expect(counter()).toBe('501/500');
    expect(button('Respinge')?.disabled).toBe(true);
  });

  it('sends the trimmed reason and closes with the decided job', async () => {
    await open();
    await type(`  ${REASON}  `);

    button('Respinge')?.click();
    await settle();

    expect(send).toHaveBeenCalledWith({
      body: { reason: REASON },
      id: 'job-2',
    });
    await expect(result).resolves.toEqual(DECIDED);
  });

  it('shows "Deja decis de {name}." on 409 with "Închide", which closes as decided', async () => {
    await open();
    send.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { code: 'already_decided', decidedBy: 'Ana' },
        status: 409,
      }),
    );
    await type(REASON);

    button('Respinge')?.click();
    await settle();

    expect(text()).toContain('Deja decis de Ana.');
    button('Închide')?.click();
    await settle();
    await expect(result).resolves.toBe('decided');
  });

  it('keeps the dialog open with the shared error line when the call fails', async () => {
    await open();
    send.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    await type(REASON);

    button('Respinge')?.click();
    await settle();

    expect(
      panel().querySelector('mf-task-error')?.textContent?.trim(),
    ).not.toBe('');
    expect(button('Respinge')).toBeDefined();
  });

  it('closes as cancelled on "Renunță" without sending', async () => {
    await open();

    button('Renunță')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });
});
