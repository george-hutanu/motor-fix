import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { VerificationProblem } from './verification-problem';

// @traces 302-FR-007 302-FR-011

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const RECORDED = {
  check: {
    automatic: false,
    detail: 'Nu răspunde',
    fileId: 'file-1',
    id: 'check-representative',
    kind: 'representative',
    recordedAt: '2026-10-17T09:00:00.000Z',
    recordedBy: 'admin-1',
    result: 'failed',
  },
  rarActivities: [],
  summary: { en: '', ro: '' },
};

let record: jest.Mock;
let result: Promise<OverlayResult<unknown>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  record = jest.fn(async () => RECORDED);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { verificationChecksControllerRecord: record },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(VerificationProblem, {
    data: { fileId: 'file-1', kind: 'representative' },
    shape: 'dialog',
    title: 'admin.file.problem.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const detail = () =>
  panel().querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
const radio = (value: string) =>
  panel().querySelector<HTMLInputElement>(
    `input[type="radio"][value="${value}"]`,
  ) as HTMLInputElement;
const save = () =>
  panel().querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  ) as HTMLButtonElement;

function type(value: string) {
  detail().value = value;
  detail().dispatchEvent(new Event('input', { bubbles: true }));
}

function choose(value: string) {
  radio(value).click();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('the detail limits', () => {
  it('accepts exactly 200 characters and refuses 201', async () => {
    await open();
    choose('warning');

    type('x'.repeat(200));
    await settle();
    expect(save().disabled).toBe(false);

    type('x'.repeat(201));
    await settle();
    expect(save().disabled).toBe(true);
  });

  it('sends 200 characters that were padded with spaces trimmed', async () => {
    await open();
    choose('failed');

    type(` ${'x'.repeat(200)} `);
    await settle();
    save().click();
    await settle();

    expect(record).toHaveBeenCalledWith({
      body: { detail: 'x'.repeat(200), result: 'failed' },
      id: 'file-1',
      kind: 'representative',
    });
  });

  it('refuses a detail made of a line break, which the server would refuse', async () => {
    await open();
    choose('failed');

    type('a\nb');
    await settle();

    expect(save().disabled).toBe(true);
  });

  it('refuses a detail of a non-breaking space only', async () => {
    await open();
    choose('failed');

    type('  ');
    await settle();

    expect(save().disabled).toBe(true);
  });

  it('keeps save disabled with a detail and no choice', async () => {
    await open();

    type('Nu răspunde');
    await settle();

    expect(save().disabled).toBe(true);
    save().click();
    await settle();
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps Romanian diacritics and emoji in what it sends', async () => {
    await open();
    choose('warning');

    type('Țeavă ștearsă 🚗');
    await settle();
    save().click();
    await settle();

    expect(record).toHaveBeenCalledWith({
      body: { detail: 'Țeavă ștearsă 🚗', result: 'warning' },
      id: 'file-1',
      kind: 'representative',
    });
  });

  it('sends the last choice when the admin changes their mind', async () => {
    await open();
    choose('warning');
    choose('failed');

    type('Telefon greșit');
    await settle();
    save().click();
    await settle();

    expect(record).toHaveBeenCalledWith({
      body: { detail: 'Telefon greșit', result: 'failed' },
      id: 'file-1',
      kind: 'representative',
    });
  });
});

describe('saving', () => {
  it('records once for a double press', async () => {
    await open();
    choose('failed');
    type('Nu răspunde');
    await settle();

    save().click();
    save().click();
    await settle();

    expect(record).toHaveBeenCalledTimes(1);
  });

  it('stays open and keeps the text when the save fails', async () => {
    await open();
    record.mockRejectedValue(new HttpErrorResponse({ status: 500 }));
    choose('failed');
    type('Nu răspunde');
    await settle();

    save().click();
    await settle();

    expect(document.querySelector('mf-overlay-panel')).not.toBeNull();
    expect(detail().value).toBe('Nu răspunde');
    let settled = false;
    result.then(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);
  });

  it('shows the failure in the task, and a retry can succeed', async () => {
    await open();
    record.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    choose('failed');
    type('Nu răspunde');
    await settle();

    save().click();
    await settle();
    save().click();
    await settle();

    expect(record).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toEqual(RECORDED);
  });

  it('closes as cancelled with no call when cancelled', async () => {
    await open();
    choose('failed');
    type('Nu răspunde');
    await settle();

    panel()
      .querySelector<HTMLButtonElement>('form button[type="button"]')
      ?.click();
    await settle();

    expect(record).not.toHaveBeenCalled();
    await expect(result).resolves.toEqual('cancelled');
  });

  it('asks for the kind it was opened for', async () => {
    await open();
    choose('warning');
    type('ok');
    await settle();
    save().click();
    await settle();

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-1', kind: 'representative' }),
    );
  });
});
