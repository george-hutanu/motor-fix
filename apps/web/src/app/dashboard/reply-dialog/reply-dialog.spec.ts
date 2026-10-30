import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DELETED_AUTHOR } from '@motor-fix/contracts/lei-text';
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

const desktop = (query: string) =>
  ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: true,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }) as unknown as MediaQueryList;

async function open({
  answer = async () => staffReply({ postedAt: new Date().toISOString() }),
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

// @traces 1387-review-reply-web-FR-002 1387-review-reply-web-FR-005
describe('the reply dialog: what it shows', () => {
  it('titles the reply and names the review: author, day and mechanic', async () => {
    await open();

    expect(text(panel().querySelector('h2'))).toBe('Răspunde la recenzie');
    expect(text(panel().querySelector('[data-sub]'))).toBe(
      'Andrei M. · 25 oct. 2026 · Costel R.',
    );
    expect(text(panel().querySelector(`label[for="${field()?.id}"]`))).toBe(
      'Răspunsul tău',
    );
    expect(field()?.value).toBe('');
    expect(text(panel())).toContain(
      'Răspunsul e public și apare sub recenzie.',
    );
    expect(count()).toBe('0 / 1.000');
    expect(text(publish())).toBe('Publică răspunsul');
  });

  it('ties the hint and the counter to the field', async () => {
    await open();
    const described = field()?.getAttribute('aria-describedby')?.split(' ');
    const hint = [...panel().querySelectorAll('p')].find(
      (p) => text(p) === 'Răspunsul e public și apare sub recenzie.',
    );

    expect(described).toContain(hint?.id);
    expect(described).toContain(panel().querySelector('[data-count]')?.id);
  });

  it('leaves the mechanic out of the subtitle of a review that names none', async () => {
    await open({
      review: staffReview({ mechanic: null, source: 'profile' }),
    });

    expect(text(panel().querySelector('[data-sub]'))).toBe(
      'Andrei M. · 25 oct. 2026',
    );
  });

  it('names a deleted author as a MotorFix driver', async () => {
    await open({
      review: staffReview({ author: { shortName: DELETED_AUTHOR } }),
    });

    expect(text(panel().querySelector('[data-sub]'))).toBe(
      'Șofer MotorFix · 25 oct. 2026 · Costel R.',
    );
  });

  it('opens an edit with the reply in the field, under its own title', async () => {
    await open({ review: repliedReview() });

    expect(text(panel().querySelector('h2'))).toBe('Editează răspunsul');
    expect(field()?.value).toBe('Mulțumim, Andrei!\nTe mai așteptăm.');
    expect(count()).toBe('34 / 1.000');
  });

  it('writes its texts in English', async () => {
    await open({ language: 'en' });

    expect(text(panel().querySelector('h2'))).toBe('Reply to the review');
    expect(text(panel().querySelector('[data-sub]'))).toBe(
      'Andrei M. · 25 Oct 2026 · Costel R.',
    );
    expect(text(panel())).toContain(
      'Your reply is public and appears under the review.',
    );
    expect(count()).toBe('0 / 1,000');
    expect(text(publish())).toBe('Publish the reply');
  });

  it('puts the focus in the field on open, on a computer', async () => {
    const media = window.matchMedia;
    window.matchMedia = desktop as typeof window.matchMedia;
    try {
      await open();

      expect(document.activeElement).toBe(field());
    } finally {
      window.matchMedia = media;
    }
  });
});

// @traces 1387-review-reply-web-FR-002
describe('the reply dialog: the counter and the publish button', () => {
  it('counts the trimmed text in code points, as the API does', async () => {
    await open();

    await type('  Mulțumim 🚗  ');

    expect(count()).toBe('10 / 1.000');
  });

  it('keeps Publică răspunsul off, but in the tab order, while the text is blank', async () => {
    await open();
    await type('   ');

    expect(publish()?.getAttribute('aria-disabled')).toBe('true');
    expect(publish()?.disabled).toBe(false);
    await press();
    expect(post).not.toHaveBeenCalled();
    expect(fieldError()).toBe('');
  });

  it('takes exactly 1,000 code points and refuses 1,001', async () => {
    await open();

    await type('🚗'.repeat(1000));
    expect(count()).toBe('1.000 / 1.000');
    expect(publish()?.hasAttribute('aria-disabled')).toBe(false);

    await type('🚗'.repeat(1001));
    expect(count()).toBe('1.001 / 1.000');
    expect(publish()?.getAttribute('aria-disabled')).toBe('true');
    await press();
    expect(post).not.toHaveBeenCalled();
  });

  it('sends once while the first press is in flight', async () => {
    let answer: (reply: ReviewReplyDto) => void = () => undefined;
    await open({
      answer: () =>
        new Promise<ReviewReplyDto>((resolve) => {
          answer = resolve;
        }),
    });
    await type('Mulțumim!');

    await press();
    expect(publish()?.getAttribute('aria-disabled')).toBe('true');
    await press();

    expect(post).toHaveBeenCalledTimes(1);
    answer(staffReply());
    await settle();
  });
});

// @traces 1387-review-reply-web-FR-003 1387-review-reply-web-FR-005
describe('the reply dialog: publishing', () => {
  it('posts the trimmed text, confirms in place and hands the reply to the opener at once', async () => {
    const reply = staffReply({ id: 'rep-9', text: 'Mulțumim!' });
    await open({ answer: async () => reply });
    await type('  Mulțumim!  ');

    await press();

    expect(post).toHaveBeenCalledWith({
      body: { text: 'Mulțumim!' },
      reviewId: 'r-1',
    });
    expect(edit).not.toHaveBeenCalled();
    expect(field()).toBeNull();
    expect(text(panel().querySelector('[role="status"]'))).toBe(
      'Răspunsul e public, sub recenzie.',
    );
    expect(saved).toHaveBeenCalledWith(reply);
  });

  it('edits an answered review with PATCH and its new text', async () => {
    await open({ review: repliedReview() });
    await type('Mulțumim încă o dată.');

    await press();

    expect(edit).toHaveBeenCalledWith({
      body: { text: 'Mulțumim încă o dată.' },
      reviewId: 'r-1',
    });
    expect(post).not.toHaveBeenCalled();
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('closes with the reply on Gata and gives the focus back to the button that opened it', async () => {
    const reply = staffReply({ id: 'rep-9' });
    await open({ answer: async () => reply });
    await type('Mulțumim!');
    await press();

    [...panel().querySelectorAll('button')]
      .find((b) => text(b) === 'Gata')
      ?.click();
    await settle();

    expect(settled).toEqual(reply);
    expect(document.activeElement?.id).toBe('opener');
  });

  it('confirms in English', async () => {
    await open({ language: 'en' });
    await type('Thanks!');

    await press();

    expect(text(panel().querySelector('[role="status"]'))).toBe(
      'Your reply is public, under the review.',
    );
  });
});

// @traces 1387-review-reply-web-FR-003 1387-review-reply-web-FR-005
describe('the reply dialog: refusals and failures', () => {
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
    'says a %i %s in the error line and keeps the text',
    async (status, code, said) => {
      await open({
        answer: () =>
          Promise.reject(
            refused(status, { code, message: 'API text', status }),
          ),
      });
      await type('Mulțumim!');

      await press();

      expect(alert()).toBe(said);
      expect(panel().querySelector('mf-task-error')?.getAttribute('role')).toBe(
        'alert',
      );
      expect(field()?.value).toBe('Mulțumim!');
      expect(saved).not.toHaveBeenCalled();
    },
  );

  it('writes a refusal in English', async () => {
    await open({
      answer: () =>
        Promise.reject(
          refused(409, { code: 'already_replied', message: 'x', status: 409 }),
        ),
      language: 'en',
    });
    await type('Thanks!');

    await press();

    expect(alert()).toBe('The review already has a reply.');
  });

  it('puts a refused length under the field and keeps the text', async () => {
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
    });
    await type('Mulțumim!');

    await press();

    expect(fieldError()).toBe('Răspunsul are între 1 și 1.000 de caractere.');
    expect(field()?.value).toBe('Mulțumim!');
  });

  it('says a lost connection and sends the same text again on the next press', async () => {
    const reply = staffReply();
    let calls = 0;
    await open({
      answer: () =>
        ++calls === 1
          ? Promise.reject(refused(0, null))
          : Promise.resolve(reply),
    });
    await type('Mulțumim!');

    await press();
    expect(alert()).toBe(
      'Nu am putut ajunge la MotorFix. Verifică conexiunea și încearcă din nou.',
    );
    expect(field()?.value).toBe('Mulțumim!');

    await press();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].body.text).toBe('Mulțumim!');
    expect(saved).toHaveBeenCalledWith(reply);
  });
});
