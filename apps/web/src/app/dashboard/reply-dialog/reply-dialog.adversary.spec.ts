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

async function open({
  answer = async () => staffReply(),
  review = staffReview(),
}: {
  answer?: () => Promise<ReviewReplyDto>;
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

// @traces 1387-FR-002
// @traces 1387-FR-002 1387-FR-003
describe('the reply dialog at the 1,000 code point limit', () => {
  it('counts a base letter and its combining accent as two code points', async () => {
    await open();

    await type('é'.repeat(500));
    expect(count()).toBe('1.000 / 1.000');
    expect(blocked()).toBe(false);

    await type('é'.repeat(500) + 'e');
    expect(count()).toBe('1.001 / 1.000');
    expect(blocked()).toBe(true);
    await press();
    expect(post).not.toHaveBeenCalled();
  });

  it('takes 1,000 astral characters padded with spaces and newlines, and sends them trimmed', async () => {
    await open();
    const body = '😀'.repeat(1000);

    await type(`  \n\t${body}\n  `);

    expect(count()).toBe('1.000 / 1.000');
    await press();
    expect(post).toHaveBeenCalledWith({
      body: { text: body },
      reviewId: 'r-1',
    });
  });

  it('refuses 1,001 code points that stay 1,001 after trimming, even when padding surrounds them', async () => {
    await open();

    await type(` ${'😀'.repeat(500)}a${'😀'.repeat(500)} `);

    expect(count()).toBe('1.001 / 1.000');
    expect(blocked()).toBe(true);
    await press();
    expect(post).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });

  it('lets an over-long text through again once it is cut back to the cap', async () => {
    await open();
    await type('x'.repeat(1001));
    expect(blocked()).toBe(true);

    await type('x'.repeat(1000));

    expect(blocked()).toBe(false);
    await press();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('counts a 1,001 character text of plain letters as over the cap', async () => {
    await open();

    await type('a'.repeat(1001));

    expect(count()).toBe('1.001 / 1.000');
    expect(blocked()).toBe(true);
  });
});

// @traces 1387-FR-002
describe('the reply dialog with text that is not text', () => {
  it.each([
    ['spaces', '     '],
    ['newlines and tabs', '\n\t\n\r\n\t'],
    ['no-break and ideographic spaces', ' 　 '],
  ])(
    'keeps the button off for %s only and sends nothing',
    async (_name, value) => {
      await open();

      await type(value);

      expect(count()).toBe('0 / 1.000');
      expect(blocked()).toBe(true);
      await press();
      expect(post).not.toHaveBeenCalled();
      expect(fieldError()).toBe('');
    },
  );

  it('sends markup and inner blank lines exactly as typed, trimmed at the ends only', async () => {
    await open();
    const typed =
      '<script>alert(1)</script>\n\n<b>Mulțumim</b>  &amp;\r\nLa revedere';

    await type(`\n  ${typed}  \n`);
    await press();

    // A textarea's value reads every line break as a line feed.
    expect(post).toHaveBeenCalledWith({
      body: { text: typed.replace('\r\n', '\n') },
      reviewId: 'r-1',
    });
    expect(document.querySelector('mf-overlay-panel script')).toBeNull();
  });

  it('shows an author name with markup as plain text in the subtitle', async () => {
    await open({
      review: staffReview({ author: { shortName: '<img src=x onerror=1>' } }),
    });

    expect(panel().querySelector('[data-sub] img')).toBeNull();
    expect(text(panel().querySelector('[data-sub]'))).toBe(
      '<img src=x onerror=1> · 25 oct. 2026 · Costel R.',
    );
  });

  it('shows the deleted author and no mechanic part together', async () => {
    await open({
      review: staffReview({
        author: { shortName: DELETED_AUTHOR },
        mechanic: null,
        source: 'profile',
      }),
    });

    expect(text(panel().querySelector('[data-sub]'))).toBe(
      'Șofer MotorFix · 25 oct. 2026',
    );
  });

  it('fills an edit with a reply that holds markup as the literal text', async () => {
    await open({
      review: repliedReview({}, { text: '<b>Mulțumim</b>\n\nOk' }),
    });

    expect(field()?.value).toBe('<b>Mulțumim</b>\n\nOk');
    expect(panel().querySelector('textarea ~ b, form b')).toBeNull();
  });
});

// @traces 1387-FR-003
describe('the reply dialog while a save is in flight', () => {
  it('sends one request when the form is submitted twice before the answer', async () => {
    let answer: (reply: ReviewReplyDto) => void = () => undefined;
    await open({
      answer: () =>
        new Promise<ReviewReplyDto>((resolve) => {
          answer = resolve;
        }),
    });
    await type('Mulțumim!');
    const form = panel().querySelector('form') as HTMLFormElement;

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    publish()?.click();
    await settle();

    expect(post).toHaveBeenCalledTimes(1);
    answer(staffReply());
    await settle();
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('calls saved once with the answer when it lands, and never before', async () => {
    let answer: (reply: ReviewReplyDto) => void = () => undefined;
    const reply = staffReply({ id: 'rep-7', text: 'Altceva decât am scris' });
    await open({
      answer: () =>
        new Promise<ReviewReplyDto>((resolve) => {
          answer = resolve;
        }),
    });
    await type('Mulțumim!');

    await press();
    expect(saved).not.toHaveBeenCalled();
    answer(reply);
    await settle();

    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith(reply);
  });

  it('still tells the opener about a saved reply when the owner dismisses the confirmation with Escape', async () => {
    const reply = staffReply({ id: 'rep-8' });
    await open({ answer: async () => reply });
    await type('Mulțumim!');
    await press();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    panel()?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith(reply);
  });

  it('resolves cancelled and never calls saved when dismissed before any press', async () => {
    await open();
    await type('Mulțumim!');

    panel()?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(saved).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(settled).toBe('cancelled');
  });
});

// @traces 1387-FR-003
describe('the reply dialog after a refusal', () => {
  it('shows the refusal, then publishes the corrected text and confirms with the error gone', async () => {
    const reply = staffReply({ id: 'rep-2' });
    let calls = 0;
    await open({
      answer: () =>
        ++calls === 1
          ? Promise.reject(
              refused(409, {
                code: 'already_replied',
                message: 'x',
                status: 409,
              }),
            )
          : Promise.resolve(reply),
    });
    await type('Prima încercare');

    await press();
    expect(alert()).toBe('Recenzia are deja un răspuns.');
    expect(saved).not.toHaveBeenCalled();
    expect(blocked()).toBe(false);

    await type('A doua încercare');
    await press();

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].body.text).toBe('A doua încercare');
    expect(panel().querySelector('mf-task-error')).toBeNull();
    expect(text(panel().querySelector('[role="status"]'))).toBe(
      'Răspunsul e public, sub recenzie.',
    );
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith(reply);
  });

  it('keeps a text with astral characters and newlines through a refusal', async () => {
    await open({
      answer: () =>
        Promise.reject(
          refused(404, { code: 'not_found', message: 'x', status: 404 }),
        ),
    });
    const typed = 'Mulțumim 😀\né\n\n';
    await type(typed);

    await press();

    expect(alert()).toBe('Recenzia nu mai există.');
    expect(field()?.value).toBe(typed);
    expect(count()).toBe('13 / 1.000');
  });

  it('keeps the edit text, and PATCHes again, after a refused edit', async () => {
    await open({
      answer: () =>
        Promise.reject(
          refused(409, { code: 'reply_removed', message: 'x', status: 409 }),
        ),
      review: repliedReview(),
    });
    await type('Text nou');

    await press();
    await press();

    expect(alert()).toBe('Răspunsul a fost eliminat de un admin.');
    expect(field()?.value).toBe('Text nou');
    expect(edit).toHaveBeenCalledTimes(2);
    expect(post).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });

  it.each([500, 502, 503])(
    'keeps the text and calls nothing saved on a %i',
    async (status) => {
      await open({ answer: () => Promise.reject(refused(status, null)) });
      await type('Mulțumim!');

      await press();

      expect(alert()).not.toBe('');
      expect(field()?.value).toBe('Mulțumim!');
      expect(blocked()).toBe(false);
      expect(saved).not.toHaveBeenCalled();
    },
  );

  it('keeps the text on a refusal with an unknown code and no body', async () => {
    await open({
      answer: () => Promise.reject(refused(409, { code: 'something_new' })),
    });
    await type('Mulțumim!');

    await press();

    expect(field()?.value).toBe('Mulțumim!');
    expect(alert()).not.toBe('');
    expect(saved).not.toHaveBeenCalled();
  });

  it('keeps a refused length under the field and announces the refusal once', async () => {
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
    expect(alert()).toBe('Verifică câmpurile marcate.');
    expect(saved).not.toHaveBeenCalled();
  });

  it('keeps the text on a 422 that names no field', async () => {
    await open({
      answer: () =>
        Promise.reject(
          refused(422, {
            code: 'validation_failed',
            errors: [],
            message: 'x',
            status: 422,
          }),
        ),
    });
    await type('Mulțumim!');

    await press();

    expect(field()?.value).toBe('Mulțumim!');
    expect(saved).not.toHaveBeenCalled();
    expect(`${alert()}${fieldError()}`).not.toBe('');
  });
});
