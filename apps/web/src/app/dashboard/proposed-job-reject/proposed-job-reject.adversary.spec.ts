import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

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
const EMOJI = '\u{1F600}';

let send: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open() {
  send = jest.fn(async () => ({ id: 'job-2', status: 'rejected' }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { jobDecisionsControllerReject: send },
      },
    ],
  });
  await TestBed.inject(I18n).enter('admin');
  const host = TestBed.createComponent(Host);
  host.componentInstance.overlays.open(ProposedJobReject, {
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
const submit = () =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Respinge',
  ) as HTMLButtonElement;
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

describe('the reject dialog under hostile reasons', () => {
  it('counts 500 emoji as 500 and keeps "Respinge" enabled', async () => {
    await open();
    await type(EMOJI.repeat(500));

    expect(counter()).toBe('500/500');
    expect(submit().disabled).toBe(false);
  });

  it('disables "Respinge" at 501 emoji', async () => {
    await open();
    await type(EMOJI.repeat(501));

    expect(counter()).toBe('501/500');
    expect(submit().disabled).toBe(true);
  });

  it('enables "Respinge" for exactly ten emoji and not for nine', async () => {
    await open();
    await type(EMOJI.repeat(9));
    expect(submit().disabled).toBe(true);
    await type(EMOJI.repeat(10));
    expect(submit().disabled).toBe(false);
  });

  it.each([
    ['spaces', ' '.repeat(600)],
    ['tabs and newlines', '\t\n '.repeat(20)],
    ['non-breaking spaces', ' '.repeat(30)],
  ])(
    'keeps "Respinge" disabled for a reason of only %s and counts 0',
    async (_, value) => {
      await open();
      await type(value);

      expect(counter()).toBe('0/500');
      expect(submit().disabled).toBe(true);
      submit().click();
      await settle();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('keeps "Respinge" disabled for a reason of only zero-width spaces', async () => {
    await open();
    await type('​'.repeat(20));

    expect(submit().disabled).toBe(true);
  });

  it('sends one call when "Respinge" is clicked twice at once', async () => {
    await open();
    await type('Nu este o lucrare de catalog.');

    submit().click();
    submit().click();
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends a multi-line reason with its inner line breaks intact', async () => {
    await open();
    await type('  Prima linie.\nA doua linie.  ');
    submit().click();
    await settle();

    expect(send).toHaveBeenCalledWith({
      body: { reason: 'Prima linie.\nA doua linie.' },
      id: 'job-2',
    });
  });
});
