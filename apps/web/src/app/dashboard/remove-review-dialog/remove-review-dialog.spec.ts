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

// @traces 1423-FR-002 1423-FR-003 1423-FR-005 1423-FR-006 1423-FR-007

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
  extra: Partial<ReportQueueItemDto> = {},
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
  },
  ...extra,
});

const replyItem = (report: Partial<Report> = {}) =>
  item(
    { source: 'author', target: 'reply', ...report },
    {
      reply: {
        editedAt: null,
        id: 'reply-1',
        postedAt: '2026-10-29T08:30:00Z',
        postedBy: 'Atelier Dinamo',
        text: 'Clientul minte.',
      },
    },
  );

const ANSWER: ReviewDecisionResultDto = {
  decidedAt: '2026-11-02T10:00:00Z',
  decision: 'removed',
  replyId: null,
  reportId: 'report-1',
  reviewId: 'review-1',
  target: 'review',
};

const RO_RULES = [
  'Insulte',
  'Date personale',
  'Reclamă',
  'Promovarea altui service',
  'În afara subiectului',
  'Ură sau discriminare',
  'Falsă sau în conflict de interese',
  'Amenințări sau acuzații legale',
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
  { language = 'ro' }: { language?: 'ro' | 'en' } = {},
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
const labelOf = (radio: HTMLInputElement) => words(radio.closest('label'));
const radio = (label: string) =>
  radios().find((r) => labelOf(r) === label) as HTMLInputElement;

async function pick(label: string) {
  radio(label).click();
  await settle();
}

const press = async (name = 'Șterge recenzia') => {
  button(name)?.click();
  await settle();
};

const refusal = (status: number, error: object) =>
  new HttpErrorResponse({ error, status });

afterEach(() => {
  for (const n of document.querySelectorAll('.cdk-overlay-container')) {
    n.innerHTML = '';
  }
  TestBed.resetTestingModule();
  vi.mocked(toast).mockClear();
});

describe('the confirmation of a review removal', () => {
  it("is titled with the author's name", async () => {
    await open();

    expect(title()).toBe('Ștergi recenzia lui Andrei M.?');
  });

  it('lists the eight rules in order under Regula încălcată, the reason picked', async () => {
    await open();

    expect(words(panel().querySelector('legend'))).toBe('Regula încălcată');
    expect(radios().map(labelOf)).toEqual(RO_RULES);
    expect(radio('Insulte').checked).toBe(true);
    expect(radios().filter((r) => r.checked)).toHaveLength(1);
    expect(button('Șterge recenzia')?.disabled).toBe(false);
  });

  it('picks the reason the report gave', async () => {
    await open(item({ reason: 'personal_data' }));

    expect(radio('Date personale').checked).toBe(true);
  });

  it('picks nothing for Altceva and keeps the main button disabled until a rule is picked', async () => {
    await open(item({ reason: 'other', text: 'Altceva scris' }));

    expect(radios().some((r) => r.checked)).toBe(false);
    expect(radios().map(labelOf)).not.toContain('Altceva');
    expect(button('Șterge recenzia')?.disabled).toBe(true);

    await pick('Reclamă');

    expect(button('Șterge recenzia')?.disabled).toBe(false);
  });

  it('sends the removal with the rule picked and closes with removed', async () => {
    await open();
    await pick('Ură sau discriminare');

    await press();

    expect(decide).toHaveBeenCalledWith({
      body: { decision: 'remove', reason: 'hate' },
      reviewId: 'review-1',
    });
    await expect(result).resolves.toEqual({ outcome: 'removed' });
    expect(panel()).toBeNull();
  });

  it('closes on Renunță without sending', async () => {
    await open();

    await press('Renunță');

    await expect(result).resolves.toBe('cancelled');
    expect(decide).not.toHaveBeenCalled();
  });

  it('closes on Escape without sending', async () => {
    await open();

    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(decide).not.toHaveBeenCalled();
  });

  it('disables the main button and the rules while the removal is on its way', async () => {
    await open();
    decide.mockReturnValueOnce(new Promise(() => undefined));

    await press();
    const submit = panel().querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    submit.click();
    await settle();

    // The shared submit stays focusable and says it is busy; a second press
    // sends nothing.
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(decide).toHaveBeenCalledTimes(1);
    expect(radios().every((r) => r.matches(':disabled'))).toBe(true);
    expect(button('Renunță')?.matches(':disabled')).toBe(true);
  });

  it('reads in English', async () => {
    await open(item(), { language: 'en' });

    expect(title()).toBe("Remove Andrei M.'s review?");
    expect(words(panel().querySelector('legend'))).toBe('Rule broken');
    expect(button('Remove the review')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });
});

describe('the confirmation of a reply removal', () => {
  it("is titled with the garage's name and removes the reply", async () => {
    await open(replyItem());

    expect(title()).toBe('Ștergi răspunsul lui Atelier Dinamo?');
    expect(radio('Insulte').checked).toBe(true);

    await press('Șterge răspunsul');

    expect(decide).toHaveBeenCalledWith({
      body: { decision: 'remove', reason: 'insults' },
      reviewId: 'review-1',
    });
    await expect(result).resolves.toEqual({ outcome: 'removed' });
  });

  it('reads in English', async () => {
    await open(replyItem(), { language: 'en' });

    expect(title()).toBe("Remove Atelier Dinamo's reply?");
    expect(button('Remove the reply')).toBeDefined();
  });
});

describe('a removal refused or failed', () => {
  it('closes with the name of the admin who decided first', async () => {
    await open();
    decide.mockRejectedValueOnce(
      refusal(409, { code: 'already_decided', decidedBy: 'Ana P.' }),
    );

    await press();

    await expect(result).resolves.toEqual({
      by: 'Ana P.',
      outcome: 'already_decided',
    });
  });

  it('closes already decided with no name when none is sent', async () => {
    await open();
    decide.mockRejectedValueOnce(refusal(409, { code: 'already_decided' }));

    await press();

    await expect(result).resolves.toEqual({ outcome: 'already_decided' });
  });

  it('closes as gone when no report is pending', async () => {
    await open();
    decide.mockRejectedValueOnce(refusal(409, { code: 'no_pending_report' }));

    await press();

    await expect(result).resolves.toEqual({ outcome: 'gone' });
  });

  it('closes as gone when the review is not found', async () => {
    await open();
    decide.mockRejectedValueOnce(refusal(404, { code: 'not_found' }));

    await press();

    await expect(result).resolves.toEqual({ outcome: 'gone' });
  });

  it('stays open after a network error with the rule kept, toasts, and retries', async () => {
    await open();
    await pick('Reclamă');
    decide.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

    await press();

    expect(panel()).not.toBeNull();
    expect(radio('Reclamă').checked).toBe(true);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(button('Șterge recenzia')?.disabled).toBe(false);

    await press();

    expect(decide).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toEqual({ outcome: 'removed' });
  });

  it('stays open after a 500 with a toast in the admin language', async () => {
    await open(item(), { language: 'en' });
    decide.mockRejectedValueOnce(refusal(500, { code: 'internal_error' }));

    await press('Remove the review');

    expect(panel()).not.toBeNull();
    expect(toast).toHaveBeenCalledWith(
      'Something went wrong on our side. Try again.',
    );
  });
});
