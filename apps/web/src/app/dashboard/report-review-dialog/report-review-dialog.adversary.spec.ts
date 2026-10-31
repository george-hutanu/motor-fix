import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type ReviewReportDto, ReviewsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import {
  type ReportReviewData,
  ReportReviewDialog,
  type ReportReviewResult,
} from './report-review-dialog';
import { staffReview } from '../garage-reviews/garage-reviews.testing';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const ANSWER: ReviewReportDto = {
  dueAt: '2026-10-27T12:00:00.000Z',
  id: 'rep-1',
  reason: 'insults',
  review: { id: 'r-1', status: 'reported' },
  status: 'pending',
};

let send: jest.Mock;
let result: Promise<ReportReviewResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  review = staffReview({ id: 'r-1', postedAt: '2026-09-14T10:00:00.000Z' }),
) {
  send = jest.fn(async () => ANSWER);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ReviewsService,
        useValue: { reviewReportsControllerReport: send },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    ReportReviewResult,
    ReportReviewData
  >(ReportReviewDialog, {
    data: { review },
    shape: 'dialog',
    title: 'garage.reviews.report.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');
const submit = () =>
  panel().querySelector('button[type="submit"]') as HTMLButtonElement;
const radio = (label: string) =>
  [...panel().querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
    (r) => (r.closest('label')?.textContent ?? '').trim() === label,
  ) as HTMLInputElement;
const field = () => panel().querySelector<HTMLTextAreaElement>('textarea');

async function pick(label: string) {
  radio(label).click();
  await settle();
}
async function type(value: string) {
  const area = field() as HTMLTextAreaElement;
  area.value = value;
  area.dispatchEvent(new Event('input'));
  await settle();
}
const refusal = (status: number, body: unknown) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  (toast as unknown as jest.Mock).mockClear();
  jest.restoreAllMocks();
  TestBed.resetTestingModule();
});

// @traces 1382-FR-004
describe('the report task: the text boundary', () => {
  it('sends a text of exactly 500 characters whole', async () => {
    await open();
    await pick('Altceva');
    await type('é'.repeat(500));

    submit().click();
    await settle();

    expect(send.mock.calls[0][0].body).toEqual({
      reason: 'other',
      text: 'é'.repeat(500),
    });
  });

  it('counts 500 astral characters as 500 and 501 as over', async () => {
    await open();
    await pick('Altceva');

    await type('😀'.repeat(500));
    expect(submit().disabled).toBe(false);
    expect(text()).toContain('500 / 500');

    await type('😀'.repeat(501));
    expect(submit().disabled).toBe(true);
  });

  it('accepts 500 characters padded with spaces and sends them trimmed', async () => {
    await open();
    await pick('Altceva');
    await type(`   ${'a'.repeat(500)}   `);

    expect(submit().disabled).toBe(false);
    submit().click();
    await settle();

    expect(send.mock.calls[0][0].body.text).toBe('a'.repeat(500));
  });

  it('keeps send disabled for a text of only newlines and tabs', async () => {
    await open();
    await pick('Altceva');

    await type('\n\t \n');

    expect(submit().disabled).toBe(true);
  });

  it('sends nothing when the form is submitted while invalid', async () => {
    await open();
    panel().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();

    expect(send).not.toHaveBeenCalled();
  });

  it('sends text again after Altceva is re-picked with the old value kept', async () => {
    await open();
    await pick('Altceva');
    await type('primul');
    await pick('Insulte');
    await pick('Altceva');

    submit().click();
    await settle();

    expect(send.mock.calls[0][0].body).toEqual({
      reason: 'other',
      text: 'primul',
    });
  });

  it('sends nothing but the reason after Altceva with a too-long text then another reason', async () => {
    await open();
    await pick('Altceva');
    await type('x'.repeat(900));
    await pick('Reclame');

    expect(submit().disabled).toBe(false);
    submit().click();
    await settle();

    expect(send.mock.calls[0][0].body).toStrictEqual({ reason: 'ads' });
  });

  it('shows markup in the text as plain characters', async () => {
    await open();
    await pick('Altceva');
    await type('<img src=x onerror=alert(1)>');
    expect(panel().querySelector('img')).toBeNull();

    submit().click();
    await settle();

    expect(send.mock.calls[0][0].body.text).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});

// @traces 1382-FR-005
describe('the report task: sending twice and failing oddly', () => {
  it('sends once when send is pressed twice before the answer', async () => {
    await open();
    await pick('Insulte');
    send.mockReturnValueOnce(new Promise(() => undefined));

    submit().click();
    submit().click();
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends the same values on retry after a 503', async () => {
    await open();
    await pick('Altceva');
    await type('Date de contact');
    send.mockRejectedValueOnce(refusal(503, { code: 'unavailable' }));

    submit().click();
    await settle();
    submit().click();
    await settle();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(toast).not.toHaveBeenCalledWith(
      expect.stringContaining('undefined'),
    );
  });

  it('stays open on a 400 without a toast', async () => {
    await open();
    await pick('Insulte');
    send.mockRejectedValueOnce(refusal(400, { code: 'validation_failed' }));

    submit().click();
    await settle();

    expect(panel()).not.toBeNull();
    expect(toast).not.toHaveBeenCalled();
    expect(radio('Insulte').checked).toBe(true);
  });

  it('stays open on a non-HTTP failure and keeps the reason', async () => {
    await open();
    await pick('Insulte');
    send.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    submit().click();
    await settle();

    expect(panel()).not.toBeNull();
    expect(radio('Insulte').checked).toBe(true);
  });

  it('toasts a real sentence, not the key or undefined, for Nest’s bare 404', async () => {
    await open();
    await pick('Insulte');
    send.mockRejectedValueOnce(
      refusal(404, {
        error: 'Not Found',
        message: 'Not Found',
        statusCode: 404,
      }),
    );

    submit().click();
    await settle();

    await expect(result).resolves.toBe('refused');
    const [said] = (toast as unknown as jest.Mock).mock.calls[0];
    expect(said).toBe('Recenzia nu mai este disponibilă.');
  });

  it('toasts a real sentence for a 409 whose body is plain text', async () => {
    await open();
    await pick('Insulte');
    send.mockRejectedValueOnce(refusal(409, 'Conflict'));

    submit().click();
    await settle();

    await expect(result).resolves.toBe('refused');
    const [said] = (toast as unknown as jest.Mock).mock.calls[0];
    expect(said).not.toMatch(/undefined|garage\.reviews|^$/);
  });

  it('toasts once and closes once for a 403', async () => {
    await open();
    await pick('Insulte');
    send.mockRejectedValueOnce(
      refusal(403, { code: 'forbidden', status: 403 }),
    );

    submit().click();
    await settle();

    await expect(result).resolves.toBe('refused');
    expect(toast).toHaveBeenCalledTimes(1);
  });
});

// @traces 1382-FR-003 1382-FR-004
describe('the report task: the subject and the discard question', () => {
  it('uses the deleted-author label for a deleted author', async () => {
    await open(
      staffReview({
        author: { shortName: 'Șofer MotorFix' },
        postedAt: '2026-09-14T10:00:00.000Z',
      }),
    );

    expect(text()).toContain('Șofer MotorFix · sept. 2026');
  });

  it('shows an author name with markup as plain characters', async () => {
    await open(
      staffReview({
        author: { shortName: '<b>Andrei</b>' },
        postedAt: '2026-09-14T10:00:00.000Z',
      }),
    );

    expect(panel().querySelector('b')).toBeNull();
    expect(text()).toContain('<b>Andrei</b> · sept. 2026');
  });

  it('reads the month in the Bucharest day at the month boundary', async () => {
    await open(staffReview({ postedAt: '2026-09-30T22:30:00.000Z' }));

    expect(text()).toContain('oct. 2026');
  });

  it('draws no Invalid Date or NaN for a posted date that is not a date', async () => {
    await open(staffReview({ postedAt: 'not-a-date' }));

    expect(text()).not.toMatch(/Invalid|NaN|undefined/);
  });

  it('closes at once on Escape when nothing is picked', async () => {
    await open();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    panel()?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });

  it('asks Renunți la modificări? on Escape once a reason is picked and sends nothing', async () => {
    await open();
    await pick('Insulte');

    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(document.body.textContent).toContain('Renunți la modificări?');
    expect(send).not.toHaveBeenCalled();
  });
});
