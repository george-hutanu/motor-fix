import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { ProposedJobApprove } from './proposed-job-approve';

// @traces 414-FR-012

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const JOB = {
  id: 'job-1',
  name: 'Recondiționare injectoare',
  proposedAt: '2026-10-20T09:00:00.000Z',
};
const RAR = [{ code: 'mechanics', nameEn: 'mechanics', nameRo: 'mecanică' }];
const EMOJI = '\u{1F600}';

let send: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open() {
  send = jest.fn(async () => ({ id: 'job-1', status: 'approved' }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { jobDecisionsControllerApprove: send },
      },
    ],
  });
  await TestBed.inject(I18n).enter('admin');
  const host = TestBed.createComponent(Host);
  host.componentInstance.overlays.open(ProposedJobApprove, {
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
const submit = () =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Aprobă',
  ) as HTMLButtonElement;
const text = () => (panel().textContent ?? '').replace(/\s+/g, ' ');

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

async function fill(ro = 'Injectoare', en = 'Injectors') {
  await type('mf-approve-ro', ro);
  await type('mf-approve-en', en);
  await choose('mf-approve-system', 'engine');
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

describe('the approve dialog under hostile names', () => {
  it('enables "Aprobă" once both names and a system are valid', async () => {
    await open();
    await fill();

    expect(submit().disabled).toBe(false);
  });

  it('keeps "Aprobă" disabled when no system is chosen', async () => {
    await open();
    await type('mf-approve-en', 'Injectors');

    expect(submit().disabled).toBe(true);
  });

  it.each([
    ['two emoji', EMOJI.repeat(2), true],
    ['three emoji', EMOJI.repeat(3), false],
    ['80 emoji', EMOJI.repeat(80), false],
    ['81 emoji', EMOJI.repeat(81), true],
    ['80 padded characters', ` ${'a'.repeat(80)} `, false],
    ['81 characters', 'a'.repeat(81), true],
    ['two characters padded', '  ab  ', true],
    ['only spaces', ' '.repeat(10), true],
    ['only non-breaking spaces', ' '.repeat(10), true],
    ['an empty string', '', true],
  ])(
    'sets "Aprobă" disabled=%3$s for an English name of %s',
    async (_, name, disabled) => {
      await open();
      await fill('Injectoare', name);

      expect(submit().disabled).toBe(disabled);
    },
  );

  it('keeps "Aprobă" disabled when the Romanian name is cleared', async () => {
    await open();
    await fill('', 'Injectors');

    expect(submit().disabled).toBe(true);
  });

  it('keeps "Aprobă" disabled for a Romanian name with a control character', async () => {
    await open();
    await fill('Ulei\u0007motor', 'Oil');

    expect(submit().disabled).toBe(true);
  });

  it('sends trimmed names and leaves the RAR activity out when none is chosen', async () => {
    await open();
    await fill('  Injectoare  ', '  Injectors ');
    submit().click();
    await settle();

    expect(send).toHaveBeenCalledWith({
      body: { carSystem: 'engine', nameEn: 'Injectors', nameRo: 'Injectoare' },
      id: 'job-1',
    });
  });

  it('sends the chosen RAR activity code', async () => {
    await open();
    await fill();
    await choose('mf-approve-rar', 'mechanics');
    submit().click();
    await settle();

    expect(send.mock.calls[0][0].body.rarActivity).toBe('mechanics');
  });

  it('sends one call when "Aprobă" is clicked twice at once', async () => {
    await open();
    await fill();

    submit().click();
    submit().click();
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('shows the existing job under the English name when the refusal names that field', async () => {
    await open();
    send.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: {
          code: 'exists',
          errors: [{ code: 'exists', field: 'nameEn' }],
          nameRo: 'Schimb ulei',
        },
        status: 422,
      }),
    );
    await fill();
    submit().click();
    await settle();

    expect(text()).toContain('Există deja în catalog: Schimb ulei');
    expect(panel().querySelector('form')).not.toBeNull();
  });

  it('keeps the dialog open on a 422 whose body is not the problem shape', async () => {
    await open();
    send.mockRejectedValueOnce(
      new HttpErrorResponse({ error: null, status: 422 }),
    );
    await fill();
    submit().click();
    await settle();

    expect(panel().querySelector('form')).not.toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('keeps the dialog open on a network failure so the admin can try again', async () => {
    await open();
    send.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await fill();
    submit().click();
    await settle();

    expect(panel().querySelector('form')).not.toBeNull();
    expect(text()).not.toContain('Există deja în catalog');
  });
});
