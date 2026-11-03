import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AdminService,
  type ReportQueueItemDto,
  type ReviewDecisionResultDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import type { Mock } from 'vitest';

import { openRemoveReview } from './open-remove-review';
import type { RemoveReviewResult } from './remove-review-dialog';

vi.mock('@spartan-ng/brain/sonner', async (importOriginal) =>
  Object.assign({}, await importOriginal<object>(), { toast: vi.fn() }),
);

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

type Report = ReportQueueItemDto['report'];

const item = (
  report: Partial<Report> = {},
  review: Partial<ReportQueueItemDto['review']> = {},
): ReportQueueItemDto => ({
  facts: {
    account: { createdAt: '2026-10-28T08:00:00Z', deleted: false },
    garageReports: { earlier: 0, kept: 0 },
    identicalReviews: 0,
    job: { kind: 'none' },
  },
  garage: { id: 'garage-1', name: 'Atelier Dinamo' },
  report: {
    createdAt: '2026-10-29T09:00:00Z',
    dueAt: '2026-10-31T09:00:00Z',
    id: 'report-1',
    overdue: false,
    reason: 'insults',
    source: 'garage',
    target: 'review',
    ...report,
  },
  review: {
    author: 'Andrei M.',
    id: 'review-1',
    postedAt: '2026-10-28T10:00:00Z',
    score: 1,
    source: 'job',
    text: 'Nu recomand.',
    ...review,
  },
});

const replyItem = (report: Partial<Report> = {}) => ({
  ...item({ source: 'author', target: 'reply', ...report }),
  reply: {
    editedAt: null,
    id: 'reply-1',
    postedAt: '2026-10-29T08:30:00Z',
    postedBy: 'Atelier Dinamo',
    text: 'Clientul minte.',
  },
});

const ANSWER: ReviewDecisionResultDto = {
  decidedAt: '2026-11-02T10:00:00Z',
  decision: 'removed',
  replyId: null,
  reportId: 'report-1',
  reviewId: 'review-1',
  target: 'review',
};

const REASONS: [string, string][] = [
  ['insults', 'Insulte'],
  ['personal_data', 'Date personale'],
  ['ads', 'Reclamă'],
  ['promotion', 'Promovarea altui service'],
  ['off_topic', 'În afara subiectului'],
  ['hate', 'Ură sau discriminare'],
  ['fake_or_conflicted', 'Falsă sau în conflict de interese'],
  ['threats_or_legal_accusations', 'Amenințări sau acuzații legale'],
];

let decide: Mock;
let result: Promise<RemoveReviewResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  value: ReportQueueItemDto = item(),
  language: 'ro' | 'en' = 'ro',
) {
  decide = vi.fn(async () => ANSWER);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { reportQueueControllerDecide: decide },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  result = openRemoveReview(host.componentInstance.overlays, value);
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const words = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const title = () => words(document.querySelector('[id^="mf-overlay-title-"]'));
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find((b) => words(b) === name) as
    | HTMLButtonElement
    | undefined;
const radios = () => [
  ...panel().querySelectorAll<HTMLInputElement>('input[type="radio"]'),
];
const labelOf = (r: HTMLInputElement) => words(r.closest('label'));
const checked = () =>
  radios()
    .filter((r) => r.checked)
    .map(labelOf);
const press = async (name = 'Șterge recenzia') => {
  button(name)?.click();
  await settle();
};
const refusal = (status: number, error: unknown) =>
  new HttpErrorResponse({ error, status });

afterEach(() => {
  for (const n of document.querySelectorAll('.cdk-overlay-container')) {
    n.innerHTML = '';
  }
  TestBed.resetTestingModule();
  vi.mocked(toast).mockClear();
});

// @traces 1423-FR-003
describe('the removal dialog, pre-selection and the body sent', () => {
  it.each(REASONS)(
    'pre-selects the one rule for the reason %s and sends that code',
    async (reason, label) => {
      await open(item({ reason: reason as Report['reason'] }));

      expect(checked()).toEqual([label]);

      await press();

      expect(decide).toHaveBeenCalledWith({
        body: { decision: 'remove', reason },
        reviewId: 'review-1',
      });
    },
  );

  it('keeps the button disabled and sends nothing when Altceva is submitted unpicked on a reply', async () => {
    await open(replyItem({ reason: 'other' }));

    expect(checked()).toEqual([]);
    expect(button('Șterge răspunsul')?.disabled).toBe(true);

    await press('Șterge răspunsul');

    expect(decide).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });

  it('shows the author literally when the name carries braces, markup or unicode', async () => {
    await open(item({}, { author: '{name} <b>Ștefan</b> 😀' }));

    expect(title()).toBe('Ștergi recenzia lui {name} <b>Ștefan</b> 😀?');
    expect(panel().querySelector('b')).toBeNull();
  });

  it('titles a reply with a unicode garage name in English', async () => {
    const value = replyItem();
    value.garage = { id: 'g', name: 'Șoșoacă & Fiii "Auto"' };
    await open(value, 'en');

    expect(title()).toBe('Remove Șoșoacă & Fiii "Auto"\'s reply?');
  });

  it('sends the reply removal against the id of the review it answers', async () => {
    await open(replyItem({ reason: 'hate' }));

    await press('Șterge răspunsul');

    expect(decide).toHaveBeenCalledWith({
      body: { decision: 'remove', reason: 'hate' },
      reviewId: 'review-1',
    });
  });

  it('closes on Renunță in English without sending', async () => {
    await open(item(), 'en');

    await press('Cancel');

    await expect(result).resolves.toBe('cancelled');
    expect(decide).not.toHaveBeenCalled();
  });

  it('closes on the backdrop without sending', async () => {
    await open();

    document
      .querySelector<HTMLElement>('.cdk-overlay-backdrop')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(decide).not.toHaveBeenCalled();
  });
});

// @traces 1423-FR-005
describe('the removal dialog, refusals and failures', () => {
  it.each([400, 403])(
    'closes with the toast and no outcome on a %i, leaving the actions in place',
    async (status) => {
      await open();
      decide.mockRejectedValueOnce(refusal(status, { code: 'forbidden' }));

      await press();

      await expect(result).resolves.toBe('cancelled');
      expect(panel()).toBeNull();
      expect(toast).toHaveBeenCalledTimes(1);
    },
  );

  it.each([500, 502, 503, 504])(
    'stays open on a %i with the rule kept and the main button enabled',
    async (status) => {
      await open(item({ reason: 'hate' }));
      decide.mockRejectedValueOnce(refusal(status, null));

      await press();

      expect(panel()).not.toBeNull();
      expect(checked()).toEqual(['Ură sau discriminare']);
      expect(button('Șterge recenzia')?.disabled).toBe(false);
      expect(toast).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['an empty string', ''],
    ['null', null],
  ])(
    'closes already decided with no name when decidedBy is %s',
    async (_name, decidedBy) => {
      await open();
      decide.mockRejectedValueOnce(
        refusal(409, { code: 'already_decided', decidedBy }),
      );

      await press();

      await expect(result).resolves.toEqual({ outcome: 'already_decided' });
    },
  );

  it('keeps a decidedBy of markup and unicode as it came', async () => {
    await open();
    decide.mockRejectedValueOnce(
      refusal(409, { code: 'already_decided', decidedBy: '<i>Ioana</i> Ș.' }),
    );

    await press();

    await expect(result).resolves.toEqual({
      by: '<i>Ioana</i> Ș.',
      outcome: 'already_decided',
    });
  });

  it('closes as gone when no report is pending on a reply', async () => {
    await open(replyItem());
    decide.mockRejectedValueOnce(refusal(409, { code: 'no_pending_report' }));

    await press('Șterge răspunsul');

    await expect(result).resolves.toEqual({ outcome: 'gone' });
  });

  it('stays open after a network error and sends the same body on the retry', async () => {
    await open(item({ reason: 'ads' }));
    decide.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

    await press();
    await press();

    expect(decide.mock.calls).toEqual([
      [{ body: { decision: 'remove', reason: 'ads' }, reviewId: 'review-1' }],
      [{ body: { decision: 'remove', reason: 'ads' }, reviewId: 'review-1' }],
    ]);
  });

  it('toasts a network error in Romanian once, with the rules enabled again', async () => {
    await open();
    decide.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

    await press();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(radios().every((r) => !r.matches(':disabled'))).toBe(true);
    expect(button('Renunță')?.matches(':disabled')).toBe(false);
  });

  it('sends once when the form is submitted twice before the answer', async () => {
    await open();
    decide.mockReturnValueOnce(new Promise(() => undefined));

    const form = panel().querySelector('form') as HTMLFormElement;
    form.requestSubmit();
    form.requestSubmit();
    await settle();

    expect(decide).toHaveBeenCalledTimes(1);
  });
});
