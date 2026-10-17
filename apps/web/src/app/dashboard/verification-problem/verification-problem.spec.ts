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
const text = () => (panel().textContent ?? '').replace(/\s+/g, ' ');

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

describe('marking a problem on a check', () => {
  it('asks for a warning or a failure and a detail', async () => {
    await open();

    expect(text()).toContain('Avertisment');
    expect(text()).toContain('Problemă');
    expect(radio('warning')).toBeTruthy();
    expect(radio('failed')).toBeTruthy();
    expect(detail().getAttribute('maxlength')).toBe('200');
  });

  it('reads in English', async () => {
    await open('en');

    expect(text()).toContain('Warning');
    expect(text()).toContain('Failure');
  });

  it('keeps save disabled until both are given, 1 to 200 characters', async () => {
    await open();
    expect(save().disabled).toBe(true);

    choose('failed');
    await settle();
    expect(save().disabled).toBe(true);

    type('   ');
    await settle();
    expect(save().disabled).toBe(true);

    type('x'.repeat(201));
    await settle();
    expect(save().disabled).toBe(true);

    type('Nu răspunde');
    await settle();
    expect(save().disabled).toBe(false);
  });

  it('records the result with its detail and closes with the answer', async () => {
    await open();

    choose('failed');
    type('  Nu răspunde  ');
    await settle();
    save().click();
    await settle();

    expect(record).toHaveBeenCalledWith({
      body: { detail: 'Nu răspunde', result: 'failed' },
      id: 'file-1',
      kind: 'representative',
    });
    await expect(result).resolves.toEqual(RECORDED);
  });
});
