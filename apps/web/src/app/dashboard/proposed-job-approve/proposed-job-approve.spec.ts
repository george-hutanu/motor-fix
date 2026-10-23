import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { ProposedJobApprove } from './proposed-job-approve';

// @traces 414-FR-012

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const JOB = {
  fromBani: 18_000,
  id: 'job-1',
  name: 'Recondiționare injectoare',
  proposedAt: '2026-10-20T09:00:00.000Z',
};
const RAR = [
  { code: 'mechanics', nameEn: 'mechanics', nameRo: 'mecanică' },
  { code: 'brakes', nameEn: 'brakes', nameRo: 'frâne' },
];
const DECIDED = {
  carSystem: 'engine',
  decidedAt: '2026-10-23T09:00:00.000Z',
  id: 'job-1',
  nameEn: 'Injector reconditioning',
  nameRo: 'Recondiționare injectoare',
  status: 'approved',
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
        useValue: { jobDecisionsControllerApprove: send },
      },
    ],
  });
  await TestBed.inject(I18n).enter('admin');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(ProposedJobApprove, {
    data: { job: JOB, rarActivities: RAR },
    shape: 'dialog',
    title: 'admin.proposedJobs.approve.title',
    titleParams: { name: JOB.name },
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const field = <T extends HTMLElement>(id: string) =>
  panel().querySelector<T>(`#${id}`) as T;
const label = (id: string) =>
  (panel().querySelector(`label[for="${id}"]`)?.textContent ?? '').trim();
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;
const text = () => (panel().textContent ?? '').replace(/\s+/g, ' ');
const options = (id: string) =>
  [...field<HTMLSelectElement>(id).options].map((o) => o.textContent?.trim());

async function type(id: string, value: string) {
  const input = field<HTMLInputElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

async function choose(id: string, value: string) {
  const select = field<HTMLSelectElement>(id);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

const refusal = (status: number, error: unknown) =>
  new HttpErrorResponse({ error, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

describe('the approve dialog', () => {
  it('asks with the job in its title and labels each field', async () => {
    await open();

    expect(text()).toContain('Aprobi lucrarea „Recondiționare injectoare”?');
    expect(label('mf-approve-ro')).toBe('Nume în română');
    expect(label('mf-approve-en')).toBe('Nume în engleză');
    expect(label('mf-approve-system')).toBe('Sistem');
    expect(label('mf-approve-rar')).toBe('Activitate RAR');
  });

  it('prefills the Romanian name with the text as typed and leaves the English name empty', async () => {
    await open();

    expect(field<HTMLInputElement>('mf-approve-ro').value).toBe(
      'Recondiționare injectoare',
    );
    expect(field<HTMLInputElement>('mf-approve-en').value).toBe('');
  });

  it('offers the car systems in Romanian with none chosen, and the RAR activities with "Nicio activitate anume" chosen', async () => {
    await open();

    const systems = options('mf-approve-system');
    expect(systems).toContain('Motor');
    expect(systems).toContain('Suspensie și direcție');
    expect(systems).toHaveLength(10);
    expect(field<HTMLSelectElement>('mf-approve-system').value).toBe('');
    expect(options('mf-approve-rar')).toEqual([
      'Nicio activitate anume',
      'mecanică',
      'frâne',
    ]);
    expect(field<HTMLSelectElement>('mf-approve-rar').value).toBe('');
  });

  it('labels the systems and activities in English in English', async () => {
    await open('en');

    expect(text()).toContain('Approve the job "Recondiționare injectoare"?');
    expect(options('mf-approve-system')).toContain('Suspension and steering');
    expect(options('mf-approve-rar')[0]).toBe('No specific activity');
  });

  it('keeps "Aprobă" disabled until both names have 3 to 80 characters and a system is chosen', async () => {
    await open();

    expect(button('Aprobă')?.disabled).toBe(true);
    await type('mf-approve-en', 'In');
    await choose('mf-approve-system', 'engine');
    expect(button('Aprobă')?.disabled).toBe(true);
    await type('mf-approve-en', 'Injector reconditioning');
    expect(button('Aprobă')?.disabled).toBe(false);
    await type('mf-approve-ro', `  ${'a'.repeat(81)}  `);
    expect(button('Aprobă')?.disabled).toBe(true);
    await type('mf-approve-ro', '  Rec  ');
    expect(button('Aprobă')?.disabled).toBe(false);
  });

  it('sends the trimmed names, the system and no RAR activity, and closes with the decided job', async () => {
    await open();
    await type('mf-approve-ro', '  Recondiționare injectoare ');
    await type('mf-approve-en', 'Injector reconditioning');
    await choose('mf-approve-system', 'engine');

    button('Aprobă')?.click();
    await settle();

    expect(send).toHaveBeenCalledWith({
      body: {
        carSystem: 'engine',
        nameEn: 'Injector reconditioning',
        nameRo: 'Recondiționare injectoare',
      },
      id: 'job-1',
    });
    await expect(result).resolves.toEqual(DECIDED);
  });

  it('sends the RAR activity chosen', async () => {
    await open();
    await type('mf-approve-en', 'Injector reconditioning');
    await choose('mf-approve-system', 'engine');
    await choose('mf-approve-rar', 'mechanics');

    button('Aprobă')?.click();
    await settle();

    expect(send.mock.calls[0][0].body.rarActivity).toBe('mechanics');
  });

  it('shows "Există deja în catalog: {name}" under the Romanian name on 422 exists, and stays open', async () => {
    await open();
    send.mockRejectedValueOnce(
      refusal(422, {
        code: 'exists',
        errors: [{ code: 'exists', field: 'nameRo' }],
        jobTypeId: 'diag',
        nameRo: 'Diagnoză',
      }),
    );
    await type('mf-approve-ro', 'diagnoza');
    await type('mf-approve-en', 'Diagnosis');
    await choose('mf-approve-system', 'engine');

    button('Aprobă')?.click();
    await settle();

    const error = field('mf-approve-ro-error');
    expect(error.textContent?.trim()).toBe('Există deja în catalog: Diagnoză');
    expect(field('mf-approve-ro').getAttribute('aria-describedby')).toContain(
      'mf-approve-ro-error',
    );
    expect(document.querySelector('mf-overlay-panel')).not.toBeNull();
  });

  it('shows "Deja decis de {name}." on 409 with "Închide", which closes as decided', async () => {
    await open();
    send.mockRejectedValueOnce(
      refusal(409, {
        code: 'already_decided',
        currentStatus: 'approved',
        decidedBy: 'Ana',
      }),
    );
    await type('mf-approve-en', 'Injector reconditioning');
    await choose('mf-approve-system', 'engine');

    button('Aprobă')?.click();
    await settle();

    expect(text()).toContain('Deja decis de Ana.');
    button('Închide')?.click();
    await settle();
    await expect(result).resolves.toBe('decided');
  });

  it('shows "Deja decisă." when no name comes back', async () => {
    await open();
    send.mockRejectedValueOnce(refusal(409, { code: 'already_decided' }));
    await type('mf-approve-en', 'Injector reconditioning');
    await choose('mf-approve-system', 'engine');

    button('Aprobă')?.click();
    await settle();

    expect(text()).toContain('Deja decisă.');
  });

  it('keeps the dialog open with the shared error line when the call fails', async () => {
    await open();
    send.mockRejectedValueOnce(refusal(0, null));
    await type('mf-approve-en', 'Injector reconditioning');
    await choose('mf-approve-system', 'engine');

    button('Aprobă')?.click();
    await settle();

    expect(panel().querySelector('mf-task-error')?.textContent).toContain(
      'Nu am putut ajunge la MotorFix',
    );
    expect(button('Aprobă')).toBeDefined();
  });

  it('closes as cancelled on "Renunță" without sending', async () => {
    await open();

    button('Renunță')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });
});
