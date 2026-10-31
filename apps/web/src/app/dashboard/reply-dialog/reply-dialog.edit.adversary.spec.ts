import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type GarageStaffReviewDto,
  type ReviewReplyDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import type { ReplyData } from './open-reply';
import { ReplyDialog } from './reply-dialog';
import {
  repliedReview,
  staffReply,
  staffReview,
} from '../garage-reviews/garage-reviews.testing';

@Component({
  template: '<button type="button" id="opener">Răspunde</button>',
})
class Host {
  readonly overlays = inject(Overlays);
}

let post: jest.Mock;
let edit: jest.Mock;
let saved: jest.Mock;
let result: Promise<ReviewReplyDto | 'cancelled'>;
let settled: ReviewReplyDto | 'cancelled' | undefined;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({
  answer = async () => staffReply(),
  language = 'ro',
  review = staffReview(),
}: {
  answer?: () => Promise<ReviewReplyDto>;
  language?: 'ro' | 'en';
  review?: GarageStaffReviewDto;
} = {}) {
  post = jest.fn(answer);
  edit = jest.fn(answer);
  saved = jest.fn();
  settled = undefined;
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ReviewsService,
        useValue: {
          reviewRepliesControllerEdit: edit,
          reviewRepliesControllerPost: post,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  document.body.appendChild(host.nativeElement);
  (host.nativeElement as HTMLElement)
    .querySelector<HTMLButtonElement>('#opener')
    ?.focus();
  result = host.componentInstance.overlays.open<ReviewReplyDto, ReplyData>(
    ReplyDialog,
    {
      data: { review, saved },
      shape: 'dialog',
      title: review.reply
        ? 'garage.reviews.reply.titleEdit'
        : 'garage.reviews.reply.title',
    },
  );
  const mine = result;
  void mine.then((r) => {
    if (result === mine) settled = r;
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const field = () => panel().querySelector<HTMLTextAreaElement>('textarea');
const publish = () =>
  panel().querySelector<HTMLButtonElement>('button[data-publish]');
const count = () => text(panel().querySelector('[data-count]'));
const alert = () => text(panel().querySelector('mf-task-error'));
const fieldError = () => text(panel().querySelector('mf-field-error'));
const blocked = () => publish()?.getAttribute('aria-disabled') === 'true';

async function type(value: string) {
  const textarea = field() as HTMLTextAreaElement;
  textarea.value = value;
  textarea.dispatchEvent(new Event('input'));
  await settle();
}

async function press() {
  publish()?.click();
  await settle();
}

const refused = (status: number, body: unknown) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  document.body.innerHTML = '';
  TestBed.resetTestingModule();
});

const CURRENT = 'Mulțumim, Andrei!\nTe mai așteptăm.';

// @traces 1387-FR-002 1387-FR-003
describe('editing a reply: what is sent', () => {
  it('PATCHes the review id, not the reply id, with the prefilled text unchanged', async () => {
    await open({ review: repliedReview({ id: 'r-77' }, { id: 'rep-99' }) });

    expect(field()?.value).toBe(CURRENT);
    await press();

    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith({
      body: { text: CURRENT },
      reviewId: 'r-77',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('trims a padded edit and sends it as an edit', async () => {
    await open({ review: repliedReview() });

    await type('  \n Text nou \n ');
    await press();

    expect(edit).toHaveBeenCalledWith({
      body: { text: 'Text nou' },
      reviewId: 'r-1',
    });
  });

  it('refuses to send an edit whose text was cleared or left as spaces', async () => {
    await open({ review: repliedReview() });

    await type('');
    expect(count()).toBe('0 / 1.000');
    expect(blocked()).toBe(true);
    await press();
    await type('   \n  ');
    await press();

    expect(edit).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });

  it('refuses an edit grown past 1,000 code points and sends it once cut back', async () => {
    await open({ review: repliedReview() });

    await type('a'.repeat(1001));
    await press();
    expect(edit).not.toHaveBeenCalled();
    await type('a'.repeat(1000));
    await press();

    expect(edit).toHaveBeenCalledTimes(1);
  });

  it('counts a prefilled reply from the first frame', async () => {
    await open({ review: repliedReview() });

    expect(count()).toBe(`${[...CURRENT].length} / 1.000`);
    expect(blocked()).toBe(false);
  });

  it('titles nothing itself but keeps the same hint and field label as a first reply', async () => {
    await open({ review: repliedReview() });

    expect(text(panel().querySelector('label'))).toBe('Răspunsul tău');
    expect(text(panel())).toContain(
      'Răspunsul e public și apare sub recenzie.',
    );
    expect(text(publish())).toBe('Publică răspunsul');
  });

  it('tells the opener about the edit once, with the answer, and shows the confirmation', async () => {
    const answer = staffReply({
      editedAt: '2026-10-25T10:00:00.000Z',
      text: 'Text nou',
    });
    await open({ answer: async () => answer, review: repliedReview() });
    await type('Text nou');

    await press();

    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith(answer);
    expect(panel().querySelector('[data-reply-form]')).toBeNull();
    expect(text(panel().querySelector('[role="status"]'))).toBe(
      'Răspunsul e public, sub recenzie.',
    );
  });
});

// @traces 1387-FR-003
describe('editing a reply: refusals', () => {
  const body = (code: string, status: number) => ({
    code,
    message: 'x',
    status,
  });

  it.each([
    [403, 'forbidden', 'Doar proprietarul poate răspunde.'],
    [404, 'not_found', 'Recenzia nu mai există.'],
    [409, 'already_replied', 'Recenzia are deja un răspuns.'],
    [409, 'review_not_public', 'Recenzia nu mai e publică.'],
    [
      409,
      'reply_not_public',
      'Răspunsul e raportat și nu poate fi editat acum.',
    ],
    [409, 'reply_removed', 'Răspunsul a fost eliminat de un admin.'],
  ])(
    'answers a %i %s on an edit with its own text, keeps the typed text and tells nobody it saved',
    async (status, code, message) => {
      await open({
        answer: () => Promise.reject(refused(status, body(code, status))),
        review: repliedReview(),
      });
      await type('Text nou\ncu două rânduri');

      await press();

      expect(alert()).toBe(message);
      expect(text(panel().querySelector('[role="alert"]'))).toBe(message);
      expect(field()?.value).toBe('Text nou\ncu două rânduri');
      expect(blocked()).toBe(false);
      expect(saved).not.toHaveBeenCalled();
      expect(settled).toBeUndefined();
    },
  );

  it.each([
    [403, 'forbidden', 'Only the owner can reply.'],
    [404, 'not_found', 'The review no longer exists.'],
    [409, 'already_replied', 'The review already has a reply.'],
    [409, 'review_not_public', 'The review is no longer public.'],
    [
      409,
      'reply_not_public',
      'The reply is reported and cannot be edited now.',
    ],
    [409, 'reply_removed', 'The reply was removed by an admin.'],
  ])('says a %i %s in English on an edit', async (status, code, message) => {
    await open({
      answer: () => Promise.reject(refused(status, body(code, status))),
      language: 'en',
      review: repliedReview(),
    });
    await type('New text');

    await press();

    expect(alert()).toBe(message);
    expect(field()?.value).toBe('New text');
  });

  it('shows a refused length on an edit under the field', async () => {
    await open({
      answer: () =>
        Promise.reject(
          refused(422, {
            code: 'validation_failed',
            errors: [{ code: 'length', field: 'text' }],
            message: 'x',
            status: 422,
          }),
        ),
      review: repliedReview(),
    });
    await type('Text nou');

    await press();

    expect(fieldError()).toBe('Răspunsul are între 1 și 1.000 de caractere.');
    expect(field()?.value).toBe('Text nou');
    expect(saved).not.toHaveBeenCalled();
  });

  it('clears the refusal and confirms when the same button is pressed again and the edit goes through', async () => {
    let calls = 0;
    const answer = staffReply({ text: 'Text nou' });
    await open({
      answer: () =>
        ++calls === 1
          ? Promise.reject(refused(409, body('reply_not_public', 409)))
          : Promise.resolve(answer),
      review: repliedReview(),
    });
    await type('Text nou');

    await press();
    expect(alert()).not.toBe('');
    await press();

    expect(edit).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith(answer);
    expect(text(panel().querySelector('[role="status"]'))).toBe(
      'Răspunsul e public, sub recenzie.',
    );
  });

  it('keeps the text of an edit across a lost connection and retries as an edit', async () => {
    let calls = 0;
    await open({
      answer: () =>
        ++calls === 1
          ? Promise.reject(new HttpErrorResponse({ status: 0 }))
          : Promise.resolve(staffReply()),
      review: repliedReview(),
    });
    await type('Text nou');

    await press();
    expect(alert()).not.toBe('');
    expect(field()?.value).toBe('Text nou');
    expect(saved).not.toHaveBeenCalled();
    await press();

    expect(edit).toHaveBeenCalledTimes(2);
    expect(post).not.toHaveBeenCalled();
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('keeps the opener told once when an edit is refused, then dismissed', async () => {
    await open({
      answer: () => Promise.reject(refused(409, body('reply_removed', 409))),
      review: repliedReview(),
    });
    await type('Text nou');
    await press();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    panel()?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(saved).not.toHaveBeenCalled();
    expect(settled).toBe('cancelled');
  });
});
