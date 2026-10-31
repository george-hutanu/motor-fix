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

const DATA: ReportReviewData = {
  review: staffReview({ id: 'r-1', postedAt: '2026-09-14T10:00:00.000Z' }),
};

const ANSWER: ReviewReportDto = {
  dueAt: '2026-10-27T12:00:00.000Z',
  id: 'rep-1',
  reason: 'insults',
  review: { id: 'r-1', status: 'reported' },
  status: 'pending',
};

const RO_REASONS = [
  'Insulte',
  'Date personale',
  'Reclame',
  'Promovarea altor servicii',
  'În afara subiectului',
  'Ură sau discriminare',
  'Recenzie falsă sau cu conflict de interese',
  'Amenințări sau acuzații legale',
  'Altceva',
];

let send: jest.Mock;
let result: Promise<ReportReviewResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({ language = 'ro' }: { language?: 'ro' | 'en' } = {}) {
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
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    ReportReviewResult,
    ReportReviewData
  >(ReportReviewDialog, {
    data: DATA,
    shape: 'dialog',
    title: 'garage.reviews.report.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;

const radios = () => [
  ...panel().querySelectorAll<HTMLInputElement>('input[type="radio"]'),
];
const labelOf = (radio: HTMLInputElement) =>
  (radio.closest('label')?.textContent ?? '').replace(/\s+/g, ' ').trim();
const radio = (label: string) =>
  radios().find((r) => labelOf(r) === label) as HTMLInputElement;
const field = () => panel().querySelector<HTMLTextAreaElement>('textarea');
const counter = () =>
  (panel().querySelector('[data-counter]')?.textContent ?? '').trim();

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

const press = async (name = 'Trimite raportul') => {
  button(name)?.click();
  await settle();
};

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  (toast as unknown as jest.Mock).mockClear();
  jest.restoreAllMocks();
  TestBed.resetTestingModule();
});

// @traces 1382-FR-003 1382-FR-004 1382-FR-007
describe('the report task: what it asks', () => {
  it('names the author and the month under the title', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Raportează recenzia',
    );
    expect(text()).toContain('Andrei M. · sept. 2026');
  });

  it('offers the nine reasons in order under Motivul, none picked', async () => {
    await open();

    const group = panel().querySelector('fieldset') as HTMLFieldSetElement;
    expect(group.querySelector('legend')?.textContent?.trim()).toBe('Motivul');
    expect(radios().map(labelOf)).toEqual(RO_REASONS);
    expect(radios().some((r) => r.checked)).toBe(false);
    expect(new Set(radios().map((r) => r.name)).size).toBe(1);
  });

  it('says the review is hidden until an admin decides', async () => {
    await open();

    expect(text()).toContain(
      'Recenzia e ascunsă de pe profil până decide un admin, în cel mult 48 de ore.',
    );
    expect(button('Renunță')).toBeDefined();
  });

  it('keeps Trimite raportul disabled until a reason is picked', async () => {
    await open();

    expect(button('Trimite raportul')?.disabled).toBe(true);

    await pick('Insulte');

    expect(button('Trimite raportul')?.disabled).toBe(false);
  });

  it('asks for the text only for Altceva, counting it, and keeps it when another reason is picked', async () => {
    await open();
    expect(field()).toBeNull();

    await pick('Altceva');

    expect(field()).not.toBeNull();
    expect(text()).toContain('Spune‑ne ce nu e în regulă');
    expect(field()?.required).toBe(true);
    expect(counter()).toBe('0 / 500');
    expect(button('Trimite raportul')?.disabled).toBe(true);

    await type('Reclamă ascunsă la alt service');
    expect(counter()).toBe('30 / 500');
    expect(button('Trimite raportul')?.disabled).toBe(false);

    await pick('Reclame');
    expect(field()).toBeNull();

    await pick('Altceva');
    expect(field()?.value).toBe('Reclamă ascunsă la alt service');
  });

  it.each([
    ['   ', true],
    ['a'.repeat(500), false],
    ['a'.repeat(501), true],
  ])('with Altceva and %#, send disabled is %s', async (value, off) => {
    await open();
    await pick('Altceva');

    await type(value);

    expect(button('Trimite raportul')?.disabled).toBe(off);
  });

  it('closes on Renunță without reporting', async () => {
    await open();

    await press('Renunță');

    await expect(result).resolves.toBe('cancelled');
    expect(send).not.toHaveBeenCalled();
  });

  it('reads in English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Report the review',
    );
    expect(text()).toContain('Andrei M. · Sep 2026');
    expect(panel().querySelector('legend')?.textContent?.trim()).toBe('Reason');
    expect(radios().map(labelOf)).toEqual([
      'Insults',
      'Personal data',
      'Ads',
      'Promotion of other services',
      'Off topic',
      'Hate or discrimination',
      'Fake or conflicted review',
      'Threats or legal accusations',
      'Something else',
    ]);
    expect(text()).toContain(
      'The review is hidden from the profile until an admin decides, within 48 hours.',
    );
    expect(button('Send the report')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
    await pick('Something else');
    expect(text()).toContain('Tell us what is wrong');
  });
});

// @traces 1382-FR-004 1382-FR-005
describe('the report task: sending', () => {
  it('sends the reason alone, toasts and closes with the answer', async () => {
    await open();
    await pick('Insulte');

    await press();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({
      body: { reason: 'insults' },
      reviewId: 'r-1',
    });
    await expect(result).resolves.toEqual(ANSWER);
    expect(toast).toHaveBeenCalledWith(
      'Raportată. Un admin decide în 48 de ore.',
    );
  });

  it('sends the trimmed text only for Altceva', async () => {
    await open();
    await pick('Altceva');
    await type('  Reclamă ascunsă  ');

    await press();

    expect(send.mock.calls[0][0].body).toEqual({
      reason: 'other',
      text: 'Reclamă ascunsă',
    });
  });

  it('drops a text typed under Altceva once another reason is sent', async () => {
    await open();
    await pick('Altceva');
    await type('ceva');
    await pick('Ură sau discriminare');

    await press();

    expect(send.mock.calls[0][0].body).toEqual({ reason: 'hate' });
  });

  it('says Reported in English', async () => {
    await open({ language: 'en' });
    await pick('Insults');

    await press('Send the report');

    await expect(result).resolves.toEqual(ANSWER);
    expect(toast).toHaveBeenCalledWith(
      'Reported. An admin decides within 48 hours.',
    );
  });

  it.each([
    [409, 'already_reported', 'Recenzia e deja raportată.'],
    [
      409,
      'already_kept',
      'Păstrată de un admin; poate fi raportată din nou doar după ce autorul o editează.',
    ],
    [403, 'forbidden', 'Doar proprietarul poate raporta o recenzie.'],
    [404, 'not_found', 'Recenzia nu mai este disponibilă.'],
  ])(
    'closes on a %s %s with its message as the toast',
    async (status, code, message) => {
      await open();
      await pick('Insulte');
      send.mockRejectedValueOnce(refusal(status, { code, status }));

      await press();

      await expect(result).resolves.toBe('refused');
      expect(toast).toHaveBeenCalledWith(message);
    },
  );

  it('toasts the answer’s own detail for a refusal it has no text for', async () => {
    await open();
    await pick('Insulte');
    send.mockRejectedValueOnce(
      refusal(409, {
        code: 'something_new',
        detail: 'Altă problemă',
        status: 409,
      }),
    );

    await press();

    await expect(result).resolves.toBe('refused');
    expect(toast).toHaveBeenCalledWith('Altă problemă');
  });

  it('stays open after a network error with the reason and text kept, and retries', async () => {
    await open();
    await pick('Altceva');
    await type('Date de contact');
    send.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

    await press();

    expect(panel()).not.toBeNull();
    expect(panel().querySelector('[role="alert"]')).not.toBeNull();
    expect(radio('Altceva').checked).toBe(true);
    expect(field()?.value).toBe('Date de contact');
    expect(toast).not.toHaveBeenCalled();

    await press();

    expect(send).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toEqual(ANSWER);
  });

  it('stays open after a 500 with the shared error line', async () => {
    await open();
    await pick('Insulte');
    send.mockRejectedValueOnce(refusal(500, { code: 'internal_error' }));

    await press();

    expect(text()).toContain('Ceva nu a mers la noi. Încearcă din nou.');
    expect(radio('Insulte').checked).toBe(true);
  });

  it('marks the send busy and disables the reasons and Renunță while sending', async () => {
    await open();
    await pick('Insulte');
    let answer: (value: unknown) => void = () => undefined;
    send.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    await press();

    const submit = panel().querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(radios().every((r) => r.matches(':disabled'))).toBe(true);
    expect(button('Renunță')?.matches(':disabled')).toBe(true);

    answer(ANSWER);
    await settle();
    await expect(result).resolves.toEqual(ANSWER);
  });
});
